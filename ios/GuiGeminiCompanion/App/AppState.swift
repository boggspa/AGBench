import Foundation
import Observation
import GuiGeminiCompanionCore

/// AppState — top-level observable state owning the bridge client (once
/// pairing completes) and the per-screen view models.
///
/// Lifecycle:
///   - Constructed at app launch with no client.
///   - PairingView writes to `pairingViewModel`; on confirm it produces
///     a `GuiGeminiBridgeClient.Pair` which `connect(with:)` consumes.
///   - `connect(with:)` instantiates the bridge client, starts it, and
///     creates the screen view models that depend on it.
///   - The user can sign out via `disconnect()` to return to pairing.
@Observable
@MainActor
final class AppState {
    var pairingViewModel = PairingViewModel(controllerDisplayName: friendlyDeviceName())

    private(set) var bridgeClient: GuiGeminiBridgeClient?
    private(set) var transcriptViewModel: TranscriptViewModel?
    private(set) var approvalViewModel: ApprovalViewModel?
    private(set) var composerViewModel: ComposerViewModel?
    private(set) var pushRegistrar: PushNotificationRegistrar?
    /// Last APNs registration message surfaced from the desktop's ack,
    /// or from an OS-side registration failure. nil when push hasn't
    /// completed a registration cycle yet.
    private(set) var lastPushMessage: String?
    /// Cached APNs token bytes from the OS. Held until a pair is
    /// established so we can register immediately on connect.
    private(set) var pendingDeviceToken: Data?

    /// True once `connect(with:)` has completed and the client + view
    /// models are ready. The RootView switches to TabView when this is true.
    var isPaired: Bool {
        bridgeClient != nil
    }

    func connect(with pair: GuiGeminiBridgeClient.Pair) async {
        let client = GuiGeminiBridgeClient(pair: pair)
        self.bridgeClient = client
        let transcript = TranscriptViewModel(
            liveActivityController: AGBenchLiveActivityController()
        )
        transcript.attach(to: client)
        self.transcriptViewModel = transcript
        self.approvalViewModel = ApprovalViewModel(client: client)
        self.composerViewModel = ComposerViewModel(client: client)
        // APNs environment picked at compile time. DEBUG builds (Xcode
        // local + TestFlight) register with Apple's sandbox APNs gateway
        // (api.sandbox.push.apple.com); release builds use production.
        // The env is reported back to the Mac via
        // BridgeActionPayload.registerApnsToken so the desktop knows
        // which Apple gateway to target when sending pushes for this pair.
        #if DEBUG
        let apnsEnv: BridgeActionPayload.ApnsEnv = .sandbox
        #else
        let apnsEnv: BridgeActionPayload.ApnsEnv = .production
        #endif
        let registrar = PushNotificationRegistrar(client: client, pairID: pair.pairID, env: apnsEnv)
        self.pushRegistrar = registrar
        await client.start()
        // If an APNs token already arrived before pairing (typical:
        // AppDelegate registers eagerly), drain it now.
        if let pending = pendingDeviceToken {
            await registerPushToken(pending)
        }
    }

    func disconnect() async {
        await bridgeClient?.stop()
        transcriptViewModel?.detach()
        bridgeClient = nil
        transcriptViewModel = nil
        approvalViewModel = nil
        composerViewModel = nil
        pushRegistrar = nil
        pairingViewModel = PairingViewModel(controllerDisplayName: friendlyDeviceName())
    }

    // MARK: - APNs

    /// Called by AppDelegate when the OS hands us a fresh device token.
    /// Cached locally if no pair exists yet; forwarded immediately if
    /// pairing has completed.
    func handleAPNsToken(_ token: Data) async {
        pendingDeviceToken = token
        await registerPushToken(token)
    }

    /// Surface a registration error (OS refused, no network, etc.) so
    /// the UI can show a "push not available" hint.
    func recordPushError(_ message: String) {
        lastPushMessage = "Push registration error: \(message)"
    }

    private func registerPushToken(_ token: Data) async {
        guard let registrar = pushRegistrar else {
            // No pair → can't ship the action. Token stays cached in
            // pendingDeviceToken for when connect() runs.
            return
        }
        do {
            switch try await registrar.register(deviceToken: token) {
            case .registered:
                lastPushMessage = "Push registration accepted"
            case .alreadyRegistered:
                lastPushMessage = "Push token unchanged"
            case .rejected(let reason):
                lastPushMessage = "Push registration rejected: \(reason)"
            }
        } catch {
            lastPushMessage = "Push registration failed: \(error.localizedDescription)"
        }
    }
}

private func friendlyDeviceName() -> String {
    #if os(iOS)
    return "iPhone"
    #else
    return "Companion"
    #endif
}
