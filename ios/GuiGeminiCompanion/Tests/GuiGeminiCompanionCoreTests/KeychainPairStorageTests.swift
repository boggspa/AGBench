import XCTest
import Foundation
import CryptoKit
import BridgeCore
import BridgeCryptoPairing
@testable import GuiGeminiCompanionCore

final class KeychainPairStorageTests: XCTestCase {
    private func makeStorage() -> KeychainPairStorage {
        KeychainPairStorage(secretStore: InMemorySecretStore())
    }

    private func sampleDerivedKeys() -> PairingDerivedKeys {
        let mac = P256.KeyAgreement.PrivateKey()
        let ctl = P256.KeyAgreement.PrivateKey()
        return try! PairingKeyDeriver.deriveFromControllerSide(
            controllerPrivateKey: ctl,
            macPublicKeyData: mac.publicKey.rawRepresentation,
            macNonce: Data(repeating: 0xAB, count: 32),
            controllerNonce: Data(repeating: 0xCD, count: 32)
        )
    }

    private func sampleRecord(pairID: String = "pair-1") -> KeychainPairStorage.PairRecord {
        KeychainPairStorage.PairRecord(
            pairID: PairID(pairID),
            controllerDeviceID: DeviceID("iphone-1"),
            macDeviceID: DeviceID("mac-1"),
            macDisplayName: "Chris's Mac",
            tailscaleEndpointHint: nil,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
    }

    // MARK: - Identity key

    func testLoadIdentityKeyReturnsNilOnFirstRun() async throws {
        let storage = makeStorage()
        let key = try await storage.loadIdentityKey()
        XCTAssertNil(key)
    }

    func testSaveAndLoadIdentityKeyRoundTrip() async throws {
        let storage = makeStorage()
        let fresh = DeviceIdentitySigningKey()
        try await storage.saveIdentityKey(fresh)
        let loaded = try await storage.loadIdentityKey()
        XCTAssertNotNil(loaded)
        XCTAssertEqual(
            loaded?.publicKeyRawRepresentation,
            fresh.publicKeyRawRepresentation
        )
        XCTAssertEqual(loaded?.identityKeyID, fresh.identityKeyID)
    }

    func testLoadOrCreateIdentityKeyReturnsExisting() async throws {
        let storage = makeStorage()
        let first = try await storage.loadOrCreateIdentityKey()
        let second = try await storage.loadOrCreateIdentityKey()
        XCTAssertEqual(first.publicKeyRawRepresentation, second.publicKeyRawRepresentation)
        XCTAssertEqual(first.identityKeyID, second.identityKeyID)
    }

    func testLoadOrCreateIdentityKeyGeneratesNewWhenAbsent() async throws {
        let storage = makeStorage()
        let key = try await storage.loadOrCreateIdentityKey()
        XCTAssertEqual(key.publicKeyRawRepresentation.count, P256.Signing.PrivateKey().publicKey.rawRepresentation.count)
    }

    // MARK: - Pair entries

    func testSaveAndLoadPairRoundTrip() async throws {
        let storage = makeStorage()
        let record = KeychainPairStorage.PairRecord(
            pairID: PairID("pair-1"),
            controllerDeviceID: DeviceID("iphone-1"),
            macDeviceID: DeviceID("mac-1"),
            macDisplayName: "Chris's Mac",
            tailscaleEndpointHint: "100.64.10.20:38747",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let derived = sampleDerivedKeys()
        try await storage.savePair(record, derivedKeys: derived)
        let loaded = try await storage.loadPair(pairID: record.pairID)
        XCTAssertNotNil(loaded)
        XCTAssertEqual(loaded?.record, record)
        XCTAssertEqual(loaded?.record.tailscaleEndpointHint, "100.64.10.20:38747")
        XCTAssertEqual(
            loaded?.derivedKeys.pairRootKey.withUnsafeBytes { Data($0) },
            derived.pairRootKey.withUnsafeBytes { Data($0) }
        )
        XCTAssertEqual(
            loaded?.derivedKeys.macToControllerKey.withUnsafeBytes { Data($0) },
            derived.macToControllerKey.withUnsafeBytes { Data($0) }
        )
        XCTAssertEqual(
            loaded?.derivedKeys.controllerToMacKey.withUnsafeBytes { Data($0) },
            derived.controllerToMacKey.withUnsafeBytes { Data($0) }
        )
    }

    func testLoadPairReturnsNilForUnknownID() async throws {
        let storage = makeStorage()
        let loaded = try await storage.loadPair(pairID: PairID("never-saved"))
        XCTAssertNil(loaded)
    }

    func testLoadAllPairsReturnsEverythingInIndex() async throws {
        let storage = makeStorage()
        for id in ["a", "b", "c"] {
            try await storage.savePair(sampleRecord(pairID: id), derivedKeys: sampleDerivedKeys())
        }
        let records = try await storage.loadAllPairs()
        let ids = Set(records.map(\.pairID.rawValue))
        XCTAssertEqual(ids, ["a", "b", "c"])
    }

    func testDeletePairRemovesEntryAndUpdatesIndex() async throws {
        let storage = makeStorage()
        try await storage.savePair(sampleRecord(pairID: "a"), derivedKeys: sampleDerivedKeys())
        try await storage.savePair(sampleRecord(pairID: "b"), derivedKeys: sampleDerivedKeys())
        try await storage.deletePair(pairID: PairID("a"))
        let loadedA = try await storage.loadPair(pairID: PairID("a"))
        XCTAssertNil(loadedA)
        let loadedB = try await storage.loadPair(pairID: PairID("b"))
        XCTAssertNotNil(loadedB)
        let remaining = try await storage.loadAllPairs()
        XCTAssertEqual(remaining.map(\.pairID.rawValue), ["b"])
    }

    func testClearAllPairsLeavesIdentityKeyIntact() async throws {
        let storage = makeStorage()
        let identity = try await storage.loadOrCreateIdentityKey()
        try await storage.savePair(sampleRecord(pairID: "a"), derivedKeys: sampleDerivedKeys())
        try await storage.clearAllPairs()
        let remaining = try await storage.loadAllPairs()
        XCTAssertEqual(remaining, [])
        // Identity key should survive.
        let identityAfter = try await storage.loadIdentityKey()
        XCTAssertEqual(identityAfter?.identityKeyID, identity.identityKeyID)
    }

    func testReSaveOverwritesExistingPair() async throws {
        let storage = makeStorage()
        let recordA = sampleRecord(pairID: "pair-1")
        let recordB = KeychainPairStorage.PairRecord(
            pairID: PairID("pair-1"),
            controllerDeviceID: DeviceID("iphone-1"),
            macDeviceID: DeviceID("mac-2"),  // <-- changed
            macDisplayName: "Other Mac",
            tailscaleEndpointHint: "100.64.10.21:38747",
            createdAt: Date()
        )
        try await storage.savePair(recordA, derivedKeys: sampleDerivedKeys())
        try await storage.savePair(recordB, derivedKeys: sampleDerivedKeys())
        let loaded = try await storage.loadPair(pairID: PairID("pair-1"))
        XCTAssertEqual(loaded?.record.macDeviceID.rawValue, "mac-2")
        XCTAssertEqual(loaded?.record.tailscaleEndpointHint, "100.64.10.21:38747")
        // Index should still contain only one entry.
        let all = try await storage.loadAllPairs()
        XCTAssertEqual(all.count, 1)
    }

    func testSaveRunEventCursorPersistsHighestSequence() async throws {
        let storage = makeStorage()
        let record = sampleRecord(pairID: "pair-1")
        let derived = sampleDerivedKeys()
        try await storage.savePair(record, derivedKeys: derived)

        try await storage.saveRunEventCursor(pairID: record.pairID, runId: "run-1", sequence: 4)
        try await storage.saveRunEventCursor(pairID: record.pairID, runId: "run-1", sequence: 3)

        let loaded = try await storage.loadPair(pairID: record.pairID)
        XCTAssertEqual(loaded?.record.cursors["run-1"], 4)
    }

    func testPairRecordDecodesOldShapeWithoutCursors() throws {
        let legacyJSON = """
        {
          "pairID": "pair-1",
          "controllerDeviceID": "iphone-1",
          "macDeviceID": "mac-1",
          "createdAt": 700000000
        }
        """.data(using: .utf8)!

        let record = try JSONDecoder().decode(KeychainPairStorage.PairRecord.self, from: legacyJSON)
        XCTAssertEqual(record.pairID.rawValue, "pair-1")
        XCTAssertEqual(record.cursors, [:])
    }
}
