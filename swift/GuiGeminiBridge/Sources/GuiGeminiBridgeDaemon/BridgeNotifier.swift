import Foundation

/// Thread-safe JSON-RPC 2.0 notification publisher.
///
/// Transport handlers in `TransportListener` are `@Sendable` closures that can
/// fire from arbitrary actors / threads. They need to push events back to
/// Electron via stdout, but stdout writes from multiple threads need to be
/// serialized or messages will interleave mid-line. This class wraps
/// `BridgeStdoutWriter.writeLine` so the daemon's JSON-RPC framing (one
/// envelope per `\n`-terminated line) is preserved no matter how many
/// handlers fire concurrently.
///
/// Phase C3-late only sends notifications outbound (daemon → Electron); the
/// new Phase C3.5 `BridgeRequester` adds request-response correlation on top
/// of the same writer. Sharing the stdout writer between the two means a
/// notification can never split a request line in half.
public final class BridgeNotifier: @unchecked Sendable {
    private let writer: BridgeStdoutWriter
    private let encoder: JSONEncoder

    public init(writer: BridgeStdoutWriter) {
        self.writer = writer
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        encoder.dataEncodingStrategy = .base64
        self.encoder = encoder
    }

    /// Publish a notification with already-serialized JSON-compatible params.
    /// The `Any` type matches what the dispatcher's handlers return — a
    /// Foundation tree (Dictionary/Array/scalars). Use `publishCodable(...)`
    /// when you have a `Encodable` value instead.
    ///
    /// JSON serialization runs on the caller's thread so the writer's queue
    /// only handles the stdout write itself — that's the part that actually
    /// needs to be serialized to preserve line framing across concurrent
    /// publishers.
    public func publish(method: String, params: Any) {
        let envelope: [String: Any] = [
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys]),
              let line = String(data: data, encoding: .utf8) else {
            return
        }
        writer.writeLine(line)
    }

    /// Publish a notification whose params is a typed `Encodable`. Errors
    /// (e.g. circular references) are silently dropped — notifications are
    /// fire-and-forget by JSON-RPC contract, and surfacing the error would
    /// require turning this into a throwing API that handlers would have to
    /// branch on.
    public func publishCodable<T: Encodable>(method: String, params: T) {
        guard let data = try? encoder.encode(params),
              let object = try? JSONSerialization.jsonObject(with: data) else {
            return
        }
        publish(method: method, params: object)
    }
}
