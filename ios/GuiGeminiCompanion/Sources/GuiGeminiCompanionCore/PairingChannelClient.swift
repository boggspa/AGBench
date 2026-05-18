import Foundation
@preconcurrency import Network
import BridgeCryptoPairing

/// PairingChannelClient — iOS-side TCP transport for the QR pairing
/// handshake. Discovers the Mac's Bonjour-advertised pairing service,
/// connects, ships a `PairingResponsePayload`, and awaits the Mac's
/// echoed confirmation code.
///
/// Wire protocol (length-prefixed JSON frames over TCP):
///   - Client → Server: 4-byte big-endian length, then UTF-8 JSON of
///     `PairingResponsePayload`.
///   - Server → Client: 4-byte big-endian length, then UTF-8 JSON of
///     `{macConfirmationCode, sessionID}`.
///   - Client → Server (after user confirms codes match): 4-byte BE
///     length, then UTF-8 JSON of `{accepted, message?}`.
///   - Connection closes after the final accept/reject.
///
/// The matching Mac-side `PairingChannelListener` is a separate Swift
/// daemon slice (TODO). Until that ships, this client can be tested
/// against a `NWListener`-backed in-process fixture (see the test file).
///
/// State model — two-step API rather than a fine-grained state machine:
///   1. `attemptPairing(response:)` does discovery + connect + send +
///      receive-code in one go. Returns the Mac's confirmation code so
///      the iOS view model can surface it for user verification.
///   2. `sendFinalDecision(accepted:)` sends the user's accept/reject
///      back over the same connection and tears down.
/// `cancel()` aborts the connection at any point.
public protocol PairingChannelTransport: Sendable {
    func attemptPairing(response: PairingResponsePayload) async throws -> PairingChannelClient.PairingReply
    func sendFinalDecision(accepted: Bool, message: String?) async throws
    func sendFinalDecisionAndWaitForDesktop(accepted: Bool, message: String?) async throws -> PairingChannelClient.DesktopFinalDecision
    func cancel() async
}

public typealias PairingChannelTransportFactory = @Sendable (PairingChannelClient.Configuration) -> any PairingChannelTransport

public actor PairingChannelClient: PairingChannelTransport {
    public enum PairingChannelError: Error, CustomStringConvertible, Sendable {
        case discoveryFailed(String)
        case connectionFailed(String)
        case sendFailed(String)
        case receiveFailed(String)
        case malformedReply(String)
        case alreadyInProgress
        case notConnected
        case timedOut
        case canceled

        public var description: String {
            switch self {
            case .discoveryFailed(let s): return "Discovery failed: \(s)"
            case .connectionFailed(let s): return "Connection failed: \(s)"
            case .sendFailed(let s): return "Send failed: \(s)"
            case .receiveFailed(let s): return "Receive failed: \(s)"
            case .malformedReply(let s): return "Malformed reply: \(s)"
            case .alreadyInProgress: return "Pairing already in progress"
            case .notConnected: return "Not connected — call attemptPairing first"
            case .timedOut: return "Pairing timed out"
            case .canceled: return "Pairing was canceled"
            }
        }
    }

    public struct Configuration: Sendable {
        public let bonjourServiceName: String
        /// Optional explicit endpoint — if provided, skips Bonjour discovery
        /// and connects directly. Used by tests against an in-process
        /// NWListener whose port is known up-front.
        public let directEndpoint: NWEndpoint?
        public let connectionTimeout: TimeInterval
        public let receiveTimeout: TimeInterval

        public init(
            bonjourServiceName: String,
            directEndpoint: NWEndpoint? = nil,
            connectionTimeout: TimeInterval = 10,
            receiveTimeout: TimeInterval = 30
        ) {
            self.bonjourServiceName = bonjourServiceName
            self.directEndpoint = directEndpoint
            self.connectionTimeout = connectionTimeout
            self.receiveTimeout = receiveTimeout
        }
    }

    public struct PairingReply: Sendable, Equatable {
        public let macConfirmationCode: String
        public let sessionID: String
    }

    public struct DesktopFinalDecision: Sendable, Codable, Equatable {
        public let accepted: Bool
        public let message: String?

        public init(accepted: Bool, message: String? = nil) {
            self.accepted = accepted
            self.message = message
        }
    }

    public struct FinalDecisionMessage: Sendable, Codable, Equatable {
        public let accepted: Bool
        public let message: String?
        public init(accepted: Bool, message: String? = nil) {
            self.accepted = accepted
            self.message = message
        }
    }

    private let configuration: Configuration
    private var connection: NWConnection?
    private var browser: NWBrowser?
    private var inProgress: Bool = false

    public init(configuration: Configuration) {
        self.configuration = configuration
    }

    /// Step 1: connect to the Mac's pairing service and ship the response.
    /// Returns the Mac's echoed confirmation code for user verification.
    public func attemptPairing(response: PairingResponsePayload) async throws -> PairingReply {
        guard !inProgress else { throw PairingChannelError.alreadyInProgress }
        inProgress = true

        let endpoint: NWEndpoint
        if let direct = configuration.directEndpoint {
            endpoint = direct
        } else {
            endpoint = try await discoverEndpoint(serviceName: configuration.bonjourServiceName)
        }

        let connection = try await openConnection(to: endpoint)
        self.connection = connection

        // Send the response payload.
        let encoder = JSONEncoder()
        encoder.dataEncodingStrategy = .base64
        encoder.dateEncodingStrategy = .iso8601
        let responseBytes: Data
        do {
            responseBytes = try encoder.encode(response)
        } catch {
            await tearDown()
            throw PairingChannelError.sendFailed("Failed to encode response: \(error.localizedDescription)")
        }
        try await sendFrame(responseBytes, on: connection)

        // Await the Mac's reply with the confirmation code.
        let replyBytes: Data
        do {
            replyBytes = try await receiveFrame(on: connection)
        } catch {
            await tearDown()
            throw error
        }
        guard
            let object = try? JSONSerialization.jsonObject(with: replyBytes) as? [String: Any],
            let code = object["macConfirmationCode"] as? String,
            let sessionID = object["sessionID"] as? String
        else {
            await tearDown()
            throw PairingChannelError.malformedReply("Reply did not include macConfirmationCode + sessionID")
        }
        return PairingReply(macConfirmationCode: code, sessionID: sessionID)
    }

    /// Step 2: tell the Mac whether the user confirmed the codes match.
    /// Closes the connection after sending.
    public func sendFinalDecision(accepted: Bool, message: String? = nil) async throws {
        guard let connection else { throw PairingChannelError.notConnected }
        try await sendFinalDecisionFrame(accepted: accepted, message: message, on: connection)
        await tearDown()
    }

    /// Step 2 with desktop acknowledgement: send the iOS user's local
    /// decision, then wait for the Mac-side desktop confirmation result
    /// on the same TCP connection.
    public func sendFinalDecisionAndWaitForDesktop(
        accepted: Bool,
        message: String? = nil
    ) async throws -> DesktopFinalDecision {
        guard let connection else { throw PairingChannelError.notConnected }
        do {
            try await sendFinalDecisionFrame(accepted: accepted, message: message, on: connection)
            let replyBytes = try await receiveFrame(on: connection)
            let decision = try JSONDecoder().decode(DesktopFinalDecision.self, from: replyBytes)
            await tearDown()
            return decision
        } catch {
            await tearDown()
            if let channelError = error as? PairingChannelError {
                throw channelError
            }
            throw PairingChannelError.malformedReply("Desktop final decision could not be decoded: \(error.localizedDescription)")
        }
    }

    /// Cancel the in-flight pairing. Idempotent.
    public func cancel() async {
        await tearDown()
    }

    // MARK: - Helpers

    private func tearDown() async {
        browser?.cancel()
        browser = nil
        connection?.cancel()
        connection = nil
        inProgress = false
    }

    private func discoverEndpoint(serviceName: String) async throws -> NWEndpoint {
        let flag = OneShotFlag()
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<NWEndpoint, Error>) in
            let descriptor = NWBrowser.Descriptor.bonjour(type: serviceName, domain: nil)
            let browser = NWBrowser(for: descriptor, using: .tcp)
            self.browser = browser
            browser.browseResultsChangedHandler = { [weak self] results, _ in
                guard let first = results.first else { return }
                guard flag.tryResolve() else { return }
                continuation.resume(returning: first.endpoint)
                Task { [weak self] in
                    await self?.shutdownBrowser()
                }
            }
            browser.stateUpdateHandler = { state in
                if case .failed(let error) = state, flag.tryResolve() {
                    continuation.resume(throwing: PairingChannelError.discoveryFailed(error.localizedDescription))
                }
            }
            browser.start(queue: .global())
            // Discovery timeout watchdog.
            Task { [weak self, timeout = self.configuration.connectionTimeout] in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                guard flag.tryResolve() else { return }
                continuation.resume(throwing: PairingChannelError.timedOut)
                await self?.shutdownBrowser()
            }
        }
    }

    private func shutdownBrowser() {
        browser?.cancel()
        browser = nil
    }

    private func openConnection(to endpoint: NWEndpoint) async throws -> NWConnection {
        let flag = OneShotFlag()
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<NWConnection, Error>) in
            let connection = NWConnection(to: endpoint, using: .tcp)
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if flag.tryResolve() {
                        continuation.resume(returning: connection)
                    }
                case .failed(let error):
                    if flag.tryResolve() {
                        continuation.resume(throwing: PairingChannelError.connectionFailed(error.localizedDescription))
                        connection.cancel()
                    }
                case .cancelled:
                    if flag.tryResolve() {
                        continuation.resume(throwing: PairingChannelError.canceled)
                    }
                default:
                    break
                }
            }
            connection.start(queue: .global())
            Task { [timeout = self.configuration.connectionTimeout] in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                if flag.tryResolve() {
                    continuation.resume(throwing: PairingChannelError.timedOut)
                    connection.cancel()
                }
            }
        }
    }

    private func sendFrame(_ payload: Data, on connection: NWConnection) async throws {
        // 4-byte BE length prefix + payload bytes.
        var length = UInt32(payload.count).bigEndian
        var frame = Data(bytes: &length, count: 4)
        frame.append(payload)
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.send(content: frame, completion: .contentProcessed { error in
                if let error {
                    continuation.resume(throwing: PairingChannelError.sendFailed(error.localizedDescription))
                } else {
                    continuation.resume()
                }
            })
        }
    }

    private func sendFinalDecisionFrame(
        accepted: Bool,
        message: String?,
        on connection: NWConnection
    ) async throws {
        let payload = FinalDecisionMessage(accepted: accepted, message: message)
        let bytes: Data
        do {
            bytes = try JSONEncoder().encode(payload)
        } catch {
            throw PairingChannelError.sendFailed("Failed to encode final decision: \(error.localizedDescription)")
        }
        try await sendFrame(bytes, on: connection)
    }

    private func receiveFrame(on connection: NWConnection) async throws -> Data {
        let lengthBytes = try await receiveExact(4, on: connection)
        let length = try decodeFrameLength(lengthBytes)
        guard length > 0, length < 1_048_576 else {
            throw PairingChannelError.malformedReply("Frame length \(length) out of bounds")
        }
        return try await receiveExact(Int(length), on: connection)
    }

    private func decodeFrameLength(_ bytes: Data) throws -> UInt32 {
        guard bytes.count == 4 else {
            throw PairingChannelError.receiveFailed("Expected 4-byte frame length, got \(bytes.count)")
        }
        return bytes.reduce(UInt32(0)) { partial, byte in
            (partial << 8) | UInt32(byte)
        }
    }

    private func receiveExact(_ count: Int, on connection: NWConnection) async throws -> Data {
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
            connection.receive(minimumIncompleteLength: count, maximumLength: count) { data, _, _, error in
                if let error {
                    continuation.resume(throwing: PairingChannelError.receiveFailed(error.localizedDescription))
                } else if let data, data.count == count {
                    continuation.resume(returning: data)
                } else {
                    continuation.resume(throwing: PairingChannelError.receiveFailed("Connection closed before \(count) bytes arrived"))
                }
            }
        }
    }
}

/// Thread-safe one-shot resolution flag. Used to coordinate
/// continuation.resume() calls from multiple Network framework
/// callbacks (state update, browse-results, timeout watchdog) so
/// exactly one wins. Swift 6 strict concurrency rejects mutable-`var`
/// captures across @Sendable closures; this class wraps the mutation
/// behind a lock so it can be `@unchecked Sendable`.
private final class OneShotFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var resolved = false

    /// Returns `true` exactly once — the caller that gets `true` is
    /// responsible for resolving the continuation. Subsequent calls
    /// return `false` and the caller drops the event.
    func tryResolve() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if resolved { return false }
        resolved = true
        return true
    }
}
