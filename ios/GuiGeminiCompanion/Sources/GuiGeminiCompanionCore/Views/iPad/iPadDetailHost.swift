import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
public struct iPadDetailHost: View {
    public let selection: iPadSidebarSelection?
    public let store: iPadSidebarStore
    public let transcriptViewModel: TranscriptViewModel?
    public let composerViewModel: ComposerViewModel?

    public init(
        selection: iPadSidebarSelection?,
        store: iPadSidebarStore,
        transcriptViewModel: TranscriptViewModel? = nil,
        composerViewModel: ComposerViewModel? = nil
    ) {
        self.selection = selection
        self.store = store
        self.transcriptViewModel = transcriptViewModel
        self.composerViewModel = composerViewModel
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
        VStack(alignment: .leading, spacing: Theme.Spacing.section) {
            contextBar(
                title: store.thread(id: threadID)?.title ?? "Thread",
                subtitle: store.thread(id: threadID)?.subtitle ?? "Live desktop run",
                systemImage: "text.bubble"
            )
            if let transcriptViewModel {
                TranscriptView(viewModel: transcriptViewModel)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
                    .cardGlassBackground(cornerRadius: Theme.Radius.panel)
            } else {
                unavailablePane(
                    title: "Transcript unavailable",
                    message: "A TranscriptViewModel has not been provided.",
                    systemImage: "waveform.path.ecg.rectangle"
                )
            }
        }
        .padding(Theme.Spacing.screen)
    }

    private func workspacePane(workspaceID: String) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.section) {
                let workspace = store.workspace(id: workspaceID)
                contextBar(
                    title: workspace?.displayName ?? "Workspace",
                    subtitle: workspace?.subtitle ?? workspaceID,
                    systemImage: "folder"
                )
                workspaceSummaryCard(workspace: workspace, workspaceID: workspaceID)
                if let composerViewModel {
                    ComposerView(viewModel: composerViewModel)
                        .frame(minHeight: 420)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
                        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
                } else {
                    unavailablePane(
                        title: "Composer unavailable",
                        message: "A ComposerViewModel has not been provided.",
                        systemImage: "square.and.pencil"
                    )
                }
            }
            .padding(Theme.Spacing.screen)
        }
        .scrollIndicators(.hidden)
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
        VStack(spacing: Theme.Spacing.control) {
            Image(systemName: "rectangle.3.group")
                .font(Theme.Typography.iconHero)
                .foregroundStyle(Theme.accent)
                .frame(width: 84, height: 84)
                .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            Text("Select a workspace or thread")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.primaryText)
            Text("The iPad layout keeps desktop output, approvals, and diffs visible together once a run is selected.")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Spacing.screen)
        .frame(maxWidth: 460)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
        .padding(Theme.Spacing.screen)
        .accessibilityElement(children: .combine)
    }

    private func workspaceSummaryCard(
        workspace: iPadWorkspaceSummary?,
        workspaceID: String
    ) -> some View {
        let activeThreads = store.threads(in: workspaceID).filter(\.isActive).count
        let recentThreads = store.threads(in: workspaceID).count
        return VStack(alignment: .leading, spacing: Theme.Spacing.section) {
            HStack(alignment: .top, spacing: Theme.Spacing.control) {
                Image(systemName: workspace?.isActive == true ? "folder.fill" : "folder")
                    .font(Theme.Typography.iconMedium)
                    .foregroundStyle(Theme.accent)
                    .frame(width: 48, height: 48)
                    .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                VStack(alignment: .leading, spacing: 5) {
                    Text(workspace?.displayName ?? workspaceID)
                        .font(Theme.Typography.headline)
                        .foregroundStyle(Theme.primaryText)
                    Text(workspace?.subtitle ?? workspaceID)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(2)
                        .truncationMode(.middle)
                }
                Spacer(minLength: Theme.Spacing.control)
            }
            HStack(spacing: Theme.Spacing.tight) {
                metricPill(value: "\(activeThreads)", label: "active", tint: Theme.success)
                metricPill(value: "\(recentThreads)", label: "threads", tint: Theme.accent)
                if let dirtyFileCount = workspace?.dirtyFileCount, dirtyFileCount > 0 {
                    metricPill(value: "\(dirtyFileCount)", label: "changed", tint: Theme.warning)
                }
            }
        }
        .padding(Theme.Spacing.screen)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
        .accessibilityElement(children: .combine)
    }

    private func metricPill(value: String, label: String, tint: Color) -> some View {
        HStack(spacing: 4) {
            Text(value)
                .font(Theme.Typography.caption)
                .foregroundStyle(tint)
            Text(label)
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.secondaryText)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(tint.opacity(0.12), in: Capsule(style: .continuous))
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

    private func unavailablePane(
        title: String,
        message: String,
        systemImage: String
    ) -> some View {
        VStack(spacing: Theme.Spacing.control) {
            Image(systemName: systemImage)
                .font(Theme.Typography.iconHero)
                .foregroundStyle(Theme.accent)
                .frame(width: 84, height: 84)
                .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            Text(title)
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.primaryText)
            Text(message)
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Spacing.screen)
        .frame(maxWidth: 420, maxHeight: .infinity)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
        .accessibilityElement(children: .combine)
    }
}
