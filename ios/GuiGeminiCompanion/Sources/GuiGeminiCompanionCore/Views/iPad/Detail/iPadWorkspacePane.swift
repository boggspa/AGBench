import SwiftUI

/// Workspace pane shown by `iPadDetailHost` when a workspace is selected
/// (and no thread). The pane is composed of:
///   1. A workspace summary card (name, path, badge counts, paired-Mac).
///   2. A "Recent threads" list — top five from the store.
///   3. A "Last commit / Last diff" mini-card (mocked until bridge wiring).
///   4. A "Open in desktop AGBench" hint footer.
///
/// When `mocked == true` the pane backfills missing data with the
/// deterministic samples from `iPadDetailSampleData`. In production
/// builds the host passes `mocked: false` so the pane gracefully shows
/// the real (potentially empty) state.
@available(iOS 17.0, macOS 14.0, *)
public struct iPadWorkspacePane: View {
    public let workspaceID: String
    public let workspace: iPadWorkspaceSummary?
    public let recentThreads: [iPadThreadSummary]
    public let runningCount: Int
    public let pairedMacName: String?
    public let mocked: Bool
    public let onSelectThread: (String) -> Void

    public init(
        workspaceID: String,
        workspace: iPadWorkspaceSummary?,
        recentThreads: [iPadThreadSummary],
        runningCount: Int,
        pairedMacName: String?,
        mocked: Bool,
        onSelectThread: @escaping (String) -> Void
    ) {
        self.workspaceID = workspaceID
        self.workspace = workspace
        self.recentThreads = recentThreads
        self.runningCount = runningCount
        self.pairedMacName = pairedMacName
        self.mocked = mocked
        self.onSelectThread = onSelectThread
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.section) {
                summaryCard
                recentThreadsCard
                lastActivityCard
                desktopHintFooter
            }
            .padding(Theme.Spacing.screen)
        }
        .scrollIndicators(.hidden)
    }

    // MARK: - Resolved values

    private var resolvedDisplayName: String {
        workspace?.displayName ?? mockedWorkspace?.summary.displayName ?? workspaceID
    }

    private var resolvedPath: String? {
        workspace?.pathDisplayHint ?? mockedWorkspace?.summary.pathDisplayHint
    }

    private var resolvedBranch: String? {
        workspace?.branchName ?? mockedWorkspace?.summary.branchName
    }

    private var resolvedPermissionMode: String? {
        workspace?.permissionMode ?? mockedWorkspace?.summary.permissionMode
    }

    private var resolvedChatCount: Int {
        if !recentThreads.isEmpty {
            return recentThreads.count
        }
        return mockedWorkspace?.chatCount ?? 0
    }

    private var resolvedRunningCount: Int {
        let live = max(runningCount, recentThreads.filter(\.isActive).count)
        if live > 0 { return live }
        return mockedWorkspace?.runningCount ?? 0
    }

    private var resolvedDirtyCount: Int {
        workspace?.dirtyFileCount ?? mockedWorkspace?.summary.dirtyFileCount ?? 0
    }

    private var resolvedPairedName: String? {
        let actual = pairedMacName?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let actual, !actual.isEmpty { return actual }
        return mockedWorkspace?.pairedMacName
    }

    private var resolvedRecentThreads: [iPadThreadSummary] {
        if !recentThreads.isEmpty {
            return Array(recentThreads.prefix(5))
        }
        if mocked, let mockedWorkspace {
            return Array(mockedWorkspace.recentThreads.prefix(5))
        }
        return []
    }

    private var mockedWorkspace: iPadDetailSampleData.WorkspaceMock? {
        // MOCK: When the bridge hasn't yet broadcast a summary for this
        // workspace, fall back to deterministic placeholders so the pane
        // still teaches the user what will appear here.
        // TODO: drop when desktop fans real workspace summaries down.
        mocked ? iPadDetailSampleData.workspace(id: workspaceID) : nil
    }

    // MARK: - Summary card

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.section) {
            HStack(alignment: .top, spacing: Theme.Spacing.control) {
                Image(systemName: workspace?.isActive == true ? "folder.fill" : "folder")
                    .font(Theme.Typography.iconMedium)
                    .foregroundStyle(Theme.accent)
                    .frame(width: 52, height: 52)
                    .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                VStack(alignment: .leading, spacing: 6) {
                    Text(resolvedDisplayName)
                        .font(Theme.Typography.headline)
                        .foregroundStyle(Theme.primaryText)
                        .lineLimit(1)
                    if let path = resolvedPath, !path.isEmpty {
                        Label {
                            Text(path)
                                .font(Theme.Typography.caption)
                                .foregroundStyle(Theme.secondaryText)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        } icon: {
                            Image(systemName: "folder.badge.questionmark")
                                .font(Theme.Typography.smallCaption)
                                .foregroundStyle(Theme.tertiaryText)
                        }
                        .labelStyle(.titleAndIcon)
                    }
                    HStack(spacing: 6) {
                        if let branch = resolvedBranch, !branch.isEmpty {
                            metaTag(systemImage: "arrow.triangle.branch", text: branch)
                        }
                        if let mode = resolvedPermissionMode, !mode.isEmpty {
                            metaTag(systemImage: "checkmark.shield", text: mode)
                        }
                    }
                }
                Spacer(minLength: Theme.Spacing.control)
                connectionBadge
            }
            HStack(spacing: Theme.Spacing.tight) {
                metricPill(value: "\(resolvedChatCount)", label: "chats", tint: Theme.accent, systemImage: "text.bubble")
                metricPill(value: "\(resolvedRunningCount)", label: "running", tint: resolvedRunningCount > 0 ? Theme.success : Theme.tertiaryText, systemImage: "bolt.fill")
                if resolvedDirtyCount > 0 {
                    metricPill(value: "\(resolvedDirtyCount)", label: "changed", tint: Theme.warning, systemImage: "doc.badge.gearshape")
                }
            }
        }
        .padding(Theme.Spacing.screen)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
        .accessibilityElement(children: .combine)
    }

    private var connectionBadge: some View {
        let pairedName = resolvedPairedName
        let isPaired = pairedName != nil
        let tint: Color = isPaired ? Theme.success : Theme.warning
        let label = isPaired ? (pairedName ?? "Paired") : "Not paired"
        return HStack(spacing: 6) {
            Circle()
                .fill(tint)
                .frame(width: 7, height: 7)
            Text(label)
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(tint.opacity(0.10), in: Capsule(style: .continuous))
        .accessibilityLabel(isPaired ? "Paired with \(label)" : "No paired Mac")
    }

    private func metricPill(
        value: String,
        label: String,
        tint: Color,
        systemImage: String
    ) -> some View {
        HStack(spacing: 5) {
            Image(systemName: systemImage)
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(tint)
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

    private func metaTag(systemImage: String, text: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: systemImage)
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.tertiaryText)
            Text(text)
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(1)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Theme.inputSurface, in: Capsule(style: .continuous))
    }

    // MARK: - Recent threads

    private var recentThreadsCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            sectionHeader(title: "Recent threads", systemImage: "list.bullet.rectangle")
            if resolvedRecentThreads.isEmpty {
                Text("No threads have run in this workspace yet. The Mac will fan recent activity down here once a run starts.")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.vertical, Theme.Spacing.tight)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(resolvedRecentThreads.enumerated()), id: \.element.id) { index, thread in
                        threadRow(thread)
                        if index < resolvedRecentThreads.count - 1 {
                            Divider()
                                .overlay(Theme.separator)
                        }
                    }
                }
            }
        }
        .padding(Theme.Spacing.screen)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
    }

    private func threadRow(_ thread: iPadThreadSummary) -> some View {
        Button {
            onSelectThread(thread.id)
        } label: {
            HStack(alignment: .top, spacing: Theme.Spacing.control) {
                Circle()
                    .fill(thread.isActive ? Theme.success : Theme.tertiaryText)
                    .frame(width: 8, height: 8)
                    .padding(.top, 6)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(thread.title)
                            .font(Theme.Typography.sectionTitle)
                            .foregroundStyle(Theme.primaryText)
                            .lineLimit(1)
                        Spacer(minLength: Theme.Spacing.tight)
                        Text(thread.lastActivityAt, style: .relative)
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.tertiaryText)
                            .lineLimit(1)
                    }
                    if !thread.subtitle.isEmpty {
                        Text(thread.subtitle)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(2)
                    }
                    HStack(spacing: 6) {
                        iPadDetailProviderChip(provider: thread.provider)
                        if thread.isActive {
                            statusChip(text: "running", tint: Theme.success)
                        }
                    }
                }
                Image(systemName: "chevron.right")
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.tertiaryText)
                    .padding(.top, 6)
            }
            .padding(.vertical, Theme.Spacing.tight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(thread.title)
        .accessibilityValue(thread.accessibilitySummary)
        .accessibilityHint("Open this thread")
    }

    private func statusChip(text: String, tint: Color) -> some View {
        Text(text)
            .font(Theme.Typography.smallCaption)
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tint.opacity(0.14), in: Capsule(style: .continuous))
    }

    // MARK: - Last activity card

    private var lastActivityCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            sectionHeader(title: "Recent activity", systemImage: "clock.arrow.circlepath")
            HStack(alignment: .top, spacing: Theme.Spacing.control) {
                lastCommitTile
                lastDiffTile
            }
            // Truthful empty-state hint — replaces the prior
            // "sample preview" copy that implied real data was on the
            // way. The desktop doesn't yet broadcast commit / diff
            // summaries, so this hint stays visible regardless of the
            // `mocked` flag.
            Text("The desktop doesn't broadcast commit or diff summaries yet — these tiles will fill in once the bridge starts streaming them.")
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.tertiaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Spacing.screen)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
    }

    /// Truthful empty state. The desktop bridge does not currently fan
    /// commit summaries down to the iPad, so we render a placeholder
    /// rather than the prior `iPadDetailSampleData.lastCommit` mock —
    /// otherwise the user sees fake activity that never refreshes.
    /// When the desktop starts emitting a commit channel the body of
    /// this property will swap to a real `activityTile(...)` call and
    /// the layout slot stays intact.
    /// TODO: wire to a commit broadcast channel when the desktop ships
    /// `BridgeRunEvent.channel.commitSummary` (or equivalent).
    private var lastCommitTile: some View {
        activityTile(
            systemImage: "checkmark.seal",
            title: "Last commit",
            primary: "No recent commit broadcast yet",
            meta: ["Will appear when the Mac fans commit summaries down"],
            muted: true
        )
    }

    /// Truthful empty state. Same reasoning as `lastCommitTile`: the
    /// bridge has no diff-summary channel today.
    /// TODO: wire to the most-recent approved diff event once the
    /// bridge exposes it as a typed channel.
    private var lastDiffTile: some View {
        activityTile(
            systemImage: "doc.text.magnifyingglass",
            title: "Last diff",
            primary: "No diff broadcast yet",
            meta: ["Will appear when the Mac fans diff summaries down"],
            muted: true
        )
    }

    private func activityTile(
        systemImage: String,
        title: String,
        primary: String,
        meta: [String],
        tint: Color = Theme.success,
        muted: Bool = false
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(muted ? Theme.tertiaryText : tint)
                Text(title.uppercased())
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.tertiaryText)
            }
            Text(primary)
                .font(Theme.Typography.caption)
                .foregroundStyle(muted ? Theme.secondaryText : Theme.primaryText)
                .lineLimit(2)
                .truncationMode(.middle)
            if !meta.isEmpty {
                HStack(spacing: 6) {
                    ForEach(Array(meta.enumerated()), id: \.offset) { index, value in
                        Text(value)
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.tertiaryText)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        if index < meta.count - 1 {
                            Circle()
                                .fill(Theme.tertiaryText.opacity(0.4))
                                .frame(width: 3, height: 3)
                        }
                    }
                }
            }
        }
        .padding(Theme.Spacing.control)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.inputSurface.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(Theme.cardStroke.opacity(0.4), lineWidth: 1)
        )
    }

    // MARK: - Footer hint

    private var desktopHintFooter: some View {
        // The "Open in desktop AGBench" affordance is intentionally a
        // text-only label until a real deep link exists.
        // TODO: wire to a desktop deep-link / clipboard payload once the
        // bridge ships an open-in-desktop action.
        HStack(spacing: Theme.Spacing.tight) {
            Image(systemName: "rectangle.connected.to.line.below")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.tertiaryText)
            VStack(alignment: .leading, spacing: 2) {
                Text("Open in desktop AGBench")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.secondaryText)
                Text("Hand-off coming soon — for now switch to the Mac to dispatch new runs.")
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.tertiaryText)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Theme.Spacing.section)
        .padding(.vertical, Theme.Spacing.control)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.inputSurface.opacity(0.5), in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
    }

    // MARK: - Shared

    private func sectionHeader(title: String, systemImage: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.accent)
            Text(title.uppercased())
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.tertiaryText)
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Previews

@available(iOS 17.0, macOS 14.0, *)
#Preview("iPad workspace pane — mocked") {
    let mock = iPadDetailSampleData.workspace(id: "workspace-sample")
    return iPadWorkspacePane(
        workspaceID: mock.summary.id,
        workspace: mock.summary,
        recentThreads: mock.recentThreads,
        runningCount: mock.runningCount,
        pairedMacName: mock.pairedMacName,
        mocked: true,
        onSelectThread: { _ in }
    )
    .frame(minWidth: 540, minHeight: 720)
    .background(Theme.windowBase)
}

@available(iOS 17.0, macOS 14.0, *)
#Preview("iPad workspace pane — empty") {
    iPadWorkspacePane(
        workspaceID: "workspace-empty",
        workspace: nil,
        recentThreads: [],
        runningCount: 0,
        pairedMacName: nil,
        mocked: false,
        onSelectThread: { _ in }
    )
    .frame(minWidth: 540, minHeight: 720)
    .background(Theme.windowBase)
}
