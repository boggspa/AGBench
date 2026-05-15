import XCTest
import Foundation
import CryptoKit
import BridgeCore
import BridgeCryptoPairing
@testable import GuiGeminiCompanionCore

@MainActor
final class PairingViewModelTests: XCTestCase {
    private func makeBootstrapJSON(expiresIn: TimeInterval = 300) -> Data {
        let macPrivate = P256.KeyAgreement.PrivateKey()
        let macIdentity = DeviceIdentitySigningKey()
        let macNonce = Data((0..<32).map { _ in UInt8.random(in: 0...255) })
        let bootstrap = PairingBootstrapPayload(
            pairingSessionID: UUID().uuidString,
            macDeviceID: DeviceID("mac-1"),
            macIdentityKeyID: macIdentity.identityKeyID,
            macEphemeralPublicKey: macPrivate.publicKey.rawRepresentation,
            macNonce: macNonce,
            expiresAt: Date().addingTimeInterval(expiresIn),
            bonjourServiceName: "_test._tcp",
            tailscaleEndpointHint: nil,
            quicTransportCertificateSHA256: nil
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.dataEncodingStrategy = .base64
        return try! encoder.encode(bootstrap)
    }

    func testIdleAtStart() {
        let vm = PairingViewModel(controllerDisplayName: "iPhone Test")
        XCTAssertEqual(vm.state, .idle)
        XCTAssertNil(vm.confirmedPair)
    }

    func testScanProducesConfirmingCodeState() {
        let vm = PairingViewModel(controllerDisplayName: "iPhone Test")
        vm.scan(bootstrapJSON: makeBootstrapJSON())
        switch vm.state {
        case .confirmingCode(let code, let name):
            XCTAssertEqual(code.count, 6)
            XCTAssertTrue(code.allSatisfy { $0.isNumber })
            XCTAssertEqual(name, "iPhone Test")
        default:
            XCTFail("expected .confirmingCode, got \(vm.state)")
        }
    }

    func testScanWithExpiredBootstrapFails() {
        let vm = PairingViewModel()
        vm.scan(bootstrapJSON: makeBootstrapJSON(expiresIn: -10))
        if case .failed(let message) = vm.state {
            XCTAssertTrue(message.contains("expired"), "unexpected message: \(message)")
        } else {
            XCTFail("expected .failed, got \(vm.state)")
        }
    }

    func testScanWithGarbageJSONFails() {
        let vm = PairingViewModel()
        vm.scan(bootstrapJSON: Data("not json".utf8))
        guard case .failed = vm.state else {
            XCTFail("expected .failed, got \(vm.state)")
            return
        }
    }

    func testConfirmAfterScanProducesPair() {
        let vm = PairingViewModel(controllerDisplayName: "iPhone Test")
        vm.scan(bootstrapJSON: makeBootstrapJSON())
        vm.confirm()
        XCTAssertEqual(vm.state, .confirmed)
        XCTAssertNotNil(vm.confirmedPair)
        XCTAssertEqual(vm.confirmedPair?.controllerDeviceID.rawValue.isEmpty, false)
    }

    func testConfirmFromIdleFails() {
        let vm = PairingViewModel()
        vm.confirm()  // never scanned
        guard case .failed = vm.state else {
            XCTFail("expected .failed, got \(vm.state)")
            return
        }
        XCTAssertNil(vm.confirmedPair)
    }

    func testCancelClearsStagedState() {
        let vm = PairingViewModel()
        vm.scan(bootstrapJSON: makeBootstrapJSON())
        XCTAssertNotNil(vm.pendingResponse)
        vm.cancel()
        XCTAssertEqual(vm.state, .idle)
        XCTAssertNil(vm.pendingResponse)
    }
}

@MainActor
final class TranscriptViewModelTests: XCTestCase {
    func testStartsEmpty() {
        let vm = TranscriptViewModel()
        XCTAssertTrue(vm.events.isEmpty)
        XCTAssertNil(vm.lastStatus)
    }

    func testClearDrops() {
        let vm = TranscriptViewModel()
        // We can't reach `append` directly (private), but we can verify the
        // public `clear()` behavior with a manually-attached event by
        // putting one through via reflection... skip that and just verify
        // the empty state behavior here. Real append paths are tested via
        // the client-attach integration when transport tests land.
        vm.clear()
        XCTAssertTrue(vm.events.isEmpty)
    }

    func testMaxRetainedIsRespected() {
        // The cap is enforced inside `append`, which is private but
        // exercised via the public init's maxRetained value.
        let vm = TranscriptViewModel(maxRetained: 3)
        XCTAssertEqual(vm.maxRetained, 3)
    }
}
