// taskwraith-e2ee-v1 — key material (Swift port of src/shared/e2ee/keys.ts).
//
// CryptoKit speaks RAW 32-byte keys (`rawRepresentation`) natively — exactly
// what the wire carries — so unlike Node (which round-trips through SPKI/DER)
// there is no prefix juggling here. The cross-impl vector test proves a given
// 32-byte seed yields the same public key, shared secret, and signature on both
// stacks.

import Foundation
import CryptoKit

public enum TWCryptoError: Error, Sendable {
    case invalidSharedSecret
}

public enum TWKeys {
    // ── Identity (Ed25519) ────────────────────────────────────────────────────

    public static func generateIdentity() -> Curve25519.Signing.PrivateKey {
        Curve25519.Signing.PrivateKey()
    }

    public static func identity(fromSeed seed: Data) throws -> Curve25519.Signing.PrivateKey {
        try Curve25519.Signing.PrivateKey(rawRepresentation: seed)
    }

    public static func importEd25519PublicKey(raw: Data) throws -> Curve25519.Signing.PublicKey {
        try Curve25519.Signing.PublicKey(rawRepresentation: raw)
    }

    public static func sign(_ message: Data, with key: Curve25519.Signing.PrivateKey) throws -> Data {
        try key.signature(for: message)
    }

    public static func verify(
        _ signature: Data, of message: Data, with key: Curve25519.Signing.PublicKey
    ) -> Bool {
        key.isValidSignature(signature, for: message)
    }

    // ── Ephemeral (X25519) ────────────────────────────────────────────────────

    public static func generateEphemeral() -> Curve25519.KeyAgreement.PrivateKey {
        Curve25519.KeyAgreement.PrivateKey()
    }

    public static func ephemeral(fromSeed seed: Data) throws -> Curve25519.KeyAgreement.PrivateKey {
        try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: seed)
    }

    public static func importX25519PublicKey(raw: Data) throws -> Curve25519.KeyAgreement.PublicKey {
        try Curve25519.KeyAgreement.PublicKey(rawRepresentation: raw)
    }

    /// Raw X25519 ECDH → 32-byte shared secret bytes (the HKDF IKM). Matches
    /// Node's `diffieHellman(...)` raw output.
    public static func sharedSecret(
        _ priv: Curve25519.KeyAgreement.PrivateKey,
        _ peer: Curve25519.KeyAgreement.PublicKey
    ) throws -> Data {
        let secret = try priv.sharedSecretFromKeyAgreement(with: peer)
        let data = secret.withUnsafeBytes { Data($0) }
        // Reject an all-zero shared secret before HKDF (mirrors keys.ts) —
        // defense-in-depth; the transcript binding already detects a
        // substituted ephemeral via the confirm code.
        if data.allSatisfy({ $0 == 0 }) {
            throw TWCryptoError.invalidSharedSecret
        }
        return data
    }
}

public enum Base64 {
    /// Standard alphabet, padded — matches Node's Buffer.toString('base64').
    public static func encode(_ data: Data) -> String { data.base64EncodedString() }
    public static func decode(_ text: String) -> Data? { Data(base64Encoded: text) }
}
