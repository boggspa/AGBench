import Foundation
import Observation
import os.log
import GuiGeminiCompanionCore

enum RemoteNotificationResumeTrigger: String, Sendable {
    case background
    case tap
    case launch
}

enum RemoteNotificationResumeResult: Sendable, Equatable {
    case ignored
    case noPair
    case snapshotRequested
    case snapshotUnavailable
}

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
    private(set) var remoteTaskConsoleViewModel: RemoteTaskConsoleViewModel?
    private(set) var pushRegistrar: PushNotificationRegistrar?
    /// Sidebar data store consumed by the iPad shell. Populated by the
    /// workspace/thread summary broadcasts the desktop emits over the
    /// bridge — see `sidebarSummariesTask`. Always present so views can
    /// bind to it before pairing completes (it just starts empty).
    @ObservationIgnored
    let sidebarStore: iPadSidebarStore = iPadSidebarStore()
    /// Single owner for `client.runEvents`. It fans each event out to the
    /// transcript, sidebar summaries, approval queue, and composer run
    /// state. Keeping one iterator prevents `AsyncStream` consumers from
    /// racing each other and splitting events.
    @ObservationIgnored
    private var runEventsFanoutTask: Task<Void, Never>?
    /// Session-scope YOLO ("auto-allow every approval") toggle. Mirrors
    /// the desktop's `sessionYoloState.enabled` flag. When set, the
    /// iOS settings tab dispatches `BridgeActionPayload.setYoloMode`
    /// so the desktop bypasses approval prompts; the iOS UI also
    /// optimistically auto-accepts any incoming approval card so it
    /// disappears without user interaction.
    var yoloModeEnabled: Bool = false
    /// Last APNs registration message surfaced from the desktop's ack,
    /// or from an OS-side registration failure. nil when push hasn't
    /// completed a registration cycle yet.
    private(set) var lastPushMessage: String?
    /// Cached APNs token bytes from the OS. Held until a pair is
    /// established so we can register immediately on connect.
    private(set) var pendingDeviceToken: Data?
    /// APNs tap/background pushes carry only route ids. Keep the most
    /// recent unresolved route until remote projection truth arrives and
    /// the task console can select the matching detail.
    private(set) var pendingNotificationRoute: RemoteNotificationRoute?
    private(set) var lastNotificationRoute: RemoteNotificationRoute?

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
        transcript.attach(to: client, consumeRunEvents: false)
        self.transcriptViewModel = transcript
        self.approvalViewModel = ApprovalViewModel(client: client)
        self.composerViewModel = ComposerViewModel(client: client)
        self.remoteTaskConsoleViewModel = RemoteTaskConsoleViewModel(client: client)
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
        let runEvents = client.runEvents
        runEventsFanoutTask?.cancel()
        runEventsFanoutTask = Task { @MainActor [weak self] in
            for await event in runEvents {
                guard let self else { continue }
                transcript.ingest(event)
                self.composerViewModel?.observeRunEvent(event)
                self.remoteTaskConsoleViewModel?.ingest(event)
                self.applyPendingNotificationRouteIfPossible()

                if let decoded = try? BridgeWorkspaceSummariesDecoder.decode(event: event) {
                    switch decoded {
                    case .workspaceList(let payload):
                        logIOSBridgeApp("apply workspace-list count=\(payload.workspaces.count)")
                        self.sidebarStore.applyWorkspaceList(payload.workspaces)
                    case .workspaceUpdated(let payload):
                        logIOSBridgeApp("apply workspace-updated workspaceID=\(payload.workspace.workspaceId)")
                        self.sidebarStore.applyWorkspaceUpdate(payload.workspace)
                    case .threadList(let payload):
                        logIOSBridgeApp("apply thread-list count=\(payload.threads.count)")
                        self.sidebarStore.applyThreadList(payload.threads)
                    case .threadUpdated(let payload):
                        logIOSBridgeApp("apply thread-updated chatID=\(payload.thread.chatId)")
                        self.sidebarStore.applyThreadUpdate(payload.thread)
                    }
                }

                guard let approval = BridgeApprovalEventDecoder.decode(event: event),
                      let vm = self.approvalViewModel
                else { continue }
                logIOSBridgeApp("approval enqueued id=\(approval.id) provider=\(approval.provider ?? "?") title=\(approval.displayTitle)")
                vm.enqueue(approval)
                if self.yoloModeEnabled {
                    await vm.respond(to: approval, decision: .accept, message: "yolo")
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
        runEventsFanoutTask?.cancel()
        runEventsFanoutTask = nil
        SidebarSubThreadAssociation.reset()
        sidebarStore.applyWorkspaceList([])
        sidebarStore.applyThreadList([])
        bridgeClient = nil
        transcriptViewModel = nil
        approvalViewModel = nil
        composerViewModel = nil
        remoteTaskConsoleViewModel = nil
        pushRegistrar = nil
        pairingViewModel = PairingViewModel(
            controllerDisplayName: friendlyDeviceName(),
            pairStorage: pairStorage
        )
    }

    /// Toggle the session-scope YOLO flag and notify the desktop. The
    /// iOS-local boolean is mirrored on the desktop via
    /// `BridgeActionPayload.setYoloMode` so subsequent approval
    /// prompts never reach the bridge in the first place; this
    /// remaining loop's local short-circuit is a belt-and-suspenders
    /// for any approval already in flight when the toggle flips.
    func setYoloMode(enabled: Bool) async {
        guard let client = bridgeClient else { return }
        guard let workspaceId = workspaceIdForYoloToggle() else {
            lastPushMessage = "Select an allowlisted workspace before toggling YOLO mode"
            return
        }
        do {
            let ack = try await client.sendAction(.setYoloMode(workspaceId: workspaceId, enabled: enabled))
            if ack?.accepted == true {
                yoloModeEnabled = enabled
            } else {
                lastPushMessage = ack?.message ?? "YOLO mode update rejected by desktop"
            }
        } catch {
            let log = OSLog(subsystem: "ai.guigemini.companion", category: "settings")
            os_log("setYoloMode send failed: %{public}@", log: log, type: .error, error.localizedDescription)
            lastPushMessage = "YOLO mode update failed: \(error.localizedDescription)"
        }
    }

    private func workspaceIdForYoloToggle() -> String? {
        if let composerWorkspace = composerViewModel?.workspaceId.trimmingCharacters(in: .whitespacesAndNewlines),
           !composerWorkspace.isEmpty {
            return composerWorkspace
        }
        if let approvalWorkspace = approvalViewModel?.pending.first?.workspaceId.trimmingCharacters(in: .whitespacesAndNewlines),
           !approvalWorkspace.isEmpty {
            return approvalWorkspace
        }
        return sidebarStore.workspaces.first?.id
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

    @discardableResult
    func handleRemoteNotification(
        userInfo: [AnyHashable: Any],
        trigger: RemoteNotificationResumeTrigger
    ) async -> RemoteNotificationResumeResult {
        guard let route = RemoteNotificationRoute(userInfo: userInfo) else {
            lastPushMessage = "Push received without route identifiers"
            return .ignored
        }

        pendingNotificationRoute = route
        lastNotificationRoute = route
        applyPendingNotificationRouteIfPossible()

        guard let client = await ensureBridgeClientForRemoteNotification() else {
            lastPushMessage = "Push received, but no saved pair is available"
            return .noPair
        }

        let requested = await client.requestProjectionSnapshot(route: route)
        if requested {
            lastPushMessage = "Push \(trigger.rawValue) handled; refreshing task state"
            return .snapshotRequested
        } else {
            lastPushMessage = "Push \(trigger.rawValue) handled; bridge snapshot request is pending connection"
            return .snapshotUnavailable
        }
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

    private func ensureBridgeClientForRemoteNotification() async -> GuiGeminiBridgeClient? {
        if let client = bridgeClient {
            await client.start()
            return client
        }
        guard let pair = await loadMostRecentPairForRemoteResume() else {
            return nil
        }
        await connect(with: pair)
        return bridgeClient
    }

    private func loadMostRecentPairForRemoteResume() async -> GuiGeminiBridgeClient.Pair? {
        do {
            let records = try await pairStorage.loadAllPairs()
                .sorted { lhs, rhs in lhs.createdAt > rhs.createdAt }
            for record in records {
                guard let loaded = try await pairStorage.loadPair(pairID: record.pairID) else { continue }
                return GuiGeminiBridgeClient.Pair(
                    pairID: loaded.record.pairID,
                    controllerDeviceID: loaded.record.controllerDeviceID,
                    macDeviceID: loaded.record.macDeviceID,
                    derivedKeys: loaded.derivedKeys,
                    macDisplayName: loaded.record.macDisplayName,
                    tailscaleEndpointHint: loaded.record.tailscaleEndpointHint
                )
            }
        } catch {
            logIOSBridgeApp("remote notification pair restore failed: \(error.localizedDescription)")
            lastPushMessage = "Push resume failed: \(error.localizedDescription)"
        }
        return nil
    }

    @discardableResult
    private func applyPendingNotificationRouteIfPossible() -> Bool {
        guard let route = pendingNotificationRoute,
              let viewModel = remoteTaskConsoleViewModel
        else { return false }
        guard let taskID = taskID(matching: route, in: viewModel.store) else { return false }
        viewModel.selectTask(taskID)
        pendingNotificationRoute = nil
        return true
    }

    private func taskID(matching route: RemoteNotificationRoute, in store: RemoteTaskStore) -> String? {
        if let taskId = route.taskId, store.tasksById[taskId] != nil {
            return taskId
        }
        if let approvalId = route.approvalId {
            for (taskId, approvals) in store.approvalsByTaskId where approvals.contains(where: { $0.id == approvalId }) {
                return taskId
            }
        }
        if let questionId = route.questionId {
            for (taskId, questions) in store.questionsByTaskId where questions.contains(where: { $0.id == questionId }) {
                return taskId
            }
        }
        if let threadId = route.threadId,
           let detail = store.detail(threadID: threadId) {
            return detail.id
        }
        if let runId = route.runId,
           let match = store.tasksById.values.first(where: { $0.runId == runId }) {
            return match.id
        }
        return nil
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
