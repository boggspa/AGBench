// Headless phone for the live Swift↔Node interop e2e (T4d).
//
// The Node harness (ios/interop/swift-node.e2e.test.ts) boots a real relay +
// RemoteBridgeRuntime, begins pairing, and spawns this CLI with the bootstrap
// JSON as argv[1]. This drives the REAL RelayTransportClient (CryptoKit) against
// it over real WebSockets and emits machine-parseable lines on stdout:
//
//   CONFIRM <code>     the handshake confirm code (Node asserts it matches)
//   SNAPSHOT ok        received bridge.broadcastRemoteProjectionSnapshot
//   ACK <true|false>   result of an allowlisted cancelRun action
//   RECONNECT ok       re-established after a hard drop (trusted, no re-pair)
//   DONE               success → exit 0
//   ERR <message>      failure → exit 1

import Foundation
import CryptoKit
import TaskWraithKit

func emit(_ line: String) {
    print(line)
    fflush(stdout)
}

/// Progress notes to stderr (surfaced by the Node driver on failure).
func note(_ line: String) {
    FileHandle.standardError.write(Data("[cli] \(line)\n".utf8))
}

func fail(_ message: String) -> Never {
    emit("ERR \(message)")
    exit(1)
}

@main
struct InteropCLI {
    static func main() async {
        guard CommandLine.arguments.count >= 2,
            let bootstrapData = CommandLine.arguments[1].data(using: .utf8),
            let bootstrap = try? JSONDecoder().decode(
                PairingBootstrapPayload.self, from: bootstrapData)
        else { fail("missing or invalid bootstrap argv[1]") }

        let seed = Curve25519.Signing.PrivateKey().rawRepresentation
        guard let client = try? RelayTransportClient(identitySeed: seed) else {
            fail("could not build transport client")
        }

        // Consume the event stream on a background task: surface the confirm
        // code and snapshot, ignore everything else.
        let snapshotSeen = SnapshotFlag()
        let eventTask = Task {
            for await event in await client.events {
                switch event {
                case .confirmCode(let code):
                    note("event confirmCode \(code)")
                    emit("CONFIRM \(code)")
                case .established: note("event established")
                case .message(let method, _):
                    note("event message \(method)")
                    if method == "bridge.broadcastRemoteProjectionSnapshot" {
                        if await snapshotSeen.markAndCheckFirst() { emit("SNAPSHOT ok") }
                    }
                case .error(let message):
                    note("event error \(message)")
                    emit("EVT-ERR \(message)")
                case .closed: note("event closed")
                }
            }
        }

        do {
            note("scanning bootstrap session=\(bootstrap.sessionId) relay=\(bootstrap.relayUrl)")
            try await client.scan(bootstrap)
            note("connecting…")
            try await client.connectAndWaitEstablished(timeoutMs: 10000)
            note("established")

            // Give the post-establish snapshot a moment to arrive.
            try await waitUntil(timeoutMs: 5000) { await snapshotSeen.value }

            // Allowlisted action → expect accepted.
            let ack = try await client.request(
                "bridge.requestActionAck",
                params: BridgeAction.cancelRun(
                    provider: "claude", runId: "run-interop", workspaceId: "ws-allowed",
                    threadId: "thread-1"),
                timeoutMs: 10000)
            emit("ACK \(ack.ok)")

            // Hard drop + trusted reconnect (no re-pair).
            await client.dropConnection()
            try await Task.sleep(nanoseconds: 200_000_000)
            try await client.reconnect()
            try await client.waitForEstablished(timeoutMs: 10000)
            emit("RECONNECT ok")

            emit("DONE")
            eventTask.cancel()
            exit(0)
        } catch {
            eventTask.cancel()
            fail(String(describing: error))
        }
    }
}

actor SnapshotFlag {
    private(set) var value = false
    func markAndCheckFirst() -> Bool {
        let wasFirst = !value
        value = true
        return wasFirst
    }
}

func waitUntil(timeoutMs: Int, _ predicate: @Sendable () async -> Bool) async throws {
    let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000)
    while Date() < deadline {
        if await predicate() { return }
        try await Task.sleep(nanoseconds: 50_000_000)
    }
}
