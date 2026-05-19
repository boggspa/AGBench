import SwiftUI

/// iPad sidebar — pairs the pinned "Active runs" section with the
/// filterable workspace + thread lists. Mirrors the Mac desktop's K1
/// sidebar shape so users moving between platforms see the same surface.
///
/// Production rendering pulls from the bound `iPadSidebarStore`. A
/// `mocked` initializer hands the view deterministic sample data for
/// previews + UX iteration when the bridge protocol hasn't yet started
/// broadcasting workspace / thread events.
@available(iOS 17.0, macOS 14.0, *)
public struct iPadSidebar: View {
    @Bindable public var store: iPadSidebarStore
    @Bindable public var selectionState: iPadSelectionState

    /// MOCK: when non-empty, sub-views render this in place of the
    /// store's contents. Gated `#if DEBUG` at the `mocked(...)` initializer
    /// so a release binary never instantiates with mocked data.
    private let mockedWorkspaces: [iPadWorkspaceSummary]
    private let mockedThreads: [iPadThreadSummary]

    @State private var query: String = ""
    @FocusState private var searchFocused: Bool

    public init(
        store: iPadSidebarStore,
        selectionState: iPadSelectionState
    ) {
        self.init(
            store: store,
            selectionState: selectionState,
            mockedWorkspaces: [],
            mockedThreads: []
        )
    }

    private init(
        store: iPadSidebarStore,
        selectionState: iPadSelectionState,
        mockedWorkspaces: [iPadWorkspaceSummary],
        mockedThreads: [iPadThreadSummary]
    ) {
        self.store = store
        self.selectionState = selectionState
        self.mockedWorkspaces = mockedWorkspaces
        self.mockedThreads = mockedThreads
    }

    #if DEBUG
    /// MOCK initializer: hands the sidebar deterministic sample data so
    /// previews and design iteration can exercise the populated render
    /// paths without needing a live bridge connection. Gated `#if DEBUG`.
    public static func mocked(
        store: iPadSidebarStore,
        selectionState: iPadSelectionState,
        workspaces: [iPadWorkspaceSummary] = SidebarSampleData.workspaces,
        threads: [iPadThreadSummary] = SidebarSampleData.threads
    ) -> iPadSidebar {
        iPadSidebar(
            store: store,
            selectionState: selectionState,
            mockedWorkspaces: workspaces,
            mockedThreads: threads
        )
    }
    #endif

    public var body: some View {
        ZStack {
            Theme.sidebarBase.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.section) {
                    header
                    SidebarSearchField(
                        query: $query,
                        resultCount: query.isEmpty ? nil : totalResultCount,
                        isFocused: $searchFocused
                    )
                    activeRunsSection
                    pinnedSection
                    recentsSection
                    workspacesSection
                    threadsSection
                    settingsSection
                    Spacer(minLength: Theme.Spacing.screen)
                }
                .padding(.horizontal, Theme.Spacing.section)
                .padding(.vertical, Theme.Spacing.screen)
            }
            .scrollIndicators(.hidden)
        }
        .accessibilityElement(children: .contain)
        .onKeyPress(keys: ["f"]) { press in
            if press.modifiers.contains(.command) {
                searchFocused = true
                return .handled
            }
            return .ignored
        }
    }

    // MARK: - Data

    /// Workspaces seen by the sidebar — either the store's real data or
    /// the mocked fixture, depending on which initializer ran.
    private var sourceWorkspaces: [iPadWorkspaceSummary] {
        mockedWorkspaces.isEmpty ? store.workspaces : mockedWorkspaces
    }

    /// Threads seen by the sidebar — either the store's real data or
    /// the mocked fixture, depending on which initializer ran.
    private var sourceThreads: [iPadThreadSummary] {
        mockedThreads.isEmpty ? store.threads : mockedThreads
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var filteredWorkspaces: [iPadWorkspaceSummary] {
        guard !trimmedQuery.isEmpty else { return sourceWorkspaces }
        let needle = trimmedQuery
        return sourceWorkspaces.filter { workspace in
            workspace.displayName.localizedCaseInsensitiveContains(needle)
                || workspace.subtitle.localizedCaseInsensitiveContains(needle)
                || workspace.id.localizedCaseInsensitiveContains(needle)
        }
    }

    private var filteredThreads: [iPadThreadSummary] {
        guard !trimmedQuery.isEmpty else { return sourceThreads }
        let needle = trimmedQuery
        return sourceThreads.filter { thread in
            thread.title.localizedCaseInsensitiveContains(needle)
                || thread.subtitle.localizedCaseInsensitiveContains(needle)
                || (thread.provider ?? "").localizedCaseInsensitiveContains(needle)
                || thread.id.localizedCaseInsensitiveContains(needle)
        }
    }

    private var activeThreads: [iPadThreadSummary] {
        let pool = trimmedQuery.isEmpty ? sourceThreads : filteredThreads
        return pool.filter(\.isActive)
    }

    /// Pinned workspaces — sourced via the desktop-broadcast `pinned`
    /// flag (see `SidebarSubThreadAssociation`). Filtered by the search
    /// query the same way the rest of the sidebar is.
    private var pinnedWorkspaces: [iPadWorkspaceSummary] {
        let pool = trimmedQuery.isEmpty ? sourceWorkspaces : filteredWorkspaces
        return pool.filter(\.isPinned)
    }

    /// Pinned threads — same selector as pinned workspaces.
    private var pinnedThreads: [iPadThreadSummary] {
        let pool = trimmedQuery.isEmpty ? sourceThreads : filteredThreads
        return pool.filter(\.isPinned)
    }

    /// Recents section content — top 5 most-recently-updated non-pinned
    /// threads. Mirrors the desktop's `selectRecentChats({ limit: 5 })`
    /// selector in `src/renderer/src/lib/recentChatsList.ts`.
    private var recentThreads: [iPadThreadSummary] {
        let pool = trimmedQuery.isEmpty ? sourceThreads : filteredThreads
        return SidebarRecentsSelector.recentThreads(from: pool, limit: 5, excludePinned: true)
    }

    /// Parent → children index over the visible thread pool, built fresh
    /// on every render. Cheap (O(N) on a bounded sidebar).
    private var subThreadIndex: SidebarSubThreadIndex {
        let pool = trimmedQuery.isEmpty ? sourceThreads : filteredThreads
        return SidebarSubThreadIndex(threads: pool)
    }

    private var totalResultCount: Int {
        filteredWorkspaces.count + filteredThreads.count
    }

    /// "Connected" proxy for the iPad shell: any data flowing through
    /// the store or the mocked fixture means the user is paired with
    /// something. Used by the Active Runs section to decide whether to
    /// surface the "agents are idle" hint.
    private var hasConnection: Bool {
        !sourceWorkspaces.isEmpty || !sourceThreads.isEmpty
    }

    // MARK: - Sections

    @ViewBuilder
    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: Theme.Spacing.tight) {
                Image(systemName: "ipad.landscape")
                    .font(Theme.Typography.sectionTitle)
                    .foregroundStyle(Theme.accent)
                    .frame(width: 32, height: 32)
                    .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.small, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("AGBench")
                        .font(Theme.Typography.headline)
                        .foregroundStyle(Theme.primaryText)
                    Text("Remote Console")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.secondaryText)
                }
            }
        }
        .padding(.horizontal, 2)
    }

    @ViewBuilder
    private var activeRunsSection: some View {
        if hasConnection {
            TimelineView(.periodic(from: Date(), by: 1.0)) { context in
                SidebarActiveRunsSection(
                    activeThreads: activeThreads,
                    workspaceLookup: { id in
                        sourceWorkspaces.first { $0.id == id }
                    },
                    selectedThreadID: selectionState.selectedThreadID,
                    onSelectThread: { threadID in
                        withAnimation(Theme.Motion.quick) {
                            selectionState.selectThread(threadID)
                        }
                    },
                    elapsedTick: context.date
                )
            }
        }
    }

    @ViewBuilder
    private var workspacesSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            sectionLabel("Workspaces", trailingCount: trimmedQuery.isEmpty ? nil : filteredWorkspaces.count)
            if sourceWorkspaces.isEmpty {
                SidebarEmptyState(
                    systemImage: "folder.badge.questionmark",
                    title: "No workspaces yet",
                    message: "Waiting for your Mac to broadcast workspaces."
                ) {
                    SidebarExampleWorkspaceRow(workspace: SidebarEmptyStateExample.workspaceRow)
                }
            } else if filteredWorkspaces.isEmpty {
                noResultsRow(label: "No workspaces match \u{201C}\(trimmedQuery)\u{201D}")
            } else {
                ForEach(filteredWorkspaces) { workspace in
                    workspaceRow(workspace)
                }
            }
        }
    }

    @ViewBuilder
    private var threadsSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            sectionLabel("Threads", trailingCount: trimmedQuery.isEmpty ? nil : filteredThreads.count)
            if sourceThreads.isEmpty {
                SidebarEmptyState(
                    systemImage: "text.bubble",
                    title: "No threads yet",
                    message: "Live runs and recent turns appear here as the desktop streams events."
                ) {
                    SidebarExampleThreadRow(thread: SidebarEmptyStateExample.threadRow)
                }
            } else if filteredThreads.isEmpty {
                noResultsRow(label: "No threads match \u{201C}\(trimmedQuery)\u{201D}")
            } else {
                // Render in parent → child order using the sub-thread index.
                // Children appear indented immediately under their parent
                // with a `↳` prefix; parents get a "branched · N" badge.
                let renderOrder = subThreadIndex.flattenedRenderOrder()
                ForEach(renderOrder) { row in
                    threadRow(row.thread, depth: row.depth, branchCount: row.branchCount)
                }
            }
        }
    }

    /// Pinned section — both pinned workspaces and pinned threads. Lifts
    /// the desktop's `pinnedWorkspaces` + `pinnedChats` derivations from
    /// `src/renderer/src/components/Sidebar.tsx`. Collapses (renders
    /// nothing) when both lists are empty so the section doesn't show
    /// until the desktop starts broadcasting pinned bits.
    @ViewBuilder
    private var pinnedSection: some View {
        let workspacesShown = pinnedWorkspaces
        let threadsShown = pinnedThreads
        if !workspacesShown.isEmpty || !threadsShown.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
                sectionLabel("Pinned", trailingCount: workspacesShown.count + threadsShown.count)
                ForEach(workspacesShown) { workspace in
                    workspaceRow(workspace)
                }
                ForEach(threadsShown) { thread in
                    threadRow(thread, depth: 0, branchCount: 0)
                }
            }
        }
    }

    /// Recents section — top 5 most-recently-updated threads across all
    /// workspaces. Lifts the desktop's `selectRecentChats({ limit: 5 })`
    /// pattern from `src/renderer/src/lib/recentChatsList.ts`.
    @ViewBuilder
    private var recentsSection: some View {
        let recents = recentThreads
        if !recents.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
                sectionLabel("Recents", trailingCount: recents.count)
                ForEach(recents) { thread in
                    threadRow(thread, depth: 0, branchCount: 0)
                }
            }
        }
    }

    @ViewBuilder
    private var settingsSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            sectionLabel("Settings", trailingCount: nil)
            Button {
                withAnimation(Theme.Motion.quick) {
                    selectionState.selectSettings()
                }
            } label: {
                sidebarRowContent(
                    title: "Connection",
                    subtitle: "Pairing, network, and bridge status",
                    systemImage: "gearshape",
                    isSelected: selectionState.selection == .settings,
                    trailing: nil,
                    isHovered: false
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Connection settings")
            .accessibilityAddTraits(selectionState.selection == .settings ? [.isSelected] : [])
        }
    }

    private func workspaceRow(_ workspace: iPadWorkspaceSummary) -> some View {
        let isSelected = selectionState.selection == .workspace(workspace.id)
        let threadCount = sourceThreads.filter { $0.workspaceID == workspace.id }.count
        return HoverableSidebarRow { isHovered in
            Button {
                withAnimation(Theme.Motion.quick) {
                    selectionState.selectWorkspace(workspace.id)
                }
            } label: {
                sidebarRowContent(
                    title: workspace.displayName,
                    subtitle: workspace.subtitle,
                    systemImage: workspace.isActive ? "folder.fill" : "folder",
                    isSelected: isSelected,
                    trailing: threadCount > 0 ? "\(threadCount)" : nil,
                    isHovered: isHovered
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Workspace, \(workspace.displayName)")
            .accessibilityValue(workspace.accessibilitySummary)
            .accessibilityAddTraits(isSelected ? [.isSelected] : [])
        }
    }

    /// Render a thread row. `depth > 0` indents the row and prefixes the
    /// title with `↳` to signal that it's a child sub-thread of the row
    /// above. `branchCount > 0` adds a "branched · N" badge — only set
    /// for parent rows. Tapping a child still selects it normally.
    private func threadRow(
        _ thread: iPadThreadSummary,
        depth: Int = 0,
        branchCount: Int = 0
    ) -> some View {
        let isSelected = selectionState.selection == .thread(thread.id)
        let isChild = depth > 0
        return HoverableSidebarRow { isHovered in
            Button {
                withAnimation(Theme.Motion.quick) {
                    selectionState.selectThread(thread.id)
                }
            } label: {
                HStack(alignment: .top, spacing: Theme.Spacing.control) {
                    Circle()
                        .fill(thread.isActive ? Theme.success : Theme.tertiaryText)
                        .frame(width: 8, height: 8)
                        .padding(.top, 7)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            if isChild {
                                Text("\u{21B3}")
                                    .font(Theme.Typography.caption)
                                    .foregroundStyle(Theme.tertiaryText)
                                    .accessibilityHidden(true)
                            }
                            Text(thread.title)
                                .font(Theme.Typography.sectionTitle)
                                .foregroundStyle(isSelected ? Theme.primaryText : Theme.secondaryText)
                                .lineLimit(1)
                            if branchCount > 0 {
                                Text("branched · \(branchCount)")
                                    .font(Theme.Typography.smallCaption)
                                    .foregroundStyle(Theme.secondaryAccent)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(
                                        Theme.secondaryAccent.opacity(0.14),
                                        in: Capsule(style: .continuous)
                                    )
                                    .accessibilityLabel("\(branchCount) sub-thread\(branchCount == 1 ? "" : "s")")
                            }
                            Spacer(minLength: Theme.Spacing.tight)
                            Text(thread.lastActivityAt, style: .relative)
                                .font(Theme.Typography.smallCaption)
                                .foregroundStyle(Theme.tertiaryText)
                                .lineLimit(1)
                        }
                        if !thread.subtitle.isEmpty {
                            Text(thread.subtitle)
                                .font(Theme.Typography.caption)
                                .foregroundStyle(Theme.tertiaryText)
                                .lineLimit(2)
                        }
                        if let provider = thread.provider, !provider.isEmpty {
                            Text(SidebarActiveRunsSection.providerLabel(for: provider))
                                .font(Theme.Typography.smallCaption)
                                .foregroundStyle(SidebarActiveRunsSection.providerTint(for: provider))
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(
                                    SidebarActiveRunsSection.providerTint(for: provider).opacity(0.14),
                                    in: Capsule(style: .continuous)
                                )
                        }
                    }
                }
                .padding(.leading, isChild ? Theme.Spacing.section : 0)
                .rowChrome(isSelected: isSelected, isHovered: isHovered)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isChild ? "Sub-thread, \(thread.title)" : "Thread, \(thread.title)")
            .accessibilityValue(thread.accessibilitySummary)
            .accessibilityAddTraits(isSelected ? [.isSelected] : [])
        }
    }

    private func noResultsRow(label: String) -> some View {
        HStack(spacing: Theme.Spacing.tight) {
            Image(systemName: "line.3.horizontal.decrease.circle")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.tertiaryText)
                .accessibilityHidden(true)
            Text(label)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(2)
        }
        .padding(.horizontal, Theme.Spacing.control)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
        }
        .accessibilityElement(children: .combine)
    }

    private func sectionLabel(_ title: String, trailingCount: Int?) -> some View {
        HStack(spacing: 6) {
            Text(title.uppercased())
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.tertiaryText)
            Spacer(minLength: Theme.Spacing.tight)
            if let trailingCount {
                Text("\(trailingCount)")
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Theme.inputSurface, in: Capsule(style: .continuous))
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 2)
        .accessibilityHidden(true)
    }

    private func sidebarRowContent(
        title: String,
        subtitle: String,
        systemImage: String,
        isSelected: Bool,
        trailing: String?,
        isHovered: Bool
    ) -> some View {
        HStack(spacing: Theme.Spacing.control) {
            Image(systemName: systemImage)
                .font(Theme.Typography.sectionTitle)
                .foregroundStyle(isSelected ? Theme.accent : Theme.secondaryText)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(Theme.Typography.sectionTitle)
                    .foregroundStyle(isSelected ? Theme.primaryText : Theme.secondaryText)
                    .lineLimit(1)
                Text(subtitle)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.tertiaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: Theme.Spacing.tight)
            if let trailing {
                Text(trailing)
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Theme.inputSurface, in: Capsule(style: .continuous))
            }
            if isSelected {
                Image(systemName: "checkmark")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.accent)
            }
        }
        .rowChrome(isSelected: isSelected, isHovered: isHovered)
    }
}

/// Captures hover state for a single sidebar row so pointer-equipped iPads
/// (with trackpad / Magic Keyboard) get a subtle hover tint. On touch-only
/// devices `onHover` never fires, so the row stays in its idle state.
@available(iOS 17.0, macOS 14.0, *)
private struct HoverableSidebarRow<Content: View>: View {
    @State private var isHovered: Bool = false
    @ViewBuilder let content: (Bool) -> Content

    var body: some View {
        content(isHovered)
            .onHover { hovering in
                withAnimation(Theme.Motion.quick) {
                    isHovered = hovering
                }
            }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private extension View {
    func rowChrome(isSelected: Bool, isHovered: Bool) -> some View {
        self
            .padding(.horizontal, Theme.Spacing.control)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                if isSelected {
                    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                        .fill(Theme.accentSoft)
                } else if isHovered {
                    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                        .fill(Theme.inputSurface)
                }
            }
            .overlay {
                if isSelected {
                    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                        .stroke(Theme.accent.opacity(0.45), lineWidth: 1.2)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
            .cardGlassBackground(cornerRadius: Theme.Radius.control)
    }
}

#if DEBUG
@available(iOS 17.0, macOS 14.0, *)
#Preview("iPad sidebar · mocked") {
    iPadSidebar.mocked(
        store: iPadSidebarStore(),
        selectionState: {
            let state = iPadSelectionState()
            state.selectThread(SidebarSampleData.threads.first(where: \.isActive)?.id ?? "")
            return state
        }()
    )
    .frame(width: 340, height: 760)
}

@available(iOS 17.0, macOS 14.0, *)
#Preview("iPad sidebar · empty") {
    iPadSidebar(
        store: iPadSidebarStore(),
        selectionState: iPadSelectionState()
    )
    .frame(width: 340, height: 760)
}
#endif
