import Foundation

/// Outbound JSON-RPC 2.0 request channel: daemon → Electron.
///
/// Phase C3-late only had notifications going up (no reply needed). Phase
/// C3.5 introduces the inverse: the daemon needs to ASK Electron something
/// and await an answer. Example: an iOS device sends a `BridgeActionRecord`;
/// the transport handler must call into Electron's `RunService` to actually
/// execute it, then return a typed `BridgeActionAck` (with `accepted` and
/// `message`) to the iOS side. That requires a real round-trip — not a
/// fire-and-forget notification.
///
/// Wire shape (identical to JSON-RPC 2.0 outbound on the stdout side):
///
///   `{"jsonrpc":"2.0","id":"<uuid>","method":"ui.foo","params":{...}}`
///
/// Electron is expected to reply on stdin:
///
///   `{"jsonrpc":"2.0","id":"<uuid>","result":{...}}`            (success)
///   `{"jsonrpc":"2.0","id":"<uuid>","error":{"code":-32xxx,...}}`  (failure)
///
/// `handleResponseLine(_:)` consumes one stdin line; if it matches an
/// outstanding outbound id it resumes the awaiter and returns `true`. The
/// dispatch loop calls this before falling back to the inbound dispatcher,
/// so inbound requests (which also carry an id but no `result`/`error`) flow
/// to the dispatcher untouched.
///
/// Type discipline: the public surface uses `Data` (raw JSON bytes) for both
/// params and result. Callers serialize on their own thread before invoking
/// `request`, and decode the returned `Data` themselves. This keeps the API
/// `Sendable`-clean (Foundation's `[String: Any]` JSON tree isn't Sendable
/// under strict concurrency) without forcing an `Encodable`-based generic
/// envelope that would be awkward at every call site.
public final class BridgeRequester: @unchecked Sendable {
    public enum RequesterError: Error, Sendable, CustomStringConvertible {
        case encodingFailed
        case timeout(method: String, seconds: TimeInterval)
        case remote(code: Int, message: String, dataJSON: Data?)
        case daemonShuttingDown(method: String)

        public var description: String {
            switch self {
            case .encodingFailed:
                return "Failed to encode outbound request payload to JSON"
            case .timeout(let method, let seconds):
                return "Outbound request '\(method)' timed out after \(seconds)s"
            case .remote(let code, let message, _):
                return "Electron returned JSON-RPC error \(code): \(message)"
            case .daemonShuttingDown(let method):
                return "Daemon shutting down; outbound request '\(method)' canceled"
            }
        }
    }

    private let writer: BridgeStdoutWriter
    private let defaultTimeout: TimeInterval
    private let lock = NSLock()
    private var pending: [String: @Sendable (Result<Data, Error>) -> Void] = [:]
    /// IDs that have already been resolved (via response or timeout) and
    /// must not be resolved a second time. Without this guard, a response
    /// arriving just after a timeout fire would attempt a duplicate
    /// `continuation.resume`, which traps.
    private var resolvedIDs: Set<String> = []

    public init(writer: BridgeStdoutWriter, defaultTimeout: TimeInterval = 30.0) {
        self.writer = writer
        self.defaultTimeout = defaultTimeout
    }

    /// Issue an outbound request and await its response. `paramsJSON` is the
    /// already-serialized JSON representation of the request params (e.g.
    /// `{"recordName":"foo"}` as UTF-8 bytes). The returned `Data` is the
    /// JSON-encoded `result` field from Electron's response (e.g. `"null"`,
    /// `"{\"accepted\":true}"`, etc.) — decode with `JSONSerialization.jsonObject`
    /// or `JSONDecoder` as appropriate.
    public func request(
        method: String,
        paramsJSON: Data,
        timeoutSeconds: TimeInterval? = nil
    ) async throws -> Data {
        let id = UUID().uuidString
        let timeout = timeoutSeconds ?? defaultTimeout
        return try await withCheckedThrowingContinuation { continuation in
            // Wrap the continuation so resolution is one-shot — duplicate
            // resolutions silently no-op via the resolvedIDs gate.
            let resolver: @Sendable (Result<Data, Error>) -> Void = { [weak self] result in
                guard let self else { return }
                self.lock.lock()
                if self.resolvedIDs.contains(id) {
                    self.lock.unlock()
                    return
                }
                self.resolvedIDs.insert(id)
                self.pending.removeValue(forKey: id)
                self.lock.unlock()
                continuation.resume(with: result)
            }

            lock.lock()
            pending[id] = resolver
            lock.unlock()

            // Schedule a deadline so a misbehaving (or absent) Electron-side
            // handler can't pin a transport thread forever.
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                resolver(.failure(RequesterError.timeout(method: method, seconds: timeout)))
            }

            // Build the envelope by splicing the raw paramsJSON into a
            // template. Splicing pre-encoded bytes avoids a round-trip
            // through `JSONSerialization.jsonObject` (which would lose type
            // info on e.g. integers vs doubles and reject deeply-nested
            // null sentinels). The method+id are programmatic strings — we
            // escape them via JSONEncoder to handle quotes/control chars.
            let encoder = JSONEncoder()
            guard
                let idEncoded = (try? encoder.encode(id)).flatMap({ String(data: $0, encoding: .utf8) }),
                let methodEncoded = (try? encoder.encode(method)).flatMap({ String(data: $0, encoding: .utf8) }),
                let paramsString = String(data: paramsJSON, encoding: .utf8)
            else {
                resolver(.failure(RequesterError.encodingFailed))
                return
            }
            let line = "{\"jsonrpc\":\"2.0\",\"id\":\(idEncoded),\"method\":\(methodEncoded),\"params\":\(paramsString)}"
            writer.writeLine(line)
        }
    }

    /// Try to interpret `line` as a response to one of our outbound requests.
    /// Returns `true` when handled (so the dispatch loop knows not to fall
    /// through to the inbound dispatcher) and `false` otherwise.
    ///
    /// Distinguishing responses from inbound requests on the same channel
    /// is the classic JSON-RPC bidirectional ambiguity: both carry `id`.
    /// We resolve it by membership-in-pending and presence of `result`/
    /// `error`. A line with an unknown id and a result/error is dropped
    /// (likely a late response after a timeout — informational only).
    public func handleResponseLine(_ line: String) -> Bool {
        guard let data = line.data(using: .utf8),
              let raw = try? JSONSerialization.jsonObject(with: data),
              let obj = raw as? [String: Any] else {
            return false
        }
        guard let idValue = obj["id"] else {
            return false
        }
        // Normalize id to String; Electron's BridgeDaemonClient does the same.
        let idString: String
        if let s = idValue as? String {
            idString = s
        } else if let n = idValue as? NSNumber {
            idString = n.stringValue
        } else {
            return false
        }
        let hasResult = obj.keys.contains("result")
        let hasError = obj.keys.contains("error")
        guard hasResult || hasError else {
            // No result/error → this is an inbound request, not a response.
            return false
        }
        lock.lock()
        let resolver = pending[idString]
        lock.unlock()
        guard let resolver else {
            // Either a duplicate response, or a response after timeout. Drop.
            return hasResult || hasError
        }
        if hasError, let errorPayload = obj["error"] as? [String: Any] {
            let code = (errorPayload["code"] as? Int) ?? -32000
            let message = (errorPayload["message"] as? String) ?? "Remote error"
            // Re-encode the error's `data` subtree if present so consumers
            // can inspect structured error info.
            let dataJSON: Data? = errorPayload["data"].flatMap { payload in
                try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
            }
            resolver(.failure(RequesterError.remote(code: code, message: message, dataJSON: dataJSON)))
        } else {
            // Re-encode the result subtree to Data so the awaiter receives
            // a Sendable value across the resume boundary.
            let resultValue: Any = obj["result"] ?? NSNull()
            // Wrap non-container scalars so JSONSerialization can encode them
            // (the framework rejects top-level non-container values until
            // we ask for the `.fragmentsAllowed` writing option).
            if let resultData = try? JSONSerialization.data(
                withJSONObject: resultValue,
                options: [.sortedKeys, .fragmentsAllowed]
            ) {
                resolver(.success(resultData))
            } else {
                resolver(.failure(RequesterError.encodingFailed))
            }
        }
        return true
    }

    /// Cancel all pending outbound requests. Called when the daemon is
    /// shutting down (parent process gone, stdin closed) so awaiting tasks
    /// see a structured error instead of hanging until their timeout fires.
    public func shutdown() {
        lock.lock()
        let snapshot = pending
        pending.removeAll()
        lock.unlock()
        for (_, resolver) in snapshot {
            resolver(.failure(RequesterError.daemonShuttingDown(method: "?")))
        }
    }

    /// Number of in-flight outbound requests. For diagnostics only.
    public func pendingCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return pending.count
    }
}
