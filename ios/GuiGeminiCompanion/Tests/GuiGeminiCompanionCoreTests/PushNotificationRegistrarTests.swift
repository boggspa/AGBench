import XCTest
import Foundation
import CryptoKit
import BridgeCore
import BridgeCryptoPairing
@testable import GuiGeminiCompanionCore

final class PushNotificationRegistrarTests: XCTestCase {
    private func sampleClient() -> GuiGeminiBridgeClient {
        let macPrivate = P256.KeyAgreement.PrivateKey()
        let ctlPrivate = P256.KeyAgreement.PrivateKey()
        let derived = try! PairingKeyDeriver.deriveFromControllerSide(
            controllerPrivateKey: ctlPrivate,
            macPublicKeyData: macPrivate.publicKey.rawRepresentation,
            macNonce: Data(repeating: 0xAA, count: 32),
            controllerNonce: Data(repeating: 0xBB, count: 32)
        )
        let pair = GuiGeminiBridgeClient.Pair(
            pairID: PairID("pair-1"),
            controllerDeviceID: DeviceID("iphone-1"),
            macDeviceID: DeviceID("mac-1"),
            derivedKeys: derived
        )
        return GuiGeminiBridgeClient(pair: pair)
    }

    func testEmptyTokenRejected() async {
        let registrar = PushNotificationRegistrar(
            client: sampleClient(),
            pairID: PairID("pair-1"),
            env: .production
        )
        do {
            _ = try await registrar.register(deviceToken: Data())
            XCTFail("expected emptyToken error")
        } catch let error as PushNotificationRegistrar.RegistrationError {
            guard case .emptyToken = error else {
                XCTFail("expected .emptyToken, got \(error)")
                return
            }
        } catch {
            XCTFail("unexpected error type: \(error)")
        }
    }

    func testHexEncodingProducesLowercase64Chars() {
        // 32 bytes (typical APNs token size) → 64 hex chars.
        let bytes = Data((0..<32).map { _ in UInt8.random(in: 0...255) })
        let hex = PushNotificationRegistrar.hexEncode(bytes)
        XCTAssertEqual(hex.count, 64)
        XCTAssertTrue(hex.allSatisfy { $0.isHexDigit && !$0.isUppercase })
    }

    func testHexEncodingFixedFixtures() {
        XCTAssertEqual(
            PushNotificationRegistrar.hexEncode(Data([0x00, 0x01, 0xfe, 0xff])),
            "0001feff"
        )
        XCTAssertEqual(
            PushNotificationRegistrar.hexEncode(Data([0xab, 0xcd, 0xef])),
            "abcdef"
        )
        XCTAssertEqual(
            PushNotificationRegistrar.hexEncode(Data()),
            ""
        )
    }

    func testForgetCachedRegistrationClearsState() async {
        let registrar = PushNotificationRegistrar(
            client: sampleClient(),
            pairID: PairID("pair-1"),
            env: .production
        )
        let initial = await registrar.lastRegistration
        XCTAssertNil(initial)
        await registrar.forgetCachedRegistration()
        // Still nil after a clear — the operation is idempotent.
        let afterClear = await registrar.lastRegistration
        XCTAssertNil(afterClear)
    }

    // Note: we can't easily fake the GuiGeminiBridgeClient's `sendAction`
    // response without a real transport (the client wraps a real
    // `LANBridgeController`). Round-trip tests of the registered-vs-
    // alreadyRegistered-vs-rejected paths land alongside the Mac-side
    // pairing-listener slice when a fake-Mac fixture exists for the
    // full transport path. Today's tests pin the input validation +
    // pure-function helpers; the dispatch path itself is type-checked
    // by the compiler.
}
