import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
public struct iPadDetailHost: View {
    public let selection: iPadSidebarSelection?
    public let store: iPadSidebarStore
    public let pairingViewModel: PairingViewModel?
    public let transcriptViewModel: TranscriptViewModel?
    public let composerViewModel: ComposerViewModel?
    public let remoteTaskStore: RemoteTaskStore?
    /// When true the workspace + thread + empty panes backfill missing
    /// data with deterministic mocks (see `iPadDetailSampleData`). The
    /// production app passes `false` so the real (potentially empty)
    /// state is shown until the bridge starts broadcasting summaries.
    public let mocked: Bool
    /// Surfaced by the iPad shell as the paired Mac's friendly name so
    /// the workspace summary card can render a connection chip. nil =
    /// no paired desktop known yet.
    public let pairedMacName: String?
    public let pushStatusMessage: String?
    public let yoloModeEnabled: Bool
    public let onSetYoloMode: ((Bool) -> Void)?
    public let onUnpair: (() -> Void)?
    /// Callback invoked when a thread row inside the workspace pane is
    /// tapped. The shell wires this into the sidebar selection state so
    /// the user lands directly on the chosen thread.
    public let onSelectThread: (String) -> Void
    @Environment(\.companionThemePalette) private var palette

    public init(
        selection: iPadSidebarSelection?,
        store: iPadSidebarStore,
        pairingViewModel: PairingViewModel? = nil,
        transcriptViewModel: TranscriptViewModel? = nil,
        composerViewModel: ComposerViewModel? = nil,
        remoteTaskStore: RemoteTaskStore? = nil,
        mocked: Bool = false,
        pairedMacName: String? = nil,
        pushStatusMessage: String? = nil,
        yoloModeEnabled: Bool = false,
        onSetYoloMode: ((Bool) -> Void)? = nil,
        onUnpair: (() -> Void)? = nil,
        onSelectThread: @escaping (String) -> Void = { _ in }
    ) {
        self.selection = selection
        self.store = store
        self.pairingViewModel = pairingViewModel
        self.transcriptViewModel = transcriptViewModel
        self.composerViewModel = composerViewModel
        self.remoteTaskStore = remoteTaskStore
        self.mocked = mocked
        self.pairedMacName = pairedMacName
        self.pushStatusMessage = pushStatusMessage
        self.yoloModeEnabled = yoloModeEnabled
        self.onSetYoloMode = onSetYoloMode
        self.onUnpair = onUnpair
        self.onSelectThread = onSelectThread
    }

    public var body: some View {
        ZStack {
            palette.windowBase.ignoresSafeArea()
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch selection {
        case .thread(let threadID):
            threadPane(threadID: threadID)
        case .workspace(let workspaceID):
            workspacePane(workspaceID: workspaceID)
        case .settings:
            settingsPane
        case .none:
            emptyPane
        }
    }

    private func threadPane(threadID: String) -> some View {
        iPadThreadPane(
            threadID: threadID,
            thread: store.thread(id: threadID),
            events: transcriptViewModel?.events ?? [],
            taskDetail: remoteTaskStore?.detail(threadID: threadID),
            mocked: mocked
        )
    }

    private func workspacePane(workspaceID: String) -> some View {
        iPadWorkspacePane(
            workspaceID: workspaceID,
            workspace: store.workspace(id: workspaceID),
            recentThreads: store.threads(in: workspaceID),
            runningCount: store.threads(in: workspaceID).filter(\.isActive).count,
            pairedMacName: pairedMacName,
            mocked: mocked,
            onSelectThread: onSelectThread
        )
    }

    private var settingsPane: some View {
        // Swap from the original "Settings placeholder" stub to the
        // dedicated `iPadSettingsPane` shipped by Agent C (Pairing /
        // Bridge connection / Push notifications / About cards). Mocks
        // gate behind the host's `mocked` flag so production callers
        // get real (empty) state.
        iPadSettingsPane(
            pairingViewModel: pairingViewModel,
            transcriptViewModel: transcriptViewModel,
            pushStatusMessage: pushStatusMessage,
            yoloModeEnabled: yoloModeEnabled,
            mocked: mocked,
            onSetYoloMode: onSetYoloMode,
            onUnpair: onUnpair
        )
    }

    private var emptyPane: some View {
        iPadEmptyPane()
    }

    private func contextBar(
        title: String,
        subtitle: String,
        systemImage: String
    ) -> some View {
        HStack(alignment: .center, spacing: Theme.Spacing.control) {
            Label(title, systemImage: systemImage)
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.primaryText)
                .lineLimit(1)
            Spacer(minLength: Theme.Spacing.control)
            Text(subtitle)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(.horizontal, Theme.Spacing.section)
        .padding(.vertical, Theme.Spacing.control)
        .cardGlassBackground(cornerRadius: Theme.Radius.control)
    }
}

// MARK: - Previews

@available(iOS 17.0, macOS 14.0, *)
#Preview("iPad detail host — workspace selection (mocked)") {
    let mock = iPadDetailSampleData.workspace(id: "workspace-sample")
    let store = iPadSidebarStore(
        workspaces: [mock.summary],
        threads: mock.recentThreads
    )
    return iPadDetailHost(
        selection: .workspace(mock.summary.id),
        store: store,
        mocked: true,
        pairedMacName: mock.pairedMacName
    )
    .frame(minWidth: 560, minHeight: 760)
}

@available(iOS 17.0, macOS 14.0, *)
#Preview("iPad detail host — thread selection (mocked)") {
    let mock = iPadDetailSampleData.workspace(id: "workspace-sample")
    let store = iPadSidebarStore(
        workspaces: [mock.summary],
        threads: mock.recentThreads
    )
    return iPadDetailHost(
        selection: .thread(mock.recentThreads.first?.id ?? "thread-mock-1"),
        store: store,
        mocked: true
    )
    .frame(minWidth: 560, minHeight: 760)
}

@available(iOS 17.0, macOS 14.0, *)
#Preview("iPad detail host — empty selection") {
    iPadDetailHost(
        selection: nil,
        store: iPadSidebarStore()
    )
    .frame(minWidth: 720, minHeight: 560)
}
