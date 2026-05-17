import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
public struct iPadDetailHost: View {
    public let selection: iPadSidebarSelection?
    public let store: iPadSidebarStore
    public let transcriptViewModel: TranscriptViewModel?
    public let composerViewModel: ComposerViewModel?
    /// When true the workspace + thread + empty panes backfill missing
    /// data with deterministic mocks (see `iPadDetailSampleData`). The
    /// production app passes `false` so the real (potentially empty)
    /// state is shown until the bridge starts broadcasting summaries.
    public let mocked: Bool
    /// Surfaced by the iPad shell as the paired Mac's friendly name so
    /// the workspace summary card can render a connection chip. nil =
    /// no paired desktop known yet.
    public let pairedMacName: String?
    /// Callback invoked when a thread row inside the workspace pane is
    /// tapped. The shell wires this into the sidebar selection state so
    /// the user lands directly on the chosen thread.
    public let onSelectThread: (String) -> Void

    public init(
        selection: iPadSidebarSelection?,
        store: iPadSidebarStore,
        transcriptViewModel: TranscriptViewModel? = nil,
        composerViewModel: ComposerViewModel? = nil,
        mocked: Bool = false,
        pairedMacName: String? = nil,
        onSelectThread: @escaping (String) -> Void = { _ in }
    ) {
        self.selection = selection
        self.store = store
        self.transcriptViewModel = transcriptViewModel
        self.composerViewModel = composerViewModel
        self.mocked = mocked
        self.pairedMacName = pairedMacName
        self.onSelectThread = onSelectThread
    }

    public var body: some View {
        ZStack {
            Theme.windowBase.ignoresSafeArea()
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
        VStack(alignment: .leading, spacing: Theme.Spacing.section) {
            contextBar(
                title: "Connection",
                subtitle: "Pairing and bridge controls remain in the iPhone flow for this slice.",
                systemImage: "gearshape"
            )
            VStack(alignment: .leading, spacing: Theme.Spacing.control) {
                Label("Settings placeholder", systemImage: "gearshape.2")
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.primaryText)
                Text("The iPad shell reserves this pane for network status, pairing details, and desktop bridge diagnostics.")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(Theme.Spacing.screen)
            .frame(maxWidth: .infinity, alignment: .leading)
            .cardGlassBackground(cornerRadius: Theme.Radius.panel)
            Spacer(minLength: 0)
        }
        .padding(Theme.Spacing.screen)
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
