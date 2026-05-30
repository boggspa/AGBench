import XCTest
import Foundation
@preconcurrency import Network
import CryptoKit
import BridgeCore
import BridgeCryptoPrimitives
import BridgeCryptoPairing
@testable import GuiGeminiCompanionCore

/// Thread-safe holder used to safely capture state across Network
/// framework callbacks (each fired on its own queue) without Swift 6
/// strict-concurrency complaints.
private final class TestStateHolder<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var _value: T?
    func set(_ value: T) {
        lock.lock()
        defer { lock.unlock() }
        _value = value
    }
    var value: T? {
        lock.lock()
        defer { lock.unlock() }
        return _value
    }
}

/// Integration tests that spin up an in-process `NWListener` acting as
/// the Mac-side pairing channel listener. These exercise the full
/// client wire protocol — frame encoding, send, receive — without
/// requiring a real Mac on the network.
@MainActor
final class PairingChannelClientTests: XCTestCase {
    private var listener: NWListener?

    override func tearDown() async throws {
        listener?.cancel()
        listener = nil
        try await super.tearDown()
    }

    /// Build a `PairingResponsePayload` shape we can ship over the
    /// channel. The values don't have to derive cleanly — we're testing
    /// the wire framing, not the crypto.
    private func sampleResponse() -> PairingResponsePayload {
        let identity = DeviceIdentitySigningKey()
        let ephemeralKey = P256.KeyAgreement.PrivateKey()
        return PairingResponsePayload(
            pairingSessionID: "session-1",
            controllerDeviceID: DeviceID("iphone-1"),
            controllerDisplayName: "Test Phone",
            controllerIdentityPublicKey: identity.publicKeyRawRepresentation,
            controllerEphemeralPublicKey: ephemeralKey.publicKey.rawRepresentation,
            controllerNonce: Data((0..<32).map { _ in 0x42 }),
            signature: nil
        )
    }

    /// Start an NWListener on a random local port. The handler accepts
    /// one connection, reads the first length-prefixed frame (the
    /// response), and replies with a fixed confirmation code. The
    /// `onResponse` callback receives the decoded response bytes for
    /// test assertions; `onDecision` receives the optional second
    /// frame if the client calls `sendFinalDecision`.
    private func startListener(
        macConfirmationCode: String = "123456",
        sessionID: String = "session-1",
        responseHolder: TestStateHolder<Data> = TestStateHolder(),
        decisionHolder: TestStateHolder<Data> = TestStateHolder(),
        desktopFinalDecision: PairingChannelClient.DesktopFinalDecision? = nil
    ) throws -> NWEndpoint.Port {
        let parameters = NWParameters.tcp
        parameters.acceptLocalOnly = true
        let listener = try NWListener(using: parameters)
        listener.newConnectionHandler = { [responseHolder, decisionHolder, desktopFinalDecision] connection in
            connection.start(queue: .global())
            connection.receive(minimumIncompleteLength: 4, maximumLength: 4) { lengthBytes, _, _, _ in
                guard let lengthBytes else { return }
                let length = lengthBytes.withUnsafeBytes { $0.load(as: UInt32.self) }.bigEndian
                connection.receive(minimumIncompleteLength: Int(length), maximumLength: Int(length)) { payload, _, _, _ in
                    guard let payload else { return }
                    responseHolder.set(payload)
                    let reply = try! JSONSerialization.data(withJSONObject: [
                        "macConfirmationCode": macConfirmationCode,
                        "sessionID": sessionID
                    ], options: [.sortedKeys])
                    var replyLength = UInt32(reply.count).bigEndian
                    var frame = Data(bytes: &replyLength, count: 4)
                    frame.append(reply)
                    connection.send(content: frame, completion: .contentProcessed { _ in
                        connection.receive(minimumIncompleteLength: 4, maximumLength: 4) { decisionLenBytes, _, _, _ in
                            guard let decisionLenBytes else { return }
                            let decisionLength = decisionLenBytes.withUnsafeBytes { $0.load(as: UInt32.self) }.bigEndian
                            connection.receive(minimumIncompleteLength: Int(decisionLength), maximumLength: Int(decisionLength)) { decisionPayload, _, _, _ in
                                guard let decisionPayload else { return }
                                decisionHolder.set(decisionPayload)
                                guard let desktopFinalDecision else {
                                    connection.cancel()
                                    return
                                }
                                let desktopReply = try! JSONEncoder().encode(desktopFinalDecision)
                                var desktopReplyLength = UInt32(desktopReply.count).bigEndian
                                var desktopFrame = Data(bytes: &desktopReplyLength, count: 4)
                                desktopFrame.append(desktopReply)
                                connection.send(content: desktopFrame, completion: .contentProcessed { _ in
                                    connection.cancel()
                                })
                            }
                        }
                    })
                }
            }
        }
        let portHolder = TestStateHolder<NWEndpoint.Port>()
        let semaphore = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { [listener] state in
            if case .ready = state {
                if let port = listener.port {
                    portHolder.set(port)
                }
                semaphore.signal()
            }
        }
        listener.start(queue: .global())
        _ = semaphore.wait(timeout: .now() + .seconds(5))
        guard let port = portHolder.value else {
            listener.cancel()
            throw NSError(domain: "PairingChannelClientTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "listener never reached .ready"])
        }
        self.listener = listener
        return port
    }

    func testRoundTripWithDirectEndpointReturnsCode() async throws {
        let responseHolder = TestStateHolder<Data>()
        let port = try startListener(
            macConfirmationCode: "654321",
            sessionID: "session-X",
            responseHolder: responseHolder
        )
        let client = PairingChannelClient(configuration: PairingChannelClient.Configuration(
            bonjourServiceName: "_unused._tcp",
            directEndpoint: .hostPort(host: "localhost", port: port),
            connectionTimeout: 3,
            receiveTimeout: 3
        ))
        let response = sampleResponse()
        let reply = try await client.attemptPairing(response: response)
        XCTAssertEqual(reply.macConfirmationCode, "654321")
        XCTAssertEqual(reply.sessionID, "session-X")
        // The listener must have received bytes shaped like the response.
        XCTAssertNotNil(responseHolder.value)
        let decoded = try? JSONSerialization.jsonObject(with: responseHolder.value!) as? [String: Any]
        XCTAssertEqual(decoded?["pairingSessionID"] as? String, "session-1")
    }

    func testFinalDecisionFrameIsSent() async throws {
        let decisionHolder = TestStateHolder<Data>()
        let port = try startListener(decisionHolder: decisionHolder)
        let client = PairingChannelClient(configuration: PairingChannelClient.Configuration(
            bonjourServiceName: "_unused._tcp",
            directEndpoint: .hostPort(host: "localhost", port: port)
        ))
        _ = try await client.attemptPairing(response: sampleResponse())
        try await client.sendFinalDecision(accepted: true, message: "user verified")
        // Allow the listener's receive callback a moment to fire.
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertNotNil(decisionHolder.value)
        let decoded = try? JSONDecoder().decode(PairingChannelClient.FinalDecisionMessage.self, from: decisionHolder.value!)
        XCTAssertEqual(decoded?.accepted, true)
        XCTAssertEqual(decoded?.message, "user verified")
    }

    func testFinalDecisionCanWaitForDesktopAcknowledgement() async throws {
        let port = try startListener(desktopFinalDecision: PairingChannelClient.DesktopFinalDecision(
            accepted: true,
            message: nil,
            pairID: "pair-from-mac"
        ))
        let client = PairingChannelClient(configuration: PairingChannelClient.Configuration(
            bonjourServiceName: "_unused._tcp",
            directEndpoint: .hostPort(host: "localhost", port: port)
        ))
        _ = try await client.attemptPairing(response: sampleResponse())
        let decision = try await client.sendFinalDecisionAndWaitForDesktop(accepted: true, message: nil)
        XCTAssertEqual(decision, PairingChannelClient.DesktopFinalDecision(
            accepted: true,
            message: nil,
            pairID: "pair-from-mac"
        ))
    }

    func testSendFinalDecisionBeforeAttemptPairingThrows() async throws {
        let client = PairingChannelClient(configuration: PairingChannelClient.Configuration(
            bonjourServiceName: "_unused._tcp",
            directEndpoint: .hostPort(host: "localhost", port: 1)
        ))
        do {
            try await client.sendFinalDecision(accepted: true)
            XCTFail("expected notConnected error")
        } catch let error as PairingChannelClient.PairingChannelError {
            guard case .notConnected = error else {
                XCTFail("expected .notConnected, got \(error)")
                return
            }
        }
    }

    func testConnectionToInvalidEndpointFails() async throws {
        let client = PairingChannelClient(configuration: PairingChannelClient.Configuration(
            // Port 1 is privileged + closed; connection should be refused quickly.
            bonjourServiceName: "_unused._tcp",
            directEndpoint: .hostPort(host: "127.0.0.1", port: 1),
            connectionTimeout: 2
        ))
        do {
            _ = try await client.attemptPairing(response: sampleResponse())
            XCTFail("expected connection failure")
        } catch let error as PairingChannelClient.PairingChannelError {
            // Either connectionFailed or timedOut depending on OS behavior.
            switch error {
            case .connectionFailed, .timedOut:
                return
            default:
                XCTFail("unexpected error: \(error)")
            }
        }
    }
}
