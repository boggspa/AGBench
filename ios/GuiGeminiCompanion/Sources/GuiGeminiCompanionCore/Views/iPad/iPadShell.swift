import SwiftUI
import Observation

public struct iPadWorkspaceSummary: Identifiable, Hashable, Sendable {
    public let id: String
    public let displayName: String
    public let pathDisplayHint: String?
    public let branchName: String?
    public let permissionMode: String?
    public let dirtyFileCount: Int
    public let isActive: Bool

    public init(
        id: String,
        displayName: String,
        pathDisplayHint: String? = nil,
        branchName: String? = nil,
        permissionMode: String? = nil,
        dirtyFileCount: Int = 0,
        isActive: Bool = false
    ) {
        self.id = id
        self.displayName = displayName.isEmpty ? id : displayName
        self.pathDisplayHint = pathDisplayHint
        self.branchName = branchName
        self.permissionMode = permissionMode
        self.dirtyFileCount = max(0, dirtyFileCount)
        self.isActive = isActive
    }

    public var subtitle: String {
        if let pathDisplayHint, !pathDisplayHint.isEmpty {
            return pathDisplayHint
        }
        if let branchName, !branchName.isEmpty {
            return branchName
        }
        if let permissionMode, !permissionMode.isEmpty {
            return permissionMode
        }
        return id
    }

    public var accessibilitySummary: String {
        var parts = [displayName]
        if subtitle != displayName {
            parts.append(subtitle)
        }
        if dirtyFileCount > 0 {
            parts.append("\(dirtyFileCount) changed files")
        }
        if let permissionMode, !permissionMode.isEmpty {
            parts.append(permissionMode)
        }
        return parts.joined(separator: ", ")
    }
}

public struct iPadThreadSummary: Identifiable, Hashable, Sendable {
    public let id: String
    public let workspaceID: String?
    public let title: String
    public let subtitle: String
    public let provider: String?
    public let runID: String?
    public let lastActivityAt: Date
    public let isActive: Bool

    public init(
        id: String,
        workspaceID: String? = nil,
        title: String,
        subtitle: String = "",
        provider: String? = nil,
        runID: String? = nil,
        lastActivityAt: Date = Date(),
        isActive: Bool = false
    ) {
        self.id = id
        self.workspaceID = workspaceID
        self.title = title.isEmpty ? id : title
        self.subtitle = subtitle
        self.provider = provider
        self.runID = runID
        self.lastActivityAt = lastActivityAt
        self.isActive = isActive
    }

    public var accessibilitySummary: String {
        var parts = [title]
        if !subtitle.isEmpty {
            parts.append(subtitle)
        }
        if let provider, !provider.isEmpty {
            parts.append(provider)
        }
        if isActive {
            parts.append("active")
        }
        return parts.joined(separator: ", ")
    }
}

public enum iPadSidebarSelection: Hashable, Sendable {
    case workspace(String)
    case thread(String)
    case settings

    public var id: String {
        switch self {
        case .workspace(let id): return "workspace:\(id)"
        case .thread(let id): return "thread:\(id)"
        case .settings: return "settings"
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
public struct iPadEnsembleControlActions: Sendable {
    public let cancelRound: (@MainActor @Sendable (RemoteEnsembleProjection) async -> Void)?
    public let skipActiveParticipant: (@MainActor @Sendable (RemoteEnsembleProjection) async -> Void)?
    public let wakeNow: (@MainActor @Sendable (RemoteEnsembleProjection) async -> Void)?
    public let cancelWakeup: (@MainActor @Sendable (RemoteEnsembleProjection) async -> Void)?
    public let queuePrompt: (@MainActor @Sendable (RemoteEnsembleProjection, String) async -> Void)?
    public let steer: (@MainActor @Sendable (RemoteEnsembleProjection, String) async -> Void)?

    public init(
        cancelRound: (@MainActor @Sendable (RemoteEnsembleProjection) async -> Void)? = nil,
        skipActiveParticipant: (@MainActor @Sendable (RemoteEnsembleProjection) async -> Void)? = nil,
        wakeNow: (@MainActor @Sendable (RemoteEnsembleProjection) async -> Void)? = nil,
        cancelWakeup: (@MainActor @Sendable (RemoteEnsembleProjection) async -> Void)? = nil,
        queuePrompt: (@MainActor @Sendable (RemoteEnsembleProjection, String) async -> Void)? = nil,
        steer: (@MainActor @Sendable (RemoteEnsembleProjection, String) async -> Void)? = nil
    ) {
        self.cancelRound = cancelRound
        self.skipActiveParticipant = skipActiveParticipant
        self.wakeNow = wakeNow
        self.cancelWakeup = cancelWakeup
        self.queuePrompt = queuePrompt
        self.steer = steer
    }

    public static let disabled = iPadEnsembleControlActions()
}

@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class iPadSelectionState {
    public var selection: iPadSidebarSelection?

    public init(initialSelection: iPadSidebarSelection? = nil) {
        self.selection = initialSelection
    }

    public var selectedWorkspaceID: String? {
        if case .workspace(let id) = selection {
            return id
        }
        return nil
    }

    public var selectedThreadID: String? {
        if case .thread(let id) = selection {
            return id
        }
        return nil
    }

    public func selectWorkspace(_ id: String) {
        selection = .workspace(id)
    }

    public func selectThread(_ id: String) {
        selection = .thread(id)
    }

    public func selectSettings() {
        selection = .settings
    }
}

@available(iOS 17.0, macOS 14.0, *)
public struct iPadShell: View {
    public let pairingViewModel: PairingViewModel?
    public let transcriptViewModel: TranscriptViewModel?
    public let approvalViewModel: ApprovalViewModel?
    public let composerViewModel: ComposerViewModel?
    public let remoteTaskStore: RemoteTaskStore?
    public let ensembleControlActions: iPadEnsembleControlActions
    public let seededWorkspaces: [iPadWorkspaceSummary]
    public let seededThreads: [iPadThreadSummary]
    public let pushStatusMessage: String?
    public let yoloModeEnabled: Bool
    public let onSetYoloMode: ((Bool) -> Void)?
    public let onUnpair: (() -> Void)?

    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var selectionState: iPadSelectionState
    @State private var sidebarStore: iPadSidebarStore
    @State private var remoteTaskIngestedEventCount = 0
    @Environment(\.companionThemePalette) private var palette

    public init(
        pairingViewModel: PairingViewModel? = nil,
        transcriptViewModel: TranscriptViewModel? = nil,
        approvalViewModel: ApprovalViewModel? = nil,
        composerViewModel: ComposerViewModel? = nil,
        remoteTaskStore: RemoteTaskStore? = nil,
        ensembleControlActions: iPadEnsembleControlActions = .disabled,
        workspaces: [iPadWorkspaceSummary] = [],
        threads: [iPadThreadSummary] = [],
        pushStatusMessage: String? = nil,
        yoloModeEnabled: Bool = false,
        onSetYoloMode: ((Bool) -> Void)? = nil,
        selectionState: iPadSelectionState? = nil,
        sidebarStore: iPadSidebarStore? = nil,
        onUnpair: (() -> Void)? = nil
    ) {
        self.pairingViewModel = pairingViewModel
        self.transcriptViewModel = transcriptViewModel
        self.approvalViewModel = approvalViewModel
        self.composerViewModel = composerViewModel
        self.remoteTaskStore = remoteTaskStore
        self.ensembleControlActions = ensembleControlActions
        self.seededWorkspaces = workspaces
        self.seededThreads = threads
        self.pushStatusMessage = pushStatusMessage
        self.yoloModeEnabled = yoloModeEnabled
        self.onSetYoloMode = onSetYoloMode
        self.onUnpair = onUnpair
        _selectionState = State(initialValue: selectionState ?? iPadSelectionState())
        _sidebarStore = State(initialValue: sidebarStore ?? iPadSidebarStore(
            workspaces: workspaces,
            threads: threads
        ))
    }

    public var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            iPadSidebar(
                store: sidebarStore,
                selectionState: selectionState
            )
            .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 380)
        } content: {
            iPadDetailHost(
                selection: selectionState.selection,
                store: sidebarStore,
                pairingViewModel: pairingViewModel,
                transcriptViewModel: transcriptViewModel,
                composerViewModel: composerViewModel,
                remoteTaskStore: remoteTaskStore,
                pairedMacName: pairingViewModel?.confirmedPair?.macDisplayName,
                pushStatusMessage: pushStatusMessage,
                yoloModeEnabled: yoloModeEnabled,
                onSetYoloMode: onSetYoloMode,
                onUnpair: onUnpair
            )
            .navigationSplitViewColumnWidth(min: 500, ideal: 720)
        } detail: {
            iPadInspectorHost(
                selection: selectionState.selection,
                store: sidebarStore,
                transcriptViewModel: transcriptViewModel,
                approvalViewModel: approvalViewModel,
                remoteTaskStore: remoteTaskStore,
                ensembleControlActions: ensembleControlActions
            )
            .navigationSplitViewColumnWidth(min: 300, ideal: 340, max: 420)
        }
        .navigationSplitViewStyle(.balanced)
        .tint(palette.accent)
        .onAppear {
            synchronizeSidebarStore()
            synchronizeRemoteTaskStore()
        }
        .onChange(of: viewModelIdentityKey) { _, _ in
            synchronizeSidebarStore()
        }
        .onChange(of: transcriptViewModel?.events.count ?? 0) { _, _ in
            synchronizeSidebarStore()
            synchronizeRemoteTaskStore()
        }
        .onChange(of: approvalViewModel?.pending.count ?? 0) { _, _ in
            synchronizeSidebarStore()
        }
        .onChange(of: composerViewModel?.workspaceId ?? "") { _, _ in
            synchronizeSidebarStore()
        }
        .onChange(of: composerViewModel?.threadId ?? "") { _, _ in
            synchronizeSidebarStore()
        }
    }

    private var viewModelIdentityKey: String {
        [
            transcriptViewModel.map { "\(ObjectIdentifier($0).hashValue)" } ?? "nil",
            approvalViewModel.map { "\(ObjectIdentifier($0).hashValue)" } ?? "nil",
            composerViewModel.map { "\(ObjectIdentifier($0).hashValue)" } ?? "nil",
            remoteTaskStore.map { "\(ObjectIdentifier($0).hashValue)" } ?? "nil"
        ].joined(separator: "|")
    }

    private func synchronizeSidebarStore() {
        sidebarStore.refresh(
            seedWorkspaces: seededWorkspaces,
            seedThreads: seededThreads,
            transcriptViewModel: transcriptViewModel,
            approvalViewModel: approvalViewModel,
            composerViewModel: composerViewModel
        )
        if let selection = selectionState.selection {
            switch selection {
            case .thread(let id) where sidebarStore.thread(id: id) == nil:
                selectionState.selection = nil
            case .workspace(let id) where sidebarStore.workspace(id: id) == nil:
                selectionState.selection = nil
            default:
                break
            }
        }
        if selectionState.selection == nil {
            if let activeThread = sidebarStore.threads.first(where: \.isActive) ?? sidebarStore.threads.first {
                selectionState.selectThread(activeThread.id)
            } else if let activeWorkspace = sidebarStore.workspaces.first(where: \.isActive) ?? sidebarStore.workspaces.first {
                selectionState.selectWorkspace(activeWorkspace.id)
            }
        }
    }

    private func synchronizeRemoteTaskStore() {
        guard let remoteTaskStore else { return }
        let events = transcriptViewModel?.events ?? []
        if events.count < remoteTaskIngestedEventCount {
            remoteTaskIngestedEventCount = 0
        }
        guard events.count > remoteTaskIngestedEventCount else { return }
        remoteTaskStore.ingest(Array(events[remoteTaskIngestedEventCount...]))
        remoteTaskIngestedEventCount = events.count
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct iPadInspectorHost: View {
    public let selection: iPadSidebarSelection?
    public let store: iPadSidebarStore
    public let transcriptViewModel: TranscriptViewModel?
    public let approvalViewModel: ApprovalViewModel?
    public let remoteTaskStore: RemoteTaskStore?
    public let ensembleControlActions: iPadEnsembleControlActions
    @Environment(\.companionThemePalette) private var palette

    private var selectedThreadID: String? {
        if case .thread(let id) = selection {
            return id
        }
        return nil
    }

    private var selectedTaskDetail: RemoteTaskDetail? {
        remoteTaskStore?.detail(threadID: selectedThreadID)
    }

    private var latestDiffEvent: BridgeRunEvent? {
        iPadDiffInspector.latestDiffEvent(
            in: transcriptViewModel?.events ?? [],
            threadID: selectedThreadID
        )
    }

    public var body: some View {
        ZStack {
            palette.windowBase.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.section) {
                    inspectorHeader
                    if let approvalViewModel {
                        ApprovalCardsView(viewModel: approvalViewModel)
                            .frame(minHeight: 260)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
                    } else {
                        unavailableCard(
                            title: "Approvals unavailable",
                            message: "Approval controls appear here after the bridge client connects.",
                            systemImage: "checkmark.shield"
                        )
                    }
                    if let approvals = selectedTaskDetail?.approvals, !approvals.isEmpty {
                        iPadTypedApprovalPanel(approvals: approvals)
                    }
                    if let questions = selectedTaskDetail?.questions, !questions.isEmpty {
                        iPadQuestionCardsPanel(questions: questions)
                    }
                    if let ensembleState = selectedTaskDetail?.ensemble {
                        iPadEnsembleStatePanel(
                            state: ensembleState,
                            actions: ensembleControlActions
                        )
                    }
                    if let actionState = selectedTaskDetail?.actionState {
                        iPadActionFeedbackPanel(state: actionState)
                    }
                    iPadDiffInspector(
                        summary: selectedTaskDetail?.diffSummary,
                        fallbackEvent: latestDiffEvent
                    )
                }
                .padding(Theme.Spacing.screen)
            }
            .scrollIndicators(.hidden)
        }
    }

    private var inspectorHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Inspector", systemImage: "sidebar.right")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.primaryText)
            Text(headerSubtitle)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(2)
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardGlassBackground(cornerRadius: Theme.Radius.control)
    }

    private var headerSubtitle: String {
        guard let selectedThreadID,
              let thread = store.thread(id: selectedThreadID)
        else {
            return selectedTaskDetail?.task.status.rawValue ?? "Approvals and read-only diffs for the selected run."
        }
        let status = selectedTaskDetail?.task.status.rawValue
        if let status, !status.isEmpty {
            return status
        }
        return thread.subtitle.isEmpty ? thread.title : thread.subtitle
    }

    private func unavailableCard(
        title: String,
        message: String,
        systemImage: String
    ) -> some View {
        VStack(spacing: Theme.Spacing.control) {
            Image(systemName: systemImage)
                .font(Theme.Typography.iconMedium)
                .foregroundStyle(Theme.accent)
            Text(title)
                .font(Theme.Typography.sectionTitle)
                .foregroundStyle(Theme.primaryText)
            Text(message)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
        .accessibilityElement(children: .combine)
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct iPadTypedApprovalPanel: View {
    let approvals: [MobileApprovalCard]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            panelHeader(
                title: "Typed Approvals",
                count: approvals.count,
                systemImage: "shield.lefthalf.filled",
                tint: Theme.warning
            )
            ForEach(approvals) { approval in
                VStack(alignment: .leading, spacing: 6) {
                    Text(approval.title)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    if let body = approval.body ?? approval.summary, !body.isEmpty {
                        Text(body)
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    HStack(spacing: 6) {
                        stateChip(approval.workspaceId ?? "workspace", systemImage: "folder", tint: Theme.secondaryAccent)
                        stateChip(approval.threadId, systemImage: "bubble.left", tint: Theme.accent)
                    }
                }
                .padding(Theme.Spacing.control)
                .background(Theme.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
            }
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct iPadQuestionCardsPanel: View {
    let questions: [MobileQuestionCard]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            panelHeader(
                title: "Questions",
                count: questions.count,
                systemImage: "questionmark.bubble.fill",
                tint: Theme.secondaryAccent
            )
            ForEach(questions) { question in
                VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
                    Text(question.prompt)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    if let body = question.context, !body.isEmpty {
                        Text(body)
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if !question.options.isEmpty {
                        WrappingQuestionOptions(options: question.options.map(\.label))
                    }
                }
                .padding(Theme.Spacing.control)
                .background(Theme.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
            }
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct WrappingQuestionOptions: View {
    let options: [String]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) {
                optionChips
            }
            VStack(alignment: .leading, spacing: 6) {
                optionChips
            }
        }
    }

    @ViewBuilder
    private var optionChips: some View {
        ForEach(Array(options.prefix(4).enumerated()), id: \.offset) { _, option in
            Text(option)
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.secondaryAccent)
                .lineLimit(1)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Theme.secondaryAccent.opacity(0.13), in: Capsule(style: .continuous))
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct iPadEnsembleStatePanel: View {
    let state: RemoteEnsembleProjection
    let actions: iPadEnsembleControlActions

    @State private var queuedPromptText = ""
    @State private var steerText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            panelHeader(
                title: "Ensemble",
                count: state.participants.count,
                systemImage: "person.3.sequence.fill",
                tint: Theme.secondaryAccent
            )
            statusGrid
            participantList
            controlGrid
            queueAndSteerControls
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
    }

    private var statusGrid: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                stateChip(state.status ?? state.roundStatus ?? "idle", systemImage: "dot.radiowaves.left.and.right", tint: Theme.secondaryAccent)
                if let runId = state.runId {
                    stateChip(runId, systemImage: "number", tint: Theme.accent)
                }
            }
            if let active = activeParticipant {
                let role = active.role ?? active.id
                let provider = active.provider ?? "provider"
                Text("Active: \(role) · \(provider)")
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.secondaryText)
            }
            if let wakeupDescription {
                Text(wakeupDescription)
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(2)
            }
        }
    }

    private var participantList: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(state.participants) { participant in
                HStack(spacing: 6) {
                    Image(systemName: participant.id == state.activeParticipantId ? "circle.fill" : "circle")
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(participant.id == state.activeParticipantId ? Theme.success : Theme.tertiaryText)
                    Text(participant.role ?? participant.id)
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.primaryText)
                    Text(participant.provider ?? "provider")
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.secondaryText)
                    Spacer(minLength: 0)
                    Text(participant.status ?? (participant.isActive ? "active" : "idle"))
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
        }
        .padding(Theme.Spacing.tight)
        .background(Theme.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
    }

    private var controlGrid: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            HStack(spacing: Theme.Spacing.tight) {
                controlButton(
                    title: "Cancel round",
                    systemImage: "stop.circle",
                    isCapable: state.capabilities.cancelRound,
                    handlerAvailable: actions.cancelRound != nil
                ) {
                    guard let cancelRound = actions.cancelRound else { return }
                    await cancelRound(state)
                }
                controlButton(
                    title: "Skip active",
                    systemImage: "forward.end",
                    isCapable: state.capabilities.skipActiveParticipant,
                    handlerAvailable: actions.skipActiveParticipant != nil
                ) {
                    guard let skipActiveParticipant = actions.skipActiveParticipant else { return }
                    await skipActiveParticipant(state)
                }
            }
            HStack(spacing: Theme.Spacing.tight) {
                controlButton(
                    title: "Wake now",
                    systemImage: "alarm",
                    isCapable: state.capabilities.wakeNow,
                    handlerAvailable: actions.wakeNow != nil && activeWakeupId != nil
                ) {
                    guard let wakeNow = actions.wakeNow else { return }
                    await wakeNow(state)
                }
                controlButton(
                    title: "Cancel wakeup",
                    systemImage: "alarm.waves.left.and.right",
                    isCapable: state.capabilities.cancelWakeup,
                    handlerAvailable: actions.cancelWakeup != nil && activeWakeupId != nil
                ) {
                    guard let cancelWakeup = actions.cancelWakeup else { return }
                    await cancelWakeup(state)
                }
            }
        }
    }

    private var queueAndSteerControls: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            if state.capabilities.queuePrompt {
                HStack(spacing: 6) {
                    TextField("Queue prompt", text: $queuedPromptText, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(1...3)
                    Button {
                        Task {
                            guard let queuePrompt = actions.queuePrompt else { return }
                            let text = queuedPromptText.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !text.isEmpty, queueWithinLimit else { return }
                            await queuePrompt(state, text)
                            queuedPromptText = ""
                        }
                    } label: {
                        Label("Queue", systemImage: "tray.and.arrow.down")
                    }
                    .disabled(actions.queuePrompt == nil || !queueWithinLimit || queuedPromptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                queueStatusLine
            }
            if state.capabilities.steer {
                HStack(spacing: 6) {
                    TextField("Steer round", text: $steerText, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(1...3)
                    Button {
                        Task {
                            guard let steer = actions.steer else { return }
                            let text = steerText.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !text.isEmpty else { return }
                            await steer(state, text)
                            steerText = ""
                        }
                    } label: {
                        Label("Steer", systemImage: "slider.horizontal.3")
                    }
                    .disabled(actions.steer == nil || steerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    private var queueStatusLine: some View {
        let limitText = state.capabilities.queueLimit.map { " / \($0)" } ?? ""
        return Text("Queued \(state.queue.count)\(limitText)")
            .font(Theme.Typography.smallCaption)
            .foregroundStyle(queueWithinLimit ? Theme.secondaryText : Theme.warning)
    }

    private var queueWithinLimit: Bool {
        guard let limit = state.capabilities.queueLimit else { return true }
        return state.queue.count < limit
    }

    private var activeParticipant: RemoteEnsembleParticipant? {
        guard let activeParticipantId = state.activeParticipantId else { return nil }
        return state.participants.first { $0.id == activeParticipantId }
    }

    private var activeWakeupId: String? {
        if let wakeupId = state.wakeupId, !wakeupId.isEmpty {
            return wakeupId
        }
        if let wakeupId = activeParticipant?.wakeupId, !wakeupId.isEmpty {
            return wakeupId
        }
        return state.participants.first { participant in
            participant.wakeupId?.isEmpty == false
        }?.wakeupId
    }

    private var wakeupDescription: String? {
        let sleeping = state.participants.compactMap { participant -> String? in
            guard let sleepingUntil = participant.sleepingUntil else { return nil }
            let label = participant.role ?? participant.provider ?? participant.id
            return "\(label) wakes \(sleepingUntil.formatted(date: .omitted, time: .shortened))"
        }
        return sleeping.isEmpty ? nil : sleeping.joined(separator: " · ")
    }

    private func controlButton(
        title: String,
        systemImage: String,
        isCapable: Bool,
        handlerAvailable: Bool,
        action: @escaping @MainActor @Sendable () async -> Void
    ) -> some View {
        Button {
            Task { await action() }
        } label: {
            Label(title, systemImage: systemImage)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .disabled(!isCapable || !handlerAvailable)
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct iPadActionFeedbackPanel: View {
    let state: RemoteTaskActionState

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.tight) {
            Image(systemName: systemImage)
                .font(Theme.Typography.caption)
                .foregroundStyle(tint)
                .frame(width: 22, height: 22)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.primaryText)
                Text(message)
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
        .accessibilityElement(children: .combine)
    }

    private var title: String {
        switch state {
        case .sending(let kind, _, _):
            return "Sending \(label(for: kind))"
        case .acknowledged(let kind, _, _, _):
            return "\(label(for: kind)) sent"
        case .failed(let kind, _, _, _):
            return "\(label(for: kind)) failed"
        case .stale(let kind, _, _, _):
            return "\(label(for: kind)) stale"
        }
    }

    private var message: String {
        switch state {
        case .sending(_, let targetId, _):
            return "Waiting for desktop acknowledgement for \(targetId)."
        case .acknowledged(_, _, let message, _),
             .failed(_, _, let message, _),
             .stale(_, _, let message, _):
            return message
        }
    }

    private var systemImage: String {
        switch state {
        case .sending:
            return "arrow.up.circle"
        case .acknowledged:
            return "checkmark.circle"
        case .failed:
            return "exclamationmark.triangle"
        case .stale:
            return "clock.badge.exclamationmark"
        }
    }

    private var tint: Color {
        switch state {
        case .sending:
            return Theme.accent
        case .acknowledged:
            return Theme.success
        case .failed:
            return Theme.warning
        case .stale:
            return Theme.secondaryAccent
        }
    }

    private func label(for kind: RemoteTaskActionKind) -> String {
        switch kind {
        case .approve:
            return "Approval"
        case .decline:
            return "Decline"
        case .answerQuestion:
            return "Answer"
        case .rejectQuestion:
            return "Question reject"
        case .cancelRun:
            return "Cancel run"
        case .prompt:
            return "Prompt"
        case .ensembleCancelRound:
            return "Cancel round"
        case .ensembleSkipActiveParticipant:
            return "Skip active"
        case .ensembleWakeNow:
            return "Wake now"
        case .ensembleCancelWakeup:
            return "Cancel wakeup"
        case .ensembleQueuePrompt:
            return "Queue prompt"
        case .ensembleSteer:
            return "Steer"
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private func panelHeader(title: String, count: Int, systemImage: String, tint: Color) -> some View {
    HStack(spacing: Theme.Spacing.tight) {
        Label(title, systemImage: systemImage)
            .font(Theme.Typography.sectionTitle)
            .foregroundStyle(Theme.primaryText)
        Spacer(minLength: Theme.Spacing.tight)
        Text("\(count)")
            .font(Theme.Typography.smallCaption)
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(tint.opacity(0.13), in: Capsule(style: .continuous))
    }
}

@available(iOS 17.0, macOS 14.0, *)
private func stateChip(_ text: String, systemImage: String, tint: Color) -> some View {
    HStack(spacing: 4) {
        Image(systemName: systemImage)
            .font(Theme.Typography.smallCaption)
            .accessibilityHidden(true)
        Text(text)
            .font(Theme.Typography.smallCaption)
            .lineLimit(1)
            .truncationMode(.middle)
    }
    .foregroundStyle(tint)
    .padding(.horizontal, 7)
    .padding(.vertical, 3)
    .background(tint.opacity(0.13), in: Capsule(style: .continuous))
}

#if DEBUG
@available(iOS 17.0, macOS 14.0, *)
private enum iPadShellPreviewSamples {
    static func ensembleState() -> RemoteEnsembleProjection {
        let envelope = try! RemoteProjectionEnvelope.decode(payloadJSON: Data("""
        {
          "kind": "ensemble",
          "taskId": "task-preview",
          "workspaceId": "workspace-preview",
          "threadId": "thread-preview",
          "payload": {
            "threadId": "thread-preview",
            "runId": "run-preview",
            "status": "running",
            "roundStatus": "turn-bound",
            "activeParticipantId": "planner",
            "participants": [
              {
                "id": "planner",
                "provider": "gemini",
                "role": "Planner",
                "status": "running",
                "isActive": true
              },
              {
                "id": "reviewer",
                "provider": "codex",
                "role": "Reviewer",
                "status": "sleeping",
                "sleepingUntil": "2026-05-20T13:00:00.000Z"
              }
            ],
            "queue": [
              { "id": "queued-1", "label": "Sanity-check diff", "participantId": "reviewer" }
            ],
            "capabilities": {
              "cancelRound": true,
              "skipActiveParticipant": true,
              "wakeNow": true,
              "cancelWakeup": true,
              "queuePrompt": true,
              "steer": true,
              "queueLimit": 3
            }
          }
        }
        """.utf8))
        guard case .ensemble(let state) = envelope.payload else {
            fatalError("Expected ensemble preview payload")
        }
        return state
    }
}

@available(iOS 17.0, macOS 14.0, *)
#Preview("iPad inspector — ensemble controls disabled") {
    iPadEnsembleStatePanel(
        state: iPadShellPreviewSamples.ensembleState(),
        actions: .disabled
    )
    .frame(width: 360)
    .padding()
    .background(Theme.windowBase)
}
#endif
