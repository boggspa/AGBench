import XCTest
import Foundation
import CryptoKit
import BridgeCore
import BridgeCryptoPairing
@testable import GuiGeminiCompanionCore

final class PairingFlowTests: XCTestCase {
    /// Build a fresh PairingBootstrapPayload (as the Mac would emit) so
    /// we can feed it into the controller-side flow.
    private func makeBootstrap(
        expiresIn: TimeInterval = 300,
        tailscaleEndpointHint: String? = nil
    ) -> (
        bootstrap: PairingBootstrapPayload,
        macPrivateKey: P256.KeyAgreement.PrivateKey
    ) {
        let macPrivate = P256.KeyAgreement.PrivateKey()
        let macIdentity = DeviceIdentitySigningKey()
        let macNonce = Data((0..<32).map { _ in UInt8.random(in: 0...255) })
        let bootstrap = PairingBootstrapPayload(
            pairingSessionID: UUID().uuidString,
            macDeviceID: DeviceID(UUID().uuidString.lowercased()),
            macIdentityKeyID: macIdentity.identityKeyID,
            macEphemeralPublicKey: macPrivate.publicKey.rawRepresentation,
            macNonce: macNonce,
            expiresAt: Date().addingTimeInterval(expiresIn),
            bonjourServiceName: "_test._tcp",
            tailscaleEndpointHint: tailscaleEndpointHint,
            quicTransportCertificateSHA256: nil
        )
        return (bootstrap, macPrivate)
    }

    private func encodeBootstrap(
        _ payload: PairingBootstrapPayload,
        macDisplayName: String? = nil
    ) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.dataEncodingStrategy = .base64
        let data = try encoder.encode(payload)
        guard let macDisplayName else { return data }
        var object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        object["macDisplayName"] = macDisplayName
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    func testScanParsesBootstrapAndStagesEphemeralMaterial() throws {
        let (bootstrap, _) = makeBootstrap()
        let json = try encodeBootstrap(bootstrap)
        let started = try PairingFlow.scan(bootstrapJSON: json)
        XCTAssertEqual(started.bootstrap.pairingSessionID, bootstrap.pairingSessionID)
        XCTAssertNil(started.bootstrap.tailscaleEndpointHint)
        XCTAssertEqual(started.controllerNonce.count, 32)
        // Public key is derivable from the staged private key.
        XCTAssertFalse(started.controllerPrivateKey.publicKey.rawRepresentation.isEmpty)
    }

    func testScanParsesBootstrapWithTailscaleEndpointHint() throws {
        let (bootstrap, _) = makeBootstrap(tailscaleEndpointHint: "100.64.10.20:38747")
        let json = try encodeBootstrap(bootstrap)
        let started = try PairingFlow.scan(bootstrapJSON: json)
        XCTAssertEqual(started.bootstrap.pairingSessionID, bootstrap.pairingSessionID)
        XCTAssertEqual(started.bootstrap.tailscaleEndpointHint, "100.64.10.20:38747")
    }

    func testScanParsesMacDisplayNameMetadata() throws {
        let (bootstrap, _) = makeBootstrap()
        let json = try encodeBootstrap(bootstrap, macDisplayName: "Chris's Mac Studio")
        let started = try PairingFlow.scan(bootstrapJSON: json)
        XCTAssertEqual(started.macDisplayName, "Chris's Mac Studio")
    }

    func testScanRejectsExpiredBootstrap() throws {
        let (bootstrap, _) = makeBootstrap(expiresIn: -10)
        let json = try encodeBootstrap(bootstrap)
        XCTAssertThrowsError(try PairingFlow.scan(bootstrapJSON: json)) { error in
            guard case PairingFlowError.bootstrapExpired = error else {
                XCTFail("expected bootstrapExpired, got \(error)")
                return
            }
        }
    }

    func testBuildResponseProducesValidPayloadAndCode() throws {
        let (bootstrap, _) = makeBootstrap()
        let json = try encodeBootstrap(bootstrap)
        let started = try PairingFlow.scan(bootstrapJSON: json)
        let identity = DeviceIdentitySigningKey()
        let result = try started.buildResponse(
            controllerDeviceID: DeviceID("iphone-test-1"),
            controllerDisplayName: "Chris's iPhone",
            controllerIdentityKey: identity
        )
        XCTAssertEqual(result.response.pairingSessionID, bootstrap.pairingSessionID)
        XCTAssertEqual(result.response.controllerDisplayName, "Chris's iPhone")
        XCTAssertEqual(result.response.controllerDeviceID.rawValue, "iphone-test-1")
        XCTAssertEqual(result.response.controllerNonce, started.controllerNonce)
        // 6-digit numeric confirmation code.
        XCTAssertEqual(result.confirmationCode.count, 6)
        XCTAssertTrue(result.confirmationCode.allSatisfy { $0.isNumber })
        // Derived keys are 32 bytes each.
        XCTAssertEqual(result.derivedKeys.pairRootKey.withUnsafeBytes { $0.count }, 32)
        XCTAssertEqual(result.derivedKeys.macToControllerKey.withUnsafeBytes { $0.count }, 32)
        XCTAssertEqual(result.derivedKeys.controllerToMacKey.withUnsafeBytes { $0.count }, 32)
    }

    func testControllerAndMacDeriveSameSixDigitCode() throws {
        // The critical security property: both sides compute the SAME code
        // from the SAME transcript. If this ever drifts the pairing UX
        // silently degrades (codes don't match → user thinks attack).
        let (bootstrap, macPrivate) = makeBootstrap()
        let json = try encodeBootstrap(bootstrap)
        let started = try PairingFlow.scan(bootstrapJSON: json)
        let identity = DeviceIdentitySigningKey()
        let result = try started.buildResponse(
            controllerDeviceID: DeviceID("iphone-test-1"),
            controllerDisplayName: "Test Phone",
            controllerIdentityKey: identity
        )

        // Now compute what the Mac would compute over the same transcript.
        // PairingTranscript is constructed from bootstrap + response, then
        // PairingCodeFormatter takes the transcript. Both sides agree by
        // construction. We verify the round-trip equality.
        let macTranscript = PairingTranscript(bootstrap: bootstrap, response: result.response)
        let macCode = try PairingCodeFormatter.sixDigitConfirmationCode(for: macTranscript)
        XCTAssertEqual(result.confirmationCode, macCode)

        // Also verify the Mac-side key derivation matches ours so the
        // resulting session keys are identical on both sides.
        let macDerived = try PairingKeyDeriver.deriveFromMacSide(
            macPrivateKey: macPrivate,
            controllerPublicKeyData: result.response.controllerEphemeralPublicKey,
            macNonce: bootstrap.macNonce,
            controllerNonce: result.response.controllerNonce
        )
        XCTAssertEqual(
            result.derivedKeys.pairRootKey.withUnsafeBytes { Data($0) },
            macDerived.pairRootKey.withUnsafeBytes { Data($0) }
        )
        XCTAssertEqual(
            result.derivedKeys.macToControllerKey.withUnsafeBytes { Data($0) },
            macDerived.macToControllerKey.withUnsafeBytes { Data($0) }
        )
    }

    func testScanRejectsMalformedJSON() {
        let bad = Data("not valid json".utf8)
        XCTAssertThrowsError(try PairingFlow.scan(bootstrapJSON: bad))
    }
}
