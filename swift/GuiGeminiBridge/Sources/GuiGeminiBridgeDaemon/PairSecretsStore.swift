import Foundation
import CryptoKit
import BridgeCore
import BridgeCryptoPrimitives
import BridgeCryptoPairing

/// Persistence wrapper for `PairingDerivedKeys`.
///
/// Phase C3.0: derive-and-throw-away is no longer acceptable — the transport
/// listener (Phase C3.1) needs to reconstruct `LANBridgeServer.TrustedController`
/// records, each of which carries the `macToControllerKey` and
/// `controllerToMacKey`. Those are derived from the P256 ECDH session keys
/// during pairing, and without persisting them the listener can't accept
/// connections from previously-paired devices after a restart.
///
/// Storage: any `SecretStore` (Keychain in production, in-memory for tests).
/// One blob per pairing, keyed by `pairID.rawValue` with the `pair.secrets.`
/// prefix. The blob is a JSON object of base64-encoded raw key bytes — five
/// 32-byte keys for a total payload of ~245 bytes (after base64+JSON overhead).
public enum PairSecretsStore {
    private static let accountPrefix = "pair.secrets."

    /// On-wire shape persisted per pairID. Versioned (`v`) so a future
    /// rotation/upgrade can detect old blobs and re-derive.
    private struct PersistedPairSecrets: Codable, Sendable {
        let v: Int
        let pairRootKey: String
        let macToControllerKey: String
        let controllerToMacKey: String
        let attachmentWrapKey: String
        let cloudKitPayloadKey: String
    }

    public static func save(
        secretStore: SecretStore,
        pairID: PairID,
        keys: PairingDerivedKeys
    ) async throws {
        let payload = PersistedPairSecrets(
            v: 1,
            pairRootKey: base64(keys.pairRootKey),
            macToControllerKey: base64(keys.macToControllerKey),
            controllerToMacKey: base64(keys.controllerToMacKey),
            attachmentWrapKey: base64(keys.attachmentWrapKey),
            cloudKitPayloadKey: base64(keys.cloudKitPayloadKey)
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(payload)
        try await secretStore.save(data, account: account(for: pairID))
    }

    public static func load(
        secretStore: SecretStore,
        pairID: PairID
    ) async throws -> PairingDerivedKeys? {
        guard let data = try await secretStore.read(account: account(for: pairID)) else {
            return nil
        }
        let decoder = JSONDecoder()
        let persisted = try decoder.decode(PersistedPairSecrets.self, from: data)
        guard persisted.v == 1 else {
            // Future versions handled here; v1 is the only shape today.
            return nil
        }
        guard let pairRoot = decodeKey(persisted.pairRootKey),
              let macToCtl = decodeKey(persisted.macToControllerKey),
              let ctlToMac = decodeKey(persisted.controllerToMacKey),
              let attachWrap = decodeKey(persisted.attachmentWrapKey),
              let cloudKitPayload = decodeKey(persisted.cloudKitPayloadKey) else {
            return nil
        }
        return PairingDerivedKeys(
            pairRootKey: pairRoot,
            macToControllerKey: macToCtl,
            controllerToMacKey: ctlToMac,
            attachmentWrapKey: attachWrap,
            cloudKitPayloadKey: cloudKitPayload
        )
    }

    public static func delete(secretStore: SecretStore, pairID: PairID) async throws {
        try await secretStore.delete(account: account(for: pairID))
    }

    // MARK: - Helpers

    private static func account(for pairID: PairID) -> String {
        "\(accountPrefix)\(pairID.rawValue)"
    }

    private static func base64(_ key: SymmetricKey) -> String {
        let data = key.withUnsafeBytes { Data($0) }
        return data.base64EncodedString()
    }

    private static func decodeKey(_ encoded: String) -> SymmetricKey? {
        guard let data = Data(base64Encoded: encoded), data.count == 32 else { return nil }
        return SymmetricKey(data: data)
    }
}
