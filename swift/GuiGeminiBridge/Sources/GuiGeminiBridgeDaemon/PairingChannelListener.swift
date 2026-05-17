import Foundation
@preconcurrency import Network
import BridgeCore
import BridgeCryptoPairing

/// PairingChannelListener — Mac-side TCP listener for the iOS pairing
/// handshake.
///
/// Counterpart to `GuiGeminiCompanionCore.PairingChannelClient` on iOS.
/// Wire protocol (length-prefixed JSON frames, 4-byte BE length + payload):
///
///   1. Client (iPhone) → Server (Mac): `PairingResponsePayload` JSON
///   2. Server → Client: `{macConfirmationCode, sessionID}` JSON
///   3. Client → Server: `{accepted, message?}` JSON
///   4. Connection closes
///
/// The listener is unauthenticated by design — derived keys don't exist
/// until pairing completes. Security relies on:
///   - The session ID being unguessable (UUID minted by the Mac at
///     beginPairing and embedded in the QR).
///   - The 5-minute session lifetime (PairingCoordinator rejects expired
///     sessions).
///   - The 6-digit transcript confirmation code mismatching attempts —
///     an attacker who guesses a session ID can't produce a code that
///     matches what the user sees on the Mac.
///
/// Integration model: the listener publishes incoming responses on an
/// `AsyncStream`. `main.swift` consumes that stream, hands each response
/// to `PairingCoordinator.confirmPairing(...)` for code derivation,
/// emits a `bridge.didReceivePairingResponse` notification to Electron
/// (so the desktop UI can show the code), then calls
/// `sendConfirmationCode(...)` to forward the code to iOS.
///
/// When the user confirms/rejects on the desktop, Electron's
/// `bridge.finalizePairing` RPC fires; the daemon's handler calls
/// `sendFinalDecision(...)` to ship the result back over the still-open
/// TCP connection, which then closes.
public actor PairingChannelListener {
    public struct IncomingPairingResponse: Sendable {
        public let response: PairingResponsePayload
        public let sessionID: String
        public let receivedAt: Date
    }

    public enum ListenerError: Error, CustomStringConvertible, Sendable {
        case alreadyRunning
        case notRunning
        case listenerFailed(String)

        public var description: String {
            switch self {
            case .alreadyRunning: return "PairingChannelListener is already running"
            case .notRunning: return "PairingChannelListener is not running"
            case .listenerFailed(let s): return "NWListener failed: \(s)"
            }
        }
    }

    /// AsyncStream of incoming pairing responses. The dispatch loop in
    /// main.swift subscribes once at startup and processes each.
    public nonisolated let incomingResponses: AsyncStream<IncomingPairingResponse>
    private let incomingContinuation: AsyncStream<IncomingPairingResponse>.Continuation

    private let bonjourServiceType: String
    private let port: UInt16

    private var listener: NWListener?
    /// Per-session connection state: the still-open TCP connection
    /// from the iPhone, kept until `sendFinalDecision` writes the
    /// final frame and closes it.
    private var connectionsBySession: [String: NWConnection] = [:]

    public init(bonjourServiceType: String, port: UInt16 = 0) {
        self.bonjourServiceType = bonjourServiceType
        self.port = port
        var continuation: AsyncStream<IncomingPairingResponse>.Continuation!
        self.incomingResponses = AsyncStream(bufferingPolicy: .bufferingNewest(16)) {
            continuation = $0
        }
        self.incomingContinuation = continuation
    }

    public func start() async throws {
        if listener != nil { throw ListenerError.alreadyRunning }
        let parameters = NWParameters.tcp
        parameters.includePeerToPeer = true
        let nwPort: NWEndpoint.Port = port == 0 ? .any : (NWEndpoint.Port(rawValue: port) ?? .any)
        let nwListener: NWListener
        do {
            nwListener = try NWListener(using: parameters, on: nwPort)
        } catch {
            throw ListenerError.listenerFailed(error.localizedDescription)
        }
        // Advertise via Bonjour so the iPhone's NWBrowser can find us.
        nwListener.service = NWListener.Service(type: bonjourServiceType, domain: nil)
        nwListener.newConnectionHandler = { [weak self] connection in
            Task { [weak self] in
                await self?.accept(connection: connection)
            }
        }
        let flag = OneShotListenerFlag()
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            nwListener.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if flag.tryResolve() {
                        continuation.resume()
                    }
                case .failed(let error):
                    if flag.tryResolve() {
                        nwListener.cancel()
                        continuation.resume(throwing: ListenerError.listenerFailed(error.localizedDescription))
                    }
                default:
                    break
                }
            }
            nwListener.start(queue: .global())
            // Bound startup time so we don't wait forever on a misconfigured port.
            Task { [nwListener] in
                try? await Task.sleep(nanoseconds: 5 * 1_000_000_000)
                if flag.tryResolve() {
                    nwListener.cancel()
                    continuation.resume(throwing: ListenerError.listenerFailed("Listener never reached .ready state within 5s"))
                }
            }
        }
        self.listener = nwListener
        if let port = nwListener.port?.rawValue {
            logPairingPipeline("pairing listener ready port=\(port) service=\(bonjourServiceType)")
        } else {
            logPairingPipeline("pairing listener ready service=\(bonjourServiceType)")
        }
    }

    public func stop() async {
        listener?.cancel()
        listener = nil
        for (_, connection) in connectionsBySession {
            connection.cancel()
        }
        connectionsBySession.removeAll()
    }

    /// Read-only port the listener bound to (after `start()`). Useful
    /// for diagnostics + tests that need to dial the listener directly.
    public func boundPort() -> UInt16? {
        guard let port = listener?.port else { return nil }
        return port.rawValue
    }

    /// Send the Mac's computed confirmation code over the iPhone's
    /// connection. Called after `PairingCoordinator.confirmPairing(...)`
    /// returns the code.
    public func sendConfirmationCode(sessionID: String, code: String) async {
        guard let connection = connectionsBySession[sessionID] else {
            logPairingPipeline("confirmation code send skipped session=\(sessionID) reason=missing-connection")
            return
        }
        let payload: [String: Any] = [
            "macConfirmationCode": code,
            "sessionID": sessionID
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else {
            logPairingPipeline("confirmation code send failed session=\(sessionID) reason=encode-failed")
            return
        }
        logPairingPipeline("sending confirmation code to iOS session=\(sessionID) code=\(code)")
        if let error = await writeFrame(data, on: connection) {
            logPairingPipeline("confirmation code send failed session=\(sessionID) error=\(error.localizedDescription)")
        } else {
            logPairingPipeline("confirmation code sent to iOS session=\(sessionID)")
        }
    }

    /// Send the final accept/reject + tear down the connection. Called
    /// after the user confirms/rejects in the desktop UI and
    /// `bridge.finalizePairing` has run on the coordinator.
    public func sendFinalDecision(sessionID: String, accepted: Bool, message: String? = nil) async {
        guard let connection = connectionsBySession[sessionID] else { return }
        var payload: [String: Any] = ["accepted": accepted]
        if let message {
            payload["message"] = message
        }
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) {
            _ = await writeFrame(data, on: connection)
        }
        connection.cancel()
        connectionsBySession.removeValue(forKey: sessionID)
    }

    // MARK: - Connection handling

    private func accept(connection: NWConnection) async {
        logPairingPipeline("TCP pairing connection accepted")
        connection.start(queue: .global())
        do {
            let lengthBytes = try await receiveExact(4, on: connection)
            let length = try decodeFrameLength(lengthBytes)
            logPairingPipeline("iPad response frame length=\(length)")
            guard length > 0, length < 1_048_576 else {
                logPairingPipeline("iPad response rejected reason=frame-length-out-of-bounds length=\(length)")
                connection.cancel()
                return
            }
            let payloadBytes = try await receiveExact(Int(length), on: connection)
            logPairingPipeline("iPad response payload received bytes=\(payloadBytes.count)")
            let decoder = JSONDecoder()
            decoder.dataDecodingStrategy = .base64
            decoder.dateDecodingStrategy = .iso8601
            let response = try decoder.decode(PairingResponsePayload.self, from: payloadBytes)
            logPairingPipeline("iPad response decoded session=\(response.pairingSessionID) controller=\(response.controllerDeviceID.rawValue) displayName=\(response.controllerDisplayName)")
            connectionsBySession[response.pairingSessionID] = connection
            incomingContinuation.yield(IncomingPairingResponse(
                response: response,
                sessionID: response.pairingSessionID,
                receivedAt: Date()
            ))
            logPairingPipeline("iPad response yielded to coordinator session=\(response.pairingSessionID)")
            // Hand off — the consumer reads from incomingResponses, calls
            // sendConfirmationCode + later sendFinalDecision. The connection
            // stays open in connectionsBySession until then.
            //
            // Spawn a reader to detect when the iPhone sends its
            // accept/reject frame back. That feeds into the main loop's
            // finalize wait.
            Task { [weak self] in
                await self?.readFinalDecision(from: connection, sessionID: response.pairingSessionID)
            }
        } catch {
            logPairingPipeline("iPad response handling failed error=\(error.localizedDescription)")
            connection.cancel()
        }
    }

    /// Read the iPhone's final-decision frame (accept/reject). The Mac
    /// already received the user's decision via Electron's UI, but the
    /// iOS-side may have its own user verification step — we read this
    /// for diagnostic completeness and to detect early closure.
    private func readFinalDecision(from connection: NWConnection, sessionID: String) async {
        do {
            let lengthBytes = try await receiveExact(4, on: connection)
            let length = try decodeFrameLength(lengthBytes)
            guard length > 0, length < 65_536 else { return }
            _ = try await receiveExact(Int(length), on: connection)
            // The Mac doesn't act on the iPhone's decision frame —
            // user authority for finalize lives on the desktop. We
            // just consume + log the frame for now.
            FileHandle.standardError.write(Data(
                "[PairingChannelListener] received iOS final-decision frame for session \(sessionID)\n".utf8
            ))
        } catch {
            // Connection closed before frame arrived — that's fine,
            // the user may have closed the iPhone app.
        }
    }

    private func writeFrame(_ payload: Data, on connection: NWConnection) async -> Error? {
        var length = UInt32(payload.count).bigEndian
        var frame = Data(bytes: &length, count: 4)
        frame.append(payload)
        return await withCheckedContinuation { (continuation: CheckedContinuation<Error?, Never>) in
            connection.send(content: frame, completion: .contentProcessed { error in
                continuation.resume(returning: error)
            })
        }
    }

    private func receiveExact(_ count: Int, on connection: NWConnection) async throws -> Data {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
            connection.receive(minimumIncompleteLength: count, maximumLength: count) { data, _, _, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let data, data.count == count {
                    continuation.resume(returning: data)
                } else {
                    continuation.resume(throwing: NSError(
                        domain: "PairingChannelListener",
                        code: 1,
                        userInfo: [NSLocalizedDescriptionKey: "Connection closed before \(count) bytes arrived"]
                    ))
                }
            }
        }
    }
}

func logPairingPipeline(_ message: String) {
    FileHandle.standardError.write(Data("[Pairing pipeline] \(message)\n".utf8))
}

func decodeFrameLength(_ data: Data) throws -> UInt32 {
    guard data.count == 4 else {
        throw NSError(
            domain: "PairingChannelListener",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Expected 4 frame length bytes, got \(data.count)"]
        )
    }
    return data.reduce(UInt32(0)) { partial, byte in
        (partial << 8) | UInt32(byte)
    }
}

/// Single-use coordination flag for NWListener startup (mirror of the
/// iOS client's `OneShotFlag` pattern). Required because Swift 6 strict
/// concurrency forbids `var` mutation across `@Sendable` callbacks.
/// The first caller to `tryResolve()` gets `true` and is responsible for
/// resuming the continuation; subsequent calls return `false`.
private final class OneShotListenerFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var resolved = false

    func tryResolve() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if resolved { return false }
        resolved = true
        return true
    }
}
