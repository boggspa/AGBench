import Foundation
import BridgeCore

/// PushNotificationRegistrar — cross-platform glue between the iOS
/// AppDelegate's `didRegisterForRemoteNotificationsWithDeviceToken`
/// callback and the `BridgeActionPayload.registerApnsToken` action.
///
/// Lives in the library (not the iOS-only `App/` target) so it stays
/// unit-testable on macOS — the iOS-side AppDelegate is the thin shim
/// that translates the raw token bytes into a `register(deviceToken:)`
/// call.
///
/// Wire:
///   1. iOS AppDelegate receives `Data` token (typically 32 bytes).
///   2. Registrar formats as lowercase hex string.
///   3. Sends `BridgeActionPayload.registerApnsToken(pairID, hex, env)`
///      via `GuiGeminiBridgeClient.sendAction(...)`.
///   4. Desktop's `BridgeActionRouter` routes to
///      `BridgeApnsTokenStore.upsert(...)` (the variant bypasses the
///      workspace allowlist since it's paired-device-level).
public actor PushNotificationRegistrar {
    public enum RegistrationResult: Sendable, Equatable {
        case registered(tokenHex: String)
        case alreadyRegistered(tokenHex: String)
        case rejected(reason: String)
    }

    public enum RegistrationError: Error, Sendable, CustomStringConvertible {
        case emptyToken
        case sendFailed(String)

        public var description: String {
            switch self {
            case .emptyToken: return "Push token is empty"
            case .sendFailed(let s): return "Push registration send failed: \(s)"
            }
        }
    }

    private let client: GuiGeminiBridgeClient
    private let pairID: PairID
    private let env: BridgeActionPayload.ApnsEnv
    /// Token hex from the most recent successful registration. nil
    /// until first register. Used to suppress repeat-registration when
    /// the OS hands us the same token across launches.
    private var lastRegisteredHex: String?

    public init(
        client: GuiGeminiBridgeClient,
        pairID: PairID,
        env: BridgeActionPayload.ApnsEnv
    ) {
        self.client = client
        self.pairID = pairID
        self.env = env
    }

    /// Encode the OS-provided token bytes as lowercase hex and ship a
    /// `registerApnsToken` action. Returns `.alreadyRegistered` if the
    /// hex matches the most recent registration (no wasted action send).
    public func register(deviceToken: Data) async throws -> RegistrationResult {
        guard !deviceToken.isEmpty else { throw RegistrationError.emptyToken }
        let hex = Self.hexEncode(deviceToken)
        if hex == lastRegisteredHex {
            return .alreadyRegistered(tokenHex: hex)
        }
        let action = BridgeActionPayload.registerApnsToken(
            pairID: pairID.rawValue,
            deviceToken: hex,
            env: env
        )
        let ack: BridgeActionAck?
        do {
            ack = try await client.sendAction(action)
        } catch {
            throw RegistrationError.sendFailed(error.localizedDescription)
        }
        if ack?.accepted == true {
            lastRegisteredHex = hex
            return .registered(tokenHex: hex)
        }
        return .rejected(reason: ack?.message ?? "Desktop did not accept the registration")
    }

    /// Drop the cached hex so the next `register(...)` will resend even
    /// if the token hasn't changed. Used on disconnect / pair revoke /
    /// env switch (production ↔ sandbox).
    public func forgetCachedRegistration() {
        lastRegisteredHex = nil
    }

    /// Most-recently-registered hex (read-only). Diagnostic surface.
    public var lastRegistration: String? {
        lastRegisteredHex
    }

    // MARK: - Helpers

    /// Lowercase hex encoder. Apple's typical APNs token format is 64
    /// hex chars; matches what the back-end services expect.
    static func hexEncode(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}
