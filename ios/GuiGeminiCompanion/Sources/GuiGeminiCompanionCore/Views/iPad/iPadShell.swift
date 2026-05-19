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
    public let seededWorkspaces: [iPadWorkspaceSummary]
    public let seededThreads: [iPadThreadSummary]
    public let pushStatusMessage: String?
    public let yoloModeEnabled: Bool
    public let onSetYoloMode: ((Bool) -> Void)?
    public let onUnpair: (() -> Void)?

    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var selectionState: iPadSelectionState
    @State private var sidebarStore: iPadSidebarStore

    public init(
        pairingViewModel: PairingViewModel? = nil,
        transcriptViewModel: TranscriptViewModel? = nil,
        approvalViewModel: ApprovalViewModel? = nil,
        composerViewModel: ComposerViewModel? = nil,
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
                approvalViewModel: approvalViewModel
            )
            .navigationSplitViewColumnWidth(min: 300, ideal: 340, max: 420)
        }
        .navigationSplitViewStyle(.balanced)
        .tint(Theme.accent)
        .onAppear(perform: synchronizeSidebarStore)
        .onChange(of: viewModelIdentityKey) { _, _ in
            synchronizeSidebarStore()
        }
        .onChange(of: transcriptViewModel?.events.count ?? 0) { _, _ in
            synchronizeSidebarStore()
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
            composerViewModel.map { "\(ObjectIdentifier($0).hashValue)" } ?? "nil"
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
}

@available(iOS 17.0, macOS 14.0, *)
private struct iPadInspectorHost: View {
    public let selection: iPadSidebarSelection?
    public let store: iPadSidebarStore
    public let transcriptViewModel: TranscriptViewModel?
    public let approvalViewModel: ApprovalViewModel?

    private var selectedThreadID: String? {
        if case .thread(let id) = selection {
            return id
        }
        return nil
    }

    private var latestDiffEvent: BridgeRunEvent? {
        iPadDiffInspector.latestDiffEvent(
            in: transcriptViewModel?.events ?? [],
            threadID: selectedThreadID
        )
    }

    public var body: some View {
        ZStack {
            Theme.windowBase.ignoresSafeArea()
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
                    iPadDiffInspector(event: latestDiffEvent)
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
            return "Approvals and read-only diffs for the selected run."
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
