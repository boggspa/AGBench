import Foundation
import BridgeCore
import BridgeCryptoPrimitives
import BridgeCryptoPairing

/// File-backed `TrustedDeviceStore` implementation.
///
/// `BridgeCryptoPairing` ships only `InMemoryTrustedDeviceStore`. For the
/// daemon we need persistence so a paired iPhone survives a Mac restart:
/// the file lives at
/// `~/Library/Application Support/<supportDirectoryName>/trusted-devices.json`
/// (where `supportDirectoryName` comes from `BridgeProductConfiguration`).
///
/// Writes are coalesced inside an actor — every mutation re-encodes the full
/// record set and atomically replaces the file on disk. The set is tiny (one
/// entry per paired device, typically <10) so simple full-rewrites trump
/// any incremental-update scheme.
public actor FileTrustedDeviceStore: TrustedDeviceStore {
    public enum FileTrustedDeviceStoreError: Error, Equatable {
        case directoryUnavailable
        case encodingFailed(String)
        case writeFailed(String)
    }

    private let fileURL: URL
    private var recordsByDeviceID: [DeviceID: TrustedDeviceRecord] = [:]
    private var loaded = false

    public init(fileURL: URL) {
        self.fileURL = fileURL
    }

    /// Convenience constructor — resolve the storage path from the current
    /// product configuration's support-directory name.
    public init() throws {
        let support = try FileTrustedDeviceStore.defaultStorageURL()
        self.fileURL = support
    }

    public static func defaultStorageURL() throws -> URL {
        let fm = FileManager.default
        let base = try fm.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let scoped = base.appendingPathComponent(
            BridgeProductConfiguration.current.quicTransport.supportDirectoryName,
            isDirectory: true
        )
        try fm.createDirectory(at: scoped, withIntermediateDirectories: true)
        return scoped.appendingPathComponent("trusted-devices.json", isDirectory: false)
    }

    // MARK: - TrustedDeviceStore protocol

    public func record(for deviceID: DeviceID) async -> TrustedDeviceRecord? {
        ensureLoaded()
        return recordsByDeviceID[deviceID]
    }

    public func upsert(_ record: TrustedDeviceRecord) async {
        ensureLoaded()
        recordsByDeviceID[record.deviceID] = record
        await persist()
    }

    public func revoke(deviceID: DeviceID, at date: Date) async {
        ensureLoaded()
        guard let record = recordsByDeviceID[deviceID] else { return }
        recordsByDeviceID[deviceID] = record.revoked(at: date)
        await persist()
    }

    public func suspend(deviceID: DeviceID, at date: Date) async {
        ensureLoaded()
        guard let record = recordsByDeviceID[deviceID], record.pairingState != .revoked else { return }
        recordsByDeviceID[deviceID] = record.suspended(at: date)
        await persist()
    }

    public func activate(deviceID: DeviceID, at date: Date) async {
        ensureLoaded()
        guard let record = recordsByDeviceID[deviceID], record.pairingState != .revoked else { return }
        recordsByDeviceID[deviceID] = record.activated(at: date)
        await persist()
    }

    public func rename(deviceID: DeviceID, displayName: String, at date: Date) async {
        ensureLoaded()
        guard let record = recordsByDeviceID[deviceID] else { return }
        recordsByDeviceID[deviceID] = record.renamed(displayName, at: date)
        await persist()
    }

    public func markSeen(deviceID: DeviceID, at date: Date) async {
        ensureLoaded()
        guard let record = recordsByDeviceID[deviceID] else { return }
        recordsByDeviceID[deviceID] = record.markSeen(at: date)
        await persist()
    }

    public func rotate(deviceID: DeviceID, at date: Date, reason: String) async -> TrustedDeviceKeyRotationAuditRecord? {
        // Phase C2 v1: no key rotation. Returning nil is contract-legal per
        // the protocol; the audit log surfaces "not implemented".
        _ = (deviceID, date, reason)
        return nil
    }

    public func isActive(deviceID: DeviceID, pairID: PairID) async -> Bool {
        ensureLoaded()
        guard let record = recordsByDeviceID[deviceID] else { return false }
        return record.pairID == pairID && record.pairingState == .active
    }

    // MARK: - Snapshot for diagnostics + listing

    /// Read-only snapshot of every record. Used by the daemon's
    /// `bridge.listTrustedDevices` method.
    public func snapshot() async -> [TrustedDeviceRecord] {
        ensureLoaded()
        return Array(recordsByDeviceID.values).sorted { $0.createdAt < $1.createdAt }
    }

    // MARK: - I/O

    private func ensureLoaded() {
        if loaded { return }
        loaded = true
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        guard let data = try? Data(contentsOf: fileURL) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        // 1.0.6 — Swift 6.2+ parser disambiguation: `[TrustedDeviceRecord].self`
        // is parsed as `[TrustedDeviceRecord.Type]` (array literal of metatypes)
        // rather than `Array<TrustedDeviceRecord>.Type`, breaking the decode
        // call. Use the unambiguous `Array<…>.self` long form. Restores `npm run
        // prebuild:bridge-daemon` (and the `build:mac:notarized` ship script).
        guard let records = try? decoder.decode(Array<TrustedDeviceRecord>.self, from: data) else {
            // Corrupt or version-mismatched file — treat as empty rather than
            // crashing. A future Phase C-late will surface a recovery event.
            return
        }
        for record in records {
            recordsByDeviceID[record.deviceID] = record
        }
    }

    private func persist() async {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys, .prettyPrinted]
        let records = Array(recordsByDeviceID.values).sorted { $0.createdAt < $1.createdAt }
        guard let data = try? encoder.encode(records) else { return }
        // Atomic write: write to a sibling tmp file and rename.
        let tmpURL = fileURL.appendingPathExtension("tmp")
        do {
            try data.write(to: tmpURL, options: .atomic)
            if FileManager.default.fileExists(atPath: fileURL.path) {
                _ = try FileManager.default.replaceItemAt(fileURL, withItemAt: tmpURL)
            } else {
                try FileManager.default.moveItem(at: tmpURL, to: fileURL)
            }
        } catch {
            // Persistence is best-effort. The in-memory map remains the
            // source of truth for the current daemon lifetime.
            try? FileManager.default.removeItem(at: tmpURL)
        }
    }
}
