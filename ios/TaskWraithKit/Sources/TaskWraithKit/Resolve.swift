// taskwraith-resolve-v1 — trusted-reconnect signing (Swift port of
// src/shared/e2ee/resolve.ts). The phone signs a resolve request with its
// Keychain identity to ask the relay where the paired Mac is now listening.

import Foundation
import CryptoKit

public enum TWResolve {
    public static let id = "taskwraith-resolve-v1"

    /// Canonical allowedPeers order — sorted + deduped — so signer and verifier
    /// agree regardless of array order.
    public static func canonicalAllowedPeers(_ peers: [String]) -> [String] {
        Array(Set(peers)).sorted()
    }

    public static func registerSigningString(
        macIdentityPubKey: String, sessionId: String, allowedPeers: [String],
        issuedAt: Int64, ttlMs: Int64
    ) -> String {
        [
            id, "register", macIdentityPubKey, sessionId,
            canonicalAllowedPeers(allowedPeers).joined(separator: ","),
            String(issuedAt), String(ttlMs),
        ].joined(separator: "|")
    }

    public static func resolveSigningString(
        macIdentityPubKey: String, iphoneIdentityPubKey: String, nonce: String, issuedAt: Int64
    ) -> String {
        [id, "resolve", macIdentityPubKey, iphoneIdentityPubKey, nonce, String(issuedAt)]
            .joined(separator: "|")
    }

    public struct ResolveRequest: Codable, Sendable {
        public var v = 1
        public var macIdentityPubKey: String
        public var iphoneIdentityPubKey: String
        public var nonce: String
        public var issuedAt: Int64
        public var sig: String
    }

    /// Build a signed resolve request from the phone's identity. `nonce` should
    /// be ≥ 8 random bytes; `issuedAt` is ms epoch (relay enforces freshness).
    public static func signResolveRequest(
        identity: Curve25519.Signing.PrivateKey, macIdentityPubKey: String,
        nonce: Data, issuedAt: Int64
    ) throws -> ResolveRequest {
        let iphoneIdentityPubKey = Base64.encode(identity.publicKey.rawRepresentation)
        let nonceB64 = Base64.encode(nonce)
        let message = resolveSigningString(
            macIdentityPubKey: macIdentityPubKey, iphoneIdentityPubKey: iphoneIdentityPubKey,
            nonce: nonceB64, issuedAt: issuedAt)
        let sig = try identity.signature(for: Data(message.utf8))
        return ResolveRequest(
            macIdentityPubKey: macIdentityPubKey, iphoneIdentityPubKey: iphoneIdentityPubKey,
            nonce: nonceB64, issuedAt: issuedAt, sig: Base64.encode(sig))
    }
}
