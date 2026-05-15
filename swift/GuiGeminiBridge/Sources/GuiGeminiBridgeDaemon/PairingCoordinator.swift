import Foundation
import CryptoKit
import BridgeCore
import BridgeCryptoPairing

/// Orchestrates the pairing handshake on the daemon side.
///
/// State machine (Phase C2 v1):
///
///     beginPairing(displayName)
///        │  generate ephemeral P256 keypair + nonce
///        │  produce PairingBootstrapPayload — caller renders as QR
///        ▼
///     ┌──────────────────┐
///     │ pendingByID[sid] │ (PendingPairing)
///     └──────────────────┘
///        │  iPhone scans, sends back PairingResponsePayload
///        │  daemon receives it via `confirmPairing(...)`
///        ▼
///     deriveKeys(macPriv, controllerPub) + sixDigitConfirmationCode
///        │  caller surfaces code to BOTH ends; user confirms match
///        ▼
///     finalizePairing(sid, userConfirmed: true)
///        │  upsert TrustedDeviceRecord, drop pending entry
///        ▼
///     ┌────────────────────┐
///     │ deviceStore upsert │
///     └────────────────────┘
///
/// On `finalizePairing(sid, userConfirmed: false)` the pending entry is
/// discarded and no record is written. Codes-don't-match attacks fail closed.
///
/// Things deliberately NOT here (Phase C-late):
///   - Mac identity signing key persistence (currently generated per coordinator).
///   - Response signature verification (the iPhone's signature is optional in
///     PairingResponsePayload; v1 trusts the confirmation-code match).
///   - Pair-secret derivation persistence (current keys live in pendingByID
///     and on `TrustedDeviceRecord.identityKeyID`; transport setup in Phase C3
///     will need the actual derived keys plumbed through).
///
/// All operations are async because the underlying `TrustedDeviceStore`
/// protocol is async.
public actor PairingCoordinator {
    public struct BeginPairingResult: Sendable, Encodable {
        public let pairingSessionID: String
        public let bootstrapPayload: PairingBootstrapPayload
    }

    public struct ConfirmPairingResult: Sendable, Encodable {
        public let pairingSessionID: String
        public let controllerDeviceID: String
        public let controllerDisplayName: String
        public let confirmationCode: String
    }

    public struct FinalizePairingResult: Sendable, Encodable {
        public let pairingSessionID: String
        public let trustedDevice: TrustedDeviceRecord?
    }

    public enum PairingError: Error, Equatable {
        case sessionNotFound(String)
        case sessionAlreadyConfirmed(String)
        case sessionExpired(String)
        case malformedPublicKey
        case missingResponseForFinalize(String)
    }

    private struct PendingPairing {
        let sessionID: String
        let macPrivateKey: P256.KeyAgreement.PrivateKey
        let macIdentitySigningKey: DeviceIdentitySigningKey
        let bootstrap: PairingBootstrapPayload
        var response: PairingResponsePayload?
        var derivedKeys: PairingDerivedKeys?
        var confirmationCode: String?
        var transcript: PairingTranscript?
    }

    private let deviceStore: TrustedDeviceStore
    private let secretStore: SecretStore
    private let macDeviceID: DeviceID
    private let macIdentitySigningKey: DeviceIdentitySigningKey
    private let now: @Sendable () -> Date
    private let sessionLifetime: TimeInterval
    private var pendingByID: [String: PendingPairing] = [:]

    public init(
        deviceStore: TrustedDeviceStore,
        secretStore: SecretStore,
        macDeviceID: DeviceID,
        macIdentitySigningKey: DeviceIdentitySigningKey,
        sessionLifetime: TimeInterval = 300, // 5 minutes
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.deviceStore = deviceStore
        self.secretStore = secretStore
        self.macDeviceID = macDeviceID
        self.macIdentitySigningKey = macIdentitySigningKey
        self.sessionLifetime = sessionLifetime
        self.now = now
    }

    /// Generate a bootstrap payload + ephemeral keypair for a new pairing.
    /// Returns the payload the caller should encode into a QR code (or print
    /// to the user) plus the session id that ties the subsequent
    /// `confirmPairing` and `finalizePairing` calls.
    public func beginPairing(controllerDisplayName: String) -> BeginPairingResult {
        pruneExpiredSessions()
        _ = controllerDisplayName // currently unused; the display name comes
                                  // from the iPhone in the response payload.
                                  // Keeping the parameter so the API surface
                                  // doesn't change when we wire APNs hinting.

        let sessionID = UUID().uuidString
        let macPrivateKey = P256.KeyAgreement.PrivateKey()
        let nonce = Data((0..<32).map { _ in UInt8.random(in: 0...255) })

        let bootstrap = PairingBootstrapPayload(
            pairingSessionID: sessionID,
            macDeviceID: macDeviceID,
            macIdentityKeyID: macIdentitySigningKey.identityKeyID,
            macEphemeralPublicKey: macPrivateKey.publicKey.rawRepresentation,
            macNonce: nonce,
            expiresAt: now().addingTimeInterval(sessionLifetime),
            bonjourServiceName: BridgeProductConfiguration.current.bonjourServiceType,
            tailscaleEndpointHint: nil,
            quicTransportCertificateSHA256: nil
        )

        pendingByID[sessionID] = PendingPairing(
            sessionID: sessionID,
            macPrivateKey: macPrivateKey,
            macIdentitySigningKey: macIdentitySigningKey,
            bootstrap: bootstrap,
            response: nil,
            derivedKeys: nil,
            confirmationCode: nil,
            transcript: nil
        )

        return BeginPairingResult(pairingSessionID: sessionID, bootstrapPayload: bootstrap)
    }

    /// Process the iPhone's response. Derives the shared key material, computes
    /// the 6-digit confirmation code, and stores everything against the session
    /// so `finalizePairing` can complete or reject.
    public func confirmPairing(response: PairingResponsePayload) throws -> ConfirmPairingResult {
        pruneExpiredSessions()
        guard var pending = pendingByID[response.pairingSessionID] else {
            throw PairingError.sessionNotFound(response.pairingSessionID)
        }
        if pending.confirmationCode != nil {
            throw PairingError.sessionAlreadyConfirmed(response.pairingSessionID)
        }

        let derived: PairingDerivedKeys
        do {
            derived = try PairingKeyDeriver.deriveFromMacSide(
                macPrivateKey: pending.macPrivateKey,
                controllerPublicKeyData: response.controllerEphemeralPublicKey,
                macNonce: pending.bootstrap.macNonce,
                controllerNonce: response.controllerNonce
            )
        } catch {
            throw PairingError.malformedPublicKey
        }

        let transcript = PairingTranscript(bootstrap: pending.bootstrap, response: response)
        let code = try PairingCodeFormatter.sixDigitConfirmationCode(for: transcript)

        pending.response = response
        pending.derivedKeys = derived
        pending.confirmationCode = code
        pending.transcript = transcript
        pendingByID[response.pairingSessionID] = pending

        return ConfirmPairingResult(
            pairingSessionID: response.pairingSessionID,
            controllerDeviceID: response.controllerDeviceID.rawValue,
            controllerDisplayName: response.controllerDisplayName,
            confirmationCode: code
        )
    }

    /// Persist a `TrustedDeviceRecord` when the user confirms the codes match
    /// on both ends, or discard the session if not. Returns the resulting
    /// record (or nil when discarded).
    public func finalizePairing(
        pairingSessionID: String,
        userConfirmed: Bool
    ) async throws -> FinalizePairingResult {
        guard let pending = pendingByID[pairingSessionID] else {
            throw PairingError.sessionNotFound(pairingSessionID)
        }
        guard pending.response != nil else {
            throw PairingError.missingResponseForFinalize(pairingSessionID)
        }
        pendingByID.removeValue(forKey: pairingSessionID)
        guard userConfirmed else {
            return FinalizePairingResult(pairingSessionID: pairingSessionID, trustedDevice: nil)
        }

        guard let response = pending.response else {
            throw PairingError.missingResponseForFinalize(pairingSessionID)
        }

        let timestamp = now()
        let pairID = PairID(UUID().uuidString.lowercased())
        let record = TrustedDeviceRecord(
            deviceID: response.controllerDeviceID,
            pairID: pairID,
            displayName: response.controllerDisplayName,
            platform: .iOS,
            pairingState: .active,
            identityKeyID: pending.macIdentitySigningKey.identityKeyID,
            createdAt: timestamp,
            updatedAt: timestamp,
            lastSeenAt: nil,
            suspendedAt: nil,
            revokedAt: nil,
            lastRotatedAt: nil,
            rotationGeneration: 0
        )
        await deviceStore.upsert(record)

        // Phase C3.0: persist the derived pair-secret keys so the transport
        // listener can rebuild `LANBridgeServer.TrustedController` records
        // after a daemon restart. Failure here is non-fatal — the record is
        // already stored, but the device will need to re-pair to reach the
        // transport layer. Surfacing the error to the caller would prematurely
        // fail an otherwise-successful pairing.
        if let derivedKeys = pending.derivedKeys {
            do {
                try await PairSecretsStore.save(
                    secretStore: secretStore,
                    pairID: pairID,
                    keys: derivedKeys
                )
            } catch {
                FileHandle.standardError.write(Data(
                    "[PairingCoordinator] WARN: failed to persist pair secrets for \(pairID.rawValue): \(error.localizedDescription)\n".utf8
                ))
            }
        }

        return FinalizePairingResult(pairingSessionID: pairingSessionID, trustedDevice: record)
    }

    /// Diagnostic snapshot of the currently-pending sessions. Used by
    /// `bridge.status` extensions in later phases.
    public func pendingSessionCount() -> Int {
        pruneExpiredSessions()
        return pendingByID.count
    }

    /// Drop any session whose `bootstrap.expiresAt` is in the past.
    private func pruneExpiredSessions() {
        let cutoff = now()
        let stale = pendingByID.filter { $0.value.bootstrap.expiresAt < cutoff }.map(\.key)
        for sessionID in stale {
            pendingByID.removeValue(forKey: sessionID)
        }
    }
}
