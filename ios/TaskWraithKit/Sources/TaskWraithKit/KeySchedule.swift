// taskwraith-e2ee-v1 — transcript + key schedule (Swift port of
// src/shared/e2ee/keyschedule.ts).

import Foundation
import CryptoKit

public struct TranscriptInputs: Sendable {
    public var sessionId: String
    public var clientEphemeralPubKeyB64: String
    public var serverEphemeralPubKeyB64: String
    public var clientNonceB64: String
    public var serverNonceB64: String
    /// Raw Ed25519 (b64) — binding BOTH long-lived identities into the
    /// signed transcript + confirm code defeats identity-splicing (matches
    /// the Node lib's v2 transcript).
    public var macIdentityPubKeyB64: String
    public var iphoneIdentityPubKeyB64: String

    public init(
        sessionId: String, clientEphemeralPubKeyB64: String, serverEphemeralPubKeyB64: String,
        clientNonceB64: String, serverNonceB64: String,
        macIdentityPubKeyB64: String, iphoneIdentityPubKeyB64: String
    ) {
        self.sessionId = sessionId
        self.clientEphemeralPubKeyB64 = clientEphemeralPubKeyB64
        self.serverEphemeralPubKeyB64 = serverEphemeralPubKeyB64
        self.clientNonceB64 = clientNonceB64
        self.serverNonceB64 = serverNonceB64
        self.macIdentityPubKeyB64 = macIdentityPubKeyB64
        self.iphoneIdentityPubKeyB64 = iphoneIdentityPubKeyB64
    }
}

public struct SessionKeys: Sendable {
    public var macToIphone: SymmetricKey
    public var iphoneToMac: SymmetricKey
}

public enum TWKeySchedule {
    /// SHA-256 over the pipe-joined canonical transcript string.
    public static func transcriptHash(_ inputs: TranscriptInputs) -> Data {
        let transcript = [
            TWProtocol.id,
            inputs.sessionId,
            inputs.clientEphemeralPubKeyB64,
            inputs.serverEphemeralPubKeyB64,
            inputs.clientNonceB64,
            inputs.serverNonceB64,
            inputs.macIdentityPubKeyB64,
            inputs.iphoneIdentityPubKeyB64,
        ].joined(separator: "|")
        return Data(SHA256.hash(data: Data(transcript.utf8)))
    }

    /// 6-digit code from the first 4 transcript bytes (big-endian), mod 1e6.
    public static func confirmCode(_ transcriptHash: Data) -> String {
        let u32 =
            (UInt32(transcriptHash[0]) << 24) | (UInt32(transcriptHash[1]) << 16)
            | (UInt32(transcriptHash[2]) << 8) | UInt32(transcriptHash[3])
        return String(format: "%06u", u32 % 1_000_000)
    }

    /// Two directional AES-256-GCM keys. `ikm` is the raw X25519 shared secret;
    /// `salt = SHA256(clientNonce || serverNonce)`; HKDF info strings keep the
    /// directions on separate keys. Matches Node `hkdfSync('sha256', ...)`.
    public static func deriveSessionKeys(
        ikm: Data, clientNonce: Data, serverNonce: Data
    ) -> SessionKeys {
        let salt = Data(SHA256.hash(data: clientNonce + serverNonce))
        let prk = SymmetricKey(data: ikm)
        let macToIphone = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: prk, salt: salt,
            info: Data(TWProtocol.hkdfInfoMacToIphone.utf8), outputByteCount: 32)
        let iphoneToMac = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: prk, salt: salt,
            info: Data(TWProtocol.hkdfInfoIphoneToMac.utf8), outputByteCount: 32)
        return SessionKeys(macToIphone: macToIphone, iphoneToMac: iphoneToMac)
    }
}
