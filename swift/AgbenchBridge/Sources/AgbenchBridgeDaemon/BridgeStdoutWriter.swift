import Foundation

/// Single serialized stdout sink for daemon → Electron framing.
///
/// The daemon writes three kinds of lines to stdout:
///   1. JSON-RPC 2.0 responses to inbound Electron requests (built by
///      `JSONRPCDispatcher` and emitted from the synchronous read loop).
///   2. JSON-RPC 2.0 notifications (emitted by `BridgeNotifier` from any
///      `@Sendable` handler closure).
///   3. JSON-RPC 2.0 requests (emitted by `BridgeRequester` when the daemon
///      needs to ask Electron something and await an answer).
///
/// All three need to use the same `\n`-terminated framing, and writes from
/// different threads must not interleave inside a single line. A single
/// serial `DispatchQueue` enforces that ordering without any caller-side
/// locking. Callers serialize their JSON encoding before handing the line
/// string off; only the `write` itself enters the queue.
public final class BridgeStdoutWriter: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.chrisizatt.agbench.daemon.stdout")

    public init() {}

    /// Fire-and-forget: enqueue a line write. Returns immediately. Used by
    /// notifier + requester so the caller's thread isn't blocked on I/O.
    public func writeLine(_ line: String) {
        let data = Data("\(line)\n".utf8)
        queue.async {
            FileHandle.standardOutput.write(data)
        }
    }

    /// Synchronous write — blocks the calling thread until the byte goes out.
    /// Used by the dispatch loop's response path so a response strictly
    /// precedes any notifications/requests the handler might have queued
    /// behind it. Also used for the daemon-hello announcement at startup
    /// (we want the hello on the wire before any other traffic).
    public func writeLineSync(_ line: String) {
        let data = Data("\(line)\n".utf8)
        queue.sync {
            FileHandle.standardOutput.write(data)
        }
    }

    /// Wait for all enqueued writes to complete. Used on daemon shutdown so
    /// the parent sees the final batch of responses/notifications on stdout
    /// before the pipe closes. Without this, a handler that emits a response
    /// right before EOF can lose its output to the abrupt process tear-down
    /// (and worse, occasionally trip a DispatchQueue runtime trap when work
    /// is queued during process exit).
    public func flush() {
        queue.sync {}
    }
}
