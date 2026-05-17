import Foundation

/// Single faded "Example" workspace + thread summary baked into the rich
/// empty-state cards. Always available (release + debug) because the empty
/// state itself ships in production: when bridge data hasn't arrived, the
/// example row visually demonstrates what a populated row will look like.
///
/// The empty-state copy and the "Example" pill make it unambiguous that the
/// row is illustrative — users won't mistake it for a real workspace.
@available(iOS 17.0, macOS 14.0, *)
public enum SidebarEmptyStateExample {
    /// MOCK: a single faded example row used in the rich empty state to
    /// show "this is what a populated row will look like".
    public static let workspaceRow = iPadWorkspaceSummary(
        id: "/Users/sample/Developer/agbench-main",
        displayName: "agbench-main",
        pathDisplayHint: "~/Developer/agbench-main",
        branchName: "main",
        permissionMode: "ask",
        dirtyFileCount: 2,
        isActive: true
    )

    /// MOCK: a single thread row used in the rich empty state.
    public static let threadRow = iPadThreadSummary(
        id: "thread-example",
        workspaceID: "/Users/sample/Developer/agbench-main",
        title: "Wire up workspace events",
        subtitle: "running · ~/Developer/agbench-main",
        provider: "gemini",
        runID: "run-example",
        lastActivityAt: Date().addingTimeInterval(-32),
        isActive: true
    )
}

/// MOCK: deterministic sample workspace + thread summaries used by previews
/// and the `mocked` rendering path of `iPadSidebar`. Real bridge data flows
/// through the production path; these mocks only exist so empty-state UX can
/// be designed without needing a live desktop.
///
/// Gated `#if DEBUG` so a release build cannot accidentally hand mocked
/// data to the production sidebar render path.
#if DEBUG
@available(iOS 17.0, macOS 14.0, *)
public enum SidebarSampleData {
    /// MOCK: a small fixture set used to populate the "Active runs" pinned
    /// section + the workspace/thread previews. Plausible names so it reads
    /// the way real desktop data will.
    public static let workspaces: [iPadWorkspaceSummary] = [
        // MOCK: primary workspace, active, several pending edits.
        iPadWorkspaceSummary(
            id: "/Users/sample/Developer/agbench-main",
            displayName: "agbench-main",
            pathDisplayHint: "~/Developer/agbench-main",
            branchName: "feature/ipad-companion",
            permissionMode: "ask",
            dirtyFileCount: 4,
            isActive: true
        ),
        // MOCK: a quieter workspace, no active runs.
        iPadWorkspaceSummary(
            id: "/Users/sample/Developer/side-project",
            displayName: "side-project",
            pathDisplayHint: "~/Developer/side-project",
            branchName: "main",
            permissionMode: "default",
            dirtyFileCount: 0,
            isActive: false
        ),
        // MOCK: docs-only workspace, demonstrates the secondary state.
        iPadWorkspaceSummary(
            id: "/Users/sample/Developer/docs-only",
            displayName: "docs-only",
            pathDisplayHint: "~/Developer/docs-only",
            branchName: "main",
            permissionMode: "default",
            dirtyFileCount: 0,
            isActive: false
        )
    ]

    /// MOCK: a small set of thread summaries spanning two workspaces and two
    /// providers; the first two are active and feed the "Active runs" pinned
    /// section.
    public static let threads: [iPadThreadSummary] = [
        // MOCK: an actively running gemini turn on the primary workspace.
        iPadThreadSummary(
            id: "thread-sample-active-gemini",
            workspaceID: "/Users/sample/Developer/agbench-main",
            title: "Polish iPad shell",
            subtitle: "running · ~/Developer/agbench-main",
            provider: "gemini",
            runID: "run-sample-1",
            lastActivityAt: Date().addingTimeInterval(-94),
            isActive: true
        ),
        // MOCK: a codex run waiting on an approval prompt.
        iPadThreadSummary(
            id: "thread-sample-active-codex",
            workspaceID: "/Users/sample/Developer/agbench-main",
            title: "Approval needed",
            subtitle: "tool · git push origin main",
            provider: "codex",
            runID: "run-sample-2",
            lastActivityAt: Date().addingTimeInterval(-18),
            isActive: true
        ),
        // MOCK: an older, idle thread to demonstrate the non-active rows.
        iPadThreadSummary(
            id: "thread-sample-recent-claude",
            workspaceID: "/Users/sample/Developer/side-project",
            title: "Refactor billing module",
            subtitle: "complete · 7m ago",
            provider: "claude",
            runID: nil,
            lastActivityAt: Date().addingTimeInterval(-460),
            isActive: false
        )
    ]

}
#endif
