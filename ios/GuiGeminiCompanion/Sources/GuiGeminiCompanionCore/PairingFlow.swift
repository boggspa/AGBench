import Foundation
import CryptoKit
import BridgeCore
import BridgeCryptoPairing

/// PairingFlow — controller-side (iOS) state machine for the QR-based
/// P256 ECDH + 6-digit transcript-confirmation pairing exchange.
///
/// Lifecycle:
///
///   1. `PairingFlow.scan(bootstrapJSON:)` — caller passes JSON bytes
///      extracted from the QR code. Returns a `Started` state with the
///      decoded `PairingBootstrapPayload`. The flow internally generates
///      an ephemeral P256 keypair and nonce.
///
///   2. `started.buildResponse(displayName:identityKey:)` — caller
///      provides the iPhone's display name (shown on the Mac during
///      confirmation) and a persistent identity signing key. Returns
///      `(response: PairingResponsePayload, confirmationCode: String)`.
///
///   3. The iOS app transmits `response` to the Mac over the chosen
///      pairing channel (Bonjour + direct TCP, or daemon RPC echo,
///      pending the iOS-side transport client). The Mac responds with
///      its own confirmation code; the user verifies they match.
///
///   4. On success the iOS app derived keys are kept for the active
///      session. The flow type itself is short-lived — pair-secret
///      persistence is the iOS app's responsibility.
///
/// This is the controller-side mirror of the Mac-side `PairingCoordinator`
/// living in the GuiGeminiBridgeDaemon. The crypto primitives are shared
/// (both call `BridgeCryptoPairing.PairingKeyDeriver` /
/// `PairingCodeFormatter`), so the confirmation codes computed on each
/// side over the same transcript MUST match by construction.
public enum PairingFlow {
    /// Step 1: parse the QR's JSON bytes into a `PairingBootstrapPayload`
    /// and stage an ephemeral keypair + nonce ready to respond.
    public static func scan(bootstrapJSON: Data) throws -> Started {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        decoder.dataDecodingStrategy = .base64
        let bootstrap = try decoder.decode(PairingBootstrapPayload.self, from: bootstrapJSON)
        let metadata = try? decoder.decode(BootstrapMetadata.self, from: bootstrapJSON)
        let now = Date()
        if bootstrap.expiresAt < now {
            throw PairingFlowError.bootstrapExpired(bootstrap.expiresAt)
        }
        let controllerPrivateKey = P256.KeyAgreement.PrivateKey()
        let controllerNonce = Data((0..<32).map { _ in UInt8.random(in: 0...255) })
        return Started(
            bootstrap: bootstrap,
            macDisplayName: Self.normalizedDisplayName(metadata?.macDisplayName),
            controllerPrivateKey: controllerPrivateKey,
            controllerNonce: controllerNonce
        )
    }

    public struct Started: Sendable {
        public let bootstrap: PairingBootstrapPayload
        public let macDisplayName: String?
        public let controllerPrivateKey: P256.KeyAgreement.PrivateKey
        public let controllerNonce: Data

        /// Build the response payload + derived keys + 6-digit
        /// confirmation code in one go.
        ///
        /// `identityKey` is the iPhone's persistent device-identity signing
        /// key — used to sign the transcript (and in the future to
        /// authenticate as the same device across re-pairings). On first
        /// run the iOS app should generate one via
        /// `DeviceIdentitySigningKey()` and persist it in the iOS Keychain.
        public func buildResponse(
            controllerDeviceID: DeviceID,
            controllerDisplayName: String,
            controllerIdentityKey: DeviceIdentitySigningKey
        ) throws -> (response: PairingResponsePayload, derivedKeys: PairingDerivedKeys, confirmationCode: String) {
            // Derive shared keys from our private + Mac's public, mixing
            // both nonces from the bootstrap into the salt.
            let derivedKeys = try PairingKeyDeriver.deriveFromControllerSide(
                controllerPrivateKey: controllerPrivateKey,
                macPublicKeyData: bootstrap.macEphemeralPublicKey,
                macNonce: bootstrap.macNonce,
                controllerNonce: controllerNonce
            )
            let response = PairingResponsePayload(
                pairingSessionID: bootstrap.pairingSessionID,
                controllerDeviceID: controllerDeviceID,
                controllerDisplayName: controllerDisplayName,
                controllerIdentityPublicKey: controllerIdentityKey.publicKeyRawRepresentation,
                controllerEphemeralPublicKey: controllerPrivateKey.publicKey.rawRepresentation,
                controllerNonce: controllerNonce,
                signature: nil  // Optional — Phase C-late may add transcript signing
            )
            let transcript = PairingTranscript(bootstrap: bootstrap, response: response)
            let confirmationCode = try PairingCodeFormatter.sixDigitConfirmationCode(for: transcript)
            return (response, derivedKeys, confirmationCode)
        }
    }

    private struct BootstrapMetadata: Decodable {
        let macDisplayName: String?
    }

    private static func normalizedDisplayName(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return nil }
        return trimmed
    }
}

public enum PairingFlowError: Error, Equatable, Sendable, CustomStringConvertible {
    case bootstrapExpired(Date)

    public var description: String {
        switch self {
        case .bootstrapExpired(let date):
            return "Pairing QR expired at \(date)"
        }
    }
}
