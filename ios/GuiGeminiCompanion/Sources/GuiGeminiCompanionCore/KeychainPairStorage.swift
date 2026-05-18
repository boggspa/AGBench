import Foundation
import CryptoKit
import BridgeCore
import BridgeCryptoPairing

/// KeychainPairStorage — persistence layer for iOS pairing state.
///
/// Holds three kinds of records, all stored via the injected
/// `SecretStore`:
///
///   - The device's persistent identity signing key (one per
///     installation; generated on first run).
///   - Per-pair `PairRecord` (pairID, mac/controller device IDs, optional
///     display name, timestamp).
///   - Per-pair `PairingDerivedKeys` (the five symmetric keys derived
///     during pairing).
///
/// `SecretStore` is the `BridgeCryptoPairing` protocol so the same
/// storage works in tests (via `InMemorySecretStore`) and in production
/// (via `KeychainSecretStore`). For iOS, production callers build the
/// storage with:
///
/// ```swift
/// let secretStore = KeychainSecretStore(
///     service: "com.example.AGBench.ios",
///     accessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
///     allowsAuthenticationUI: false
/// )
/// let storage = KeychainPairStorage(secretStore: secretStore)
/// ```
///
/// Wire format for the JSON blobs:
///
/// Identity key (account: `"identity.signing.key"`):
///   - 32-byte raw representation of the P256.Signing.PrivateKey, base64-
///     encoded in a tiny envelope (so future versioning is possible).
///
/// Pair entry (account: `"pair.<pairID>.entry"`):
///   - JSON `{v, record: PairRecord, secrets: PersistedSecrets}` where
///     `record` carries identification + timestamps and `secrets` is
///     five base64-encoded SymmetricKeys.
///
/// Pair index (account: `"pairs.index"`):
///   - JSON `[<pairID>, …]` so `loadAllPairs()` can enumerate without
///     scanning the entire keychain.
public actor KeychainPairStorage {
    public struct PairRecord: Sendable, Codable, Equatable {
        public let pairID: PairID
        public let controllerDeviceID: DeviceID
        public let macDeviceID: DeviceID
        /// Optional display name reported by the Mac in the bootstrap
        /// (helps the UI label which Mac this is).
        public let macDisplayName: String?
        /// Optional tailnet endpoint advertised during pairing. Safe to
        /// ignore if stale or missing; LAN discovery remains the fallback.
        public let tailscaleEndpointHint: String?
        public let createdAt: Date

        public init(
            pairID: PairID,
            controllerDeviceID: DeviceID,
            macDeviceID: DeviceID,
            macDisplayName: String? = nil,
            tailscaleEndpointHint: String? = nil,
            createdAt: Date = Date()
        ) {
            self.pairID = pairID
            self.controllerDeviceID = controllerDeviceID
            self.macDeviceID = macDeviceID
            self.macDisplayName = macDisplayName
            self.tailscaleEndpointHint = tailscaleEndpointHint
            self.createdAt = createdAt
        }
    }

    public enum KeychainPairStorageError: Error, CustomStringConvertible, Sendable {
        case malformedIdentityKey
        case malformedPairEntry(pairID: String)
        case unknownPair(pairID: String)
        case unknownVersion(version: Int)

        public var description: String {
            switch self {
            case .malformedIdentityKey: return "Persisted identity key bytes are malformed"
            case .malformedPairEntry(let id): return "Pair entry for \(id) is malformed"
            case .unknownPair(let id): return "No pair entry for \(id)"
            case .unknownVersion(let v): return "Unknown stored schema version \(v)"
            }
        }
    }

    private let secretStore: SecretStore
    private let now: @Sendable () -> Date

    public init(secretStore: SecretStore, now: @escaping @Sendable () -> Date = Date.init) {
        self.secretStore = secretStore
        self.now = now
    }

    public static func production() -> KeychainPairStorage {
        KeychainPairStorage(
            secretStore: KeychainSecretStore(
                service: "com.example.AGBench.ios",
                allowsAuthenticationUI: false
            )
        )
    }

    // MARK: - Identity key

    public func loadIdentityKey() async throws -> DeviceIdentitySigningKey? {
        guard let blob = try await secretStore.read(account: Self.identityAccount) else { return nil }
        let envelope = try JSONDecoder().decode(IdentityKeyEnvelope.self, from: blob)
        guard envelope.v == 1 else { throw KeychainPairStorageError.unknownVersion(version: envelope.v) }
        guard let keyBytes = Data(base64Encoded: envelope.privateKeyBase64) else {
            throw KeychainPairStorageError.malformedIdentityKey
        }
        do {
            let privateKey = try P256.Signing.PrivateKey(rawRepresentation: keyBytes)
            return DeviceIdentitySigningKey(privateKey: privateKey)
        } catch {
            throw KeychainPairStorageError.malformedIdentityKey
        }
    }

    public func saveIdentityKey(_ key: DeviceIdentitySigningKey) async throws {
        let envelope = IdentityKeyEnvelope(
            v: 1,
            privateKeyBase64: key.privateKey.rawRepresentation.base64EncodedString()
        )
        let blob = try JSONEncoder().encode(envelope)
        try await secretStore.save(blob, account: Self.identityAccount)
    }

    /// Convenience: return the persisted identity key, or generate +
    /// persist a new one on first run.
    public func loadOrCreateIdentityKey() async throws -> DeviceIdentitySigningKey {
        if let existing = try await loadIdentityKey() {
            return existing
        }
        let fresh = DeviceIdentitySigningKey()
        try await saveIdentityKey(fresh)
        return fresh
    }

    // MARK: - Pair entries

    public func savePair(_ record: PairRecord, derivedKeys: PairingDerivedKeys) async throws {
        let entry = PersistedPairEntry(
            v: 1,
            record: record,
            pairRootKey: derivedKeys.pairRootKey.base64,
            macToControllerKey: derivedKeys.macToControllerKey.base64,
            controllerToMacKey: derivedKeys.controllerToMacKey.base64,
            attachmentWrapKey: derivedKeys.attachmentWrapKey.base64,
            cloudKitPayloadKey: derivedKeys.cloudKitPayloadKey.base64
        )
        let blob = try JSONEncoder().encode(entry)
        try await secretStore.save(blob, account: Self.pairEntryAccount(for: record.pairID))
        try await addToIndex(pairID: record.pairID)
    }

    public func loadPair(pairID: PairID) async throws -> (record: PairRecord, derivedKeys: PairingDerivedKeys)? {
        guard let blob = try await secretStore.read(account: Self.pairEntryAccount(for: pairID)) else { return nil }
        let entry = try JSONDecoder().decode(PersistedPairEntry.self, from: blob)
        guard entry.v == 1 else { throw KeychainPairStorageError.unknownVersion(version: entry.v) }
        guard
            let pairRoot = SymmetricKey(base64: entry.pairRootKey),
            let macToCtl = SymmetricKey(base64: entry.macToControllerKey),
            let ctlToMac = SymmetricKey(base64: entry.controllerToMacKey),
            let attachWrap = SymmetricKey(base64: entry.attachmentWrapKey),
            let cloudKitPayload = SymmetricKey(base64: entry.cloudKitPayloadKey)
        else {
            throw KeychainPairStorageError.malformedPairEntry(pairID: pairID.rawValue)
        }
        let derived = PairingDerivedKeys(
            pairRootKey: pairRoot,
            macToControllerKey: macToCtl,
            controllerToMacKey: ctlToMac,
            attachmentWrapKey: attachWrap,
            cloudKitPayloadKey: cloudKitPayload
        )
        return (record: entry.record, derivedKeys: derived)
    }

    public func loadAllPairs() async throws -> [PairRecord] {
        let pairIDs = try await readIndex()
        var records: [PairRecord] = []
        for pairID in pairIDs {
            if let pair = try await loadPair(pairID: pairID) {
                records.append(pair.record)
            }
        }
        return records
    }

    public func deletePair(pairID: PairID) async throws {
        try await secretStore.delete(account: Self.pairEntryAccount(for: pairID))
        try await removeFromIndex(pairID: pairID)
    }

    public func clearAllPairs() async throws {
        let pairIDs = try await readIndex()
        for pairID in pairIDs {
            try await secretStore.delete(account: Self.pairEntryAccount(for: pairID))
        }
        try await secretStore.delete(account: Self.indexAccount)
    }

    // MARK: - Internal storage helpers

    private static let identityAccount = "identity.signing.key"
    private static let indexAccount = "pairs.index"
    private static func pairEntryAccount(for pairID: PairID) -> String {
        "pair.\(pairID.rawValue).entry"
    }

    private func readIndex() async throws -> [PairID] {
        guard let blob = try await secretStore.read(account: Self.indexAccount) else { return [] }
        let envelope = try JSONDecoder().decode(IndexEnvelope.self, from: blob)
        return envelope.pairIDs.map { PairID($0) }
    }

    private func writeIndex(_ pairIDs: [PairID]) async throws {
        let envelope = IndexEnvelope(v: 1, pairIDs: pairIDs.map(\.rawValue))
        let blob = try JSONEncoder().encode(envelope)
        try await secretStore.save(blob, account: Self.indexAccount)
    }

    private func addToIndex(pairID: PairID) async throws {
        var current = try await readIndex()
        if !current.contains(pairID) {
            current.append(pairID)
            try await writeIndex(current)
        }
    }

    private func removeFromIndex(pairID: PairID) async throws {
        var current = try await readIndex()
        current.removeAll(where: { $0 == pairID })
        try await writeIndex(current)
    }
}

// MARK: - Persisted envelopes (versioned JSON shapes)

private struct IdentityKeyEnvelope: Codable {
    let v: Int
    let privateKeyBase64: String
}

private struct PersistedPairEntry: Codable {
    let v: Int
    let record: KeychainPairStorage.PairRecord
    let pairRootKey: String
    let macToControllerKey: String
    let controllerToMacKey: String
    let attachmentWrapKey: String
    let cloudKitPayloadKey: String
}

private struct IndexEnvelope: Codable {
    let v: Int
    let pairIDs: [String]
}

// MARK: - SymmetricKey base64 helpers

private extension SymmetricKey {
    var base64: String {
        withUnsafeBytes { Data($0).base64EncodedString() }
    }

    init?(base64: String) {
        guard let bytes = Data(base64Encoded: base64), bytes.count == 32 else { return nil }
        self.init(data: bytes)
    }
}
