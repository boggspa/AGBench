import XCTest
import CryptoKit
@preconcurrency import Network
import BridgeCore
// BridgeCryptoPrimitives was previously a transitive import via BridgeCryptoPairing;
// after the upstream BridgeCore drift `DeviceIdentitySigningKey` no longer
// re-exports through Pairing, so the test target needs the explicit import.
import BridgeCryptoPrimitives
import BridgeCryptoPairing
@testable import AgbenchBridgeDaemon

final class PairingPipelineTests: XCTestCase {
    func testFrameLengthDecodeIsByteBased() throws {
        XCTAssertEqual(try decodeFrameLength(Data([0x00, 0x00, 0x01, 0x2C])), 300)
        XCTAssertThrowsError(try decodeFrameLength(Data([0x00, 0x01, 0x02])))
    }

    func testListenerYieldsResponseAndBuildsDesktopNotificationShape() async throws {
        let coordinator = PairingCoordinator(
            deviceStore: InMemoryTrustedDeviceStore(),
            secretStore: InMemorySecretStore(),
            macDeviceID: DeviceID("mac-test-device"),
            macIdentitySigningKey: DeviceIdentitySigningKey()
        )
        let listener = PairingChannelListener(
            bonjourServiceType: "_agbpipeline._tcp",
            port: 0,
            iosFinalDecisionHandler: { sessionID, accepted, message in
                let result = try await coordinator.recordIOSFinalDecision(
                    pairingSessionID: sessionID,
                    accepted: accepted,
                    message: message
                )
                guard let decision = result.finalDecision else { return nil }
                return PairingChannelListener.PairingFinalDecisionFrame(
                    accepted: decision.accepted,
                    message: decision.message,
                    pairID: decision.pairID
                )
            }
        )
        try await listener.start()
        defer {
            Task { await listener.stop() }
        }
        let begin = await coordinator.beginPairing(controllerDisplayName: "iPad")
        let response = try makeResponse(
            bootstrap: begin.bootstrapPayload,
            controllerDeviceID: DeviceID("ipad-test-device"),
            controllerDisplayName: "iPad"
        )

        let incomingTask = Task { () -> PairingChannelListener.IncomingPairingResponse? in
            for await incoming in listener.incomingResponses {
                return incoming
            }
            return nil
        }

        let boundPort = await listener.boundPort()
        let port = try XCTUnwrap(boundPort)
        let connection = try await openConnection(port: port)
        defer { connection.cancel() }
        try await sendFrame(try encoded(response), on: connection)

        let incoming = try await withTimeout(seconds: 3) {
            let maybeIncoming = await incomingTask.value
            return try XCTUnwrap(maybeIncoming)
        }
        XCTAssertEqual(incoming.sessionID, begin.pairingSessionID)

        let result = try await coordinator.confirmPairing(response: incoming.response)
        let notification = PairingCoordinator.PairingResponseNotification(result: result)
        XCTAssertEqual(PairingCoordinator.PairingResponseNotification.method, "bridge.didReceivePairingResponse")
        XCTAssertEqual(notification.params["pairingSessionID"], begin.pairingSessionID)
        XCTAssertEqual(notification.params["controllerDeviceID"], "ipad-test-device")
        XCTAssertEqual(notification.params["controllerDisplayName"], "iPad")
        XCTAssertEqual(notification.params["confirmationCode"], result.confirmationCode)

        await listener.sendConfirmationCode(sessionID: incoming.sessionID, code: result.confirmationCode)
        let confirmationBytes = try await withTimeout(seconds: 3) {
            try await Self.receiveFrame(on: connection)
        }
        let confirmation = try JSONSerialization.jsonObject(with: confirmationBytes) as? [String: Any]
        XCTAssertEqual(confirmation?["macConfirmationCode"] as? String, result.confirmationCode)
        XCTAssertEqual(confirmation?["sessionID"] as? String, incoming.sessionID)

        let macDecision = try await coordinator.finalizePairing(
            pairingSessionID: incoming.sessionID,
            userConfirmed: true
        )
        XCTAssertNil(macDecision.trustedDevice)
        XCTAssertNil(macDecision.finalDecision)
        XCTAssertEqual(macDecision.waitingFor, "iOS")

        try await sendFrame(
            try JSONEncoder().encode(PairingChannelListener.IncomingFinalDecisionFrame(accepted: true)),
            on: connection
        )
        let finalFrameBytes = try await withTimeout(seconds: 3) {
            try await Self.receiveFrame(on: connection)
        }
        let finalFrame = try JSONDecoder().decode(
            PairingChannelListener.PairingFinalDecisionFrame.self,
            from: finalFrameBytes
        )
        XCTAssertEqual(finalFrame.accepted, true)
        XCTAssertNil(finalFrame.message)
        XCTAssertNotNil(finalFrame.pairID)
    }

    func testFinalizationIOSFirstWaitsThenMacAcceptCompletes() async throws {
        let secretStore = InMemorySecretStore()
        let coordinator = PairingCoordinator(
            deviceStore: InMemoryTrustedDeviceStore(),
            secretStore: secretStore,
            macDeviceID: DeviceID("mac-test-device"),
            macIdentitySigningKey: DeviceIdentitySigningKey()
        )
        let begin = await coordinator.beginPairing(controllerDisplayName: "iPad")
        let response = try makeResponse(
            bootstrap: begin.bootstrapPayload,
            controllerDeviceID: DeviceID("ipad-test-device"),
            controllerDisplayName: "iPad"
        )
        _ = try await coordinator.confirmPairing(response: response)

        let iosDecision = try await coordinator.recordIOSFinalDecision(
            pairingSessionID: begin.pairingSessionID,
            accepted: true,
            message: nil
        )
        XCTAssertNil(iosDecision.trustedDevice)
        XCTAssertNil(iosDecision.finalDecision)
        XCTAssertEqual(iosDecision.waitingFor, "Mac")

        let macDecision = try await coordinator.finalizePairing(
            pairingSessionID: begin.pairingSessionID,
            userConfirmed: true
        )
        let trusted = try XCTUnwrap(macDecision.trustedDevice)
        let finalDecision = try XCTUnwrap(macDecision.finalDecision)
        XCTAssertEqual(finalDecision.accepted, true)
        XCTAssertNil(finalDecision.message)
        XCTAssertEqual(finalDecision.pairID, trusted.pairID.rawValue)
        XCTAssertNil(macDecision.waitingFor)
        let persistedSecrets = try await PairSecretsStore.load(
            secretStore: secretStore,
            pairID: trusted.pairID
        )
        XCTAssertNotNil(persistedSecrets)
    }

    func testAcceptedFinalizationPersistsTrustedRecordAndSecretsForTransport() async throws {
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("trusted-devices-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: fileURL) }

        let deviceStore = FileTrustedDeviceStore(fileURL: fileURL)
        let secretStore = InMemorySecretStore()
        let coordinator = PairingCoordinator(
            deviceStore: deviceStore,
            secretStore: secretStore,
            macDeviceID: DeviceID("mac-test-device"),
            macIdentitySigningKey: DeviceIdentitySigningKey()
        )
        let begin = await coordinator.beginPairing(controllerDisplayName: "iPad")
        let response = try makeResponse(
            bootstrap: begin.bootstrapPayload,
            controllerDeviceID: DeviceID("ipad-test-device"),
            controllerDisplayName: "iPad"
        )
        _ = try await coordinator.confirmPairing(response: response)
        _ = try await coordinator.finalizePairing(
            pairingSessionID: begin.pairingSessionID,
            userConfirmed: true
        )
        let final = try await coordinator.recordIOSFinalDecision(
            pairingSessionID: begin.pairingSessionID,
            accepted: true,
            message: nil
        )

        let trusted = try XCTUnwrap(final.trustedDevice)
        let finalDecision = try XCTUnwrap(final.finalDecision)
        XCTAssertEqual(finalDecision.pairID, trusted.pairID.rawValue)

        let persistedRecords = await deviceStore.snapshot()
        XCTAssertEqual(persistedRecords.count, 1)
        XCTAssertEqual(persistedRecords.first?.pairID, trusted.pairID)
        XCTAssertEqual(persistedRecords.first?.pairingState, .active)

        let persistedSecrets = try await PairSecretsStore.load(
            secretStore: secretStore,
            pairID: trusted.pairID
        )
        XCTAssertNotNil(persistedSecrets)
    }

    func testFinalizationRejectsImmediatelyWhenMacRejects() async throws {
        let coordinator = PairingCoordinator(
            deviceStore: InMemoryTrustedDeviceStore(),
            secretStore: InMemorySecretStore(),
            macDeviceID: DeviceID("mac-test-device"),
            macIdentitySigningKey: DeviceIdentitySigningKey()
        )
        let begin = await coordinator.beginPairing(controllerDisplayName: "iPad")
        let response = try makeResponse(
            bootstrap: begin.bootstrapPayload,
            controllerDeviceID: DeviceID("ipad-test-device"),
            controllerDisplayName: "iPad"
        )
        _ = try await coordinator.confirmPairing(response: response)

        let result = try await coordinator.finalizePairing(
            pairingSessionID: begin.pairingSessionID,
            userConfirmed: false
        )
        XCTAssertNil(result.trustedDevice)
        let finalDecision = try XCTUnwrap(result.finalDecision)
        XCTAssertEqual(finalDecision.accepted, false)
        XCTAssertEqual(finalDecision.message, "User did not confirm matching codes")
        XCTAssertNil(finalDecision.pairID)
    }

    func testFinalizationRejectsImmediatelyWhenIOSRejects() async throws {
        let coordinator = PairingCoordinator(
            deviceStore: InMemoryTrustedDeviceStore(),
            secretStore: InMemorySecretStore(),
            macDeviceID: DeviceID("mac-test-device"),
            macIdentitySigningKey: DeviceIdentitySigningKey()
        )
        let begin = await coordinator.beginPairing(controllerDisplayName: "iPad")
        let response = try makeResponse(
            bootstrap: begin.bootstrapPayload,
            controllerDeviceID: DeviceID("ipad-test-device"),
            controllerDisplayName: "iPad"
        )
        _ = try await coordinator.confirmPairing(response: response)

        let result = try await coordinator.recordIOSFinalDecision(
            pairingSessionID: begin.pairingSessionID,
            accepted: false,
            message: "Codes do not match on iPad"
        )
        XCTAssertNil(result.trustedDevice)
        let finalDecision = try XCTUnwrap(result.finalDecision)
        XCTAssertEqual(finalDecision.accepted, false)
        XCTAssertEqual(finalDecision.message, "Codes do not match on iPad")
        XCTAssertNil(finalDecision.pairID)
    }

    func testFinalizationSecondRejectAfterFirstRejectFindsNoPendingSession() async throws {
        let coordinator = PairingCoordinator(
            deviceStore: InMemoryTrustedDeviceStore(),
            secretStore: InMemorySecretStore(),
            macDeviceID: DeviceID("mac-test-device"),
            macIdentitySigningKey: DeviceIdentitySigningKey()
        )
        let begin = await coordinator.beginPairing(controllerDisplayName: "iPad")
        let response = try makeResponse(
            bootstrap: begin.bootstrapPayload,
            controllerDeviceID: DeviceID("ipad-test-device"),
            controllerDisplayName: "iPad"
        )
        _ = try await coordinator.confirmPairing(response: response)
        _ = try await coordinator.recordIOSFinalDecision(
            pairingSessionID: begin.pairingSessionID,
            accepted: false,
            message: "Codes do not match on iPad"
        )

        do {
            _ = try await coordinator.finalizePairing(
                pairingSessionID: begin.pairingSessionID,
                userConfirmed: false
            )
            XCTFail("expected sessionNotFound after iOS rejection removed the pending session")
        } catch let error as PairingCoordinator.PairingError {
            XCTAssertEqual(error, .sessionNotFound(begin.pairingSessionID))
        }
    }

    private func makeResponse(
        bootstrap: PairingBootstrapPayload,
        controllerDeviceID: DeviceID,
        controllerDisplayName: String
    ) throws -> PairingResponsePayload {
        let controllerPrivateKey = P256.KeyAgreement.PrivateKey()
        let controllerNonce = Data(repeating: 0xCD, count: 32)
        return PairingResponsePayload(
            pairingSessionID: bootstrap.pairingSessionID,
            controllerDeviceID: controllerDeviceID,
            controllerDisplayName: controllerDisplayName,
            controllerIdentityPublicKey: DeviceIdentitySigningKey().publicKeyRawRepresentation,
            controllerEphemeralPublicKey: controllerPrivateKey.publicKey.rawRepresentation,
            controllerNonce: controllerNonce,
            signature: nil
        )
    }

    private func encoded(_ response: PairingResponsePayload) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dataEncodingStrategy = .base64
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(response)
    }

    private func openConnection(port: UInt16) async throws -> NWConnection {
        let nwPort = try XCTUnwrap(NWEndpoint.Port(rawValue: port))
        let connection = NWConnection(host: "127.0.0.1", port: nwPort, using: .tcp)
        let flag = TestOneShotFlag()
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if flag.tryResolve() {
                        continuation.resume()
                    }
                case .failed(let error):
                    if flag.tryResolve() {
                        continuation.resume(throwing: error)
                    }
                default:
                    break
                }
            }
            connection.start(queue: .global())
        }
        return connection
    }

    private func sendFrame(_ payload: Data, on connection: NWConnection) async throws {
        var length = UInt32(payload.count).bigEndian
        var frame = Data(bytes: &length, count: 4)
        frame.append(payload)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.send(content: frame, completion: .contentProcessed { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            })
        }
    }

    private static func receiveFrame(on connection: NWConnection) async throws -> Data {
        let lengthBytes = try await receiveExact(4, on: connection)
        let length = try decodeFrameLength(lengthBytes)
        return try await receiveExact(Int(length), on: connection)
    }

    private static func receiveExact(_ count: Int, on connection: NWConnection) async throws -> Data {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
            connection.receive(minimumIncompleteLength: count, maximumLength: count) { data, _, _, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let data, data.count == count {
                    continuation.resume(returning: data)
                } else {
                    continuation.resume(throwing: NSError(
                        domain: "PairingPipelineTests",
                        code: 3,
                        userInfo: [NSLocalizedDescriptionKey: "Connection closed before \(count) bytes arrived"]
                    ))
                }
            }
        }
    }

    private func withTimeout<T: Sendable>(
        seconds: TimeInterval,
        operation: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask {
                try await operation()
            }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                throw NSError(
                    domain: "PairingPipelineTests",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for pairing pipeline"]
                )
            }
            guard let value = try await group.next() else {
                throw NSError(
                    domain: "PairingPipelineTests",
                    code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "Pairing pipeline task group ended without a result"]
                )
            }
            group.cancelAll()
            return value
        }
    }
}

private final class TestOneShotFlag: @unchecked Sendable {
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
