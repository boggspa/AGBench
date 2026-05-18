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
    var pairingViewModel: PairingViewModel

    @ObservationIgnored
    private let pairStorage: KeychainPairStorage
    private(set) var bridgeClient: GuiGeminiBridgeClient?
    private(set) var transcriptViewModel: TranscriptViewModel?
    private(set) var approvalViewModel: ApprovalViewModel?
    private(set) var composerViewModel: ComposerViewModel?
    private(set) var pushRegistrar: PushNotificationRegistrar?
    /// Sidebar data store consumed by the iPad shell. Populated by the
    /// workspace/thread summary broadcasts the desktop emits over the
    /// bridge — see `sidebarSummariesTask`. Always present so views can
    /// bind to it before pairing completes (it just starts empty).
    @ObservationIgnored
    let sidebarStore: iPadSidebarStore = iPadSidebarStore()
    /// Task that drains the bridge client's `runEvents` stream and routes
    /// summary-kind events to `sidebarStore`. Cancelled in `disconnect()`.
    @ObservationIgnored
    private var sidebarSummariesTask: Task<Void, Never>?
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

    init(pairStorage: KeychainPairStorage = .production()) {
        self.pairStorage = pairStorage
        self.pairingViewModel = PairingViewModel(
            controllerDisplayName: friendlyDeviceName(),
            pairStorage: pairStorage
        )
    }

    func connect(with pair: GuiGeminiBridgeClient.Pair) async {
        logIOSBridgeApp("connect requested pairID=\(pair.pairID.rawValue) macDeviceID=\(pair.macDeviceID.rawValue)")
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
        // Workspace + thread summary subscriber. Drains the same
        // `runEvents` stream the transcript consumes; the decoder returns
        // nil for non-summary channels so we cheaply skip them without
        // a second stream. The store is `@MainActor` so all apply calls
        // hop back to the main actor.
        let store = self.sidebarStore
        let summaries = client.runEvents
        sidebarSummariesTask?.cancel()
        sidebarSummariesTask = Task { @MainActor in
            for await event in summaries {
                logIOSBridgeApp("summary stream event channel=\(event.channel.rawValue) provider=\(event.provider)")
                guard let decoded = try? BridgeWorkspaceSummariesDecoder.decode(event: event) else {
                    continue
                }
                switch decoded {
                case .workspaceList(let payload):
                    logIOSBridgeApp("apply workspace-list count=\(payload.workspaces.count)")
                    store.applyWorkspaceList(payload.workspaces)
                case .workspaceUpdated(let payload):
                    logIOSBridgeApp("apply workspace-updated workspaceID=\(payload.workspace.workspaceId)")
                    store.applyWorkspaceUpdate(payload.workspace)
                case .threadList(let payload):
                    logIOSBridgeApp("apply thread-list count=\(payload.threads.count)")
                    store.applyThreadList(payload.threads)
                case .threadUpdated(let payload):
                    logIOSBridgeApp("apply thread-updated chatID=\(payload.thread.chatId)")
                    store.applyThreadUpdate(payload.thread)
                }
            }
        }
        await client.start()
        logIOSBridgeApp("client.start returned pairID=\(pair.pairID.rawValue)")
        // If an APNs token already arrived before pairing (typical:
        // AppDelegate registers eagerly), drain it now.
        if let pending = pendingDeviceToken {
            await registerPushToken(pending)
        }
    }

    func unpair() async {
        do {
            try await pairStorage.clearAllPairs()
        } catch {
            logIOSBridgeApp("unpair storage cleanup failed: \(error.localizedDescription)")
        }
        await disconnect()
    }

    func disconnect() async {
        await bridgeClient?.stop()
        transcriptViewModel?.detach()
        sidebarSummariesTask?.cancel()
        sidebarSummariesTask = nil
        sidebarStore.applyWorkspaceList([])
        sidebarStore.applyThreadList([])
        bridgeClient = nil
        transcriptViewModel = nil
        approvalViewModel = nil
        composerViewModel = nil
        pushRegistrar = nil
        pairingViewModel = PairingViewModel(
            controllerDisplayName: friendlyDeviceName(),
            pairStorage: pairStorage
        )
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

private func logIOSBridgeApp(_ message: String) {
    print("[iOS Bridge] \(message)")
}
