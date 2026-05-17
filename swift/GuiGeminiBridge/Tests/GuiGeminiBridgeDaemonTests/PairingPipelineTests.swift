import XCTest
import CryptoKit
@preconcurrency import Network
import BridgeCore
import BridgeCryptoPairing
@testable import GuiGeminiBridgeDaemon

final class PairingPipelineTests: XCTestCase {
    func testFrameLengthDecodeIsByteBased() throws {
        XCTAssertEqual(try decodeFrameLength(Data([0x00, 0x00, 0x01, 0x2C])), 300)
        XCTAssertThrowsError(try decodeFrameLength(Data([0x00, 0x01, 0x02])))
    }

    func testListenerYieldsResponseAndBuildsDesktopNotificationShape() async throws {
        let listener = PairingChannelListener(bonjourServiceType: "_agbpipeline._tcp", port: 0)
        try await listener.start()
        defer {
            Task { await listener.stop() }
        }

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
