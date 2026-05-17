import SwiftUI
import XCTest
@testable import GuiGeminiCompanionCore

@available(iOS 17.0, macOS 14.0, *)
@MainActor
final class iPadShellTests: XCTestCase {
    func testWorkspaceSummaryNormalizesEmptyNameAndDirtyCount() {
        let workspace = iPadWorkspaceSummary(
            id: "workspace-1",
            displayName: "",
            pathDisplayHint: "~/Developer/GUIGemini",
            permissionMode: "write",
            dirtyFileCount: -4
        )

        XCTAssertEqual(workspace.displayName, "workspace-1")
        XCTAssertEqual(workspace.subtitle, "~/Developer/GUIGemini")
        XCTAssertEqual(workspace.dirtyFileCount, 0)
        XCTAssertTrue(workspace.accessibilitySummary.contains("write"))
    }

    func testShellComposesWithEmptyPairedStateInputs() {
        let store = iPadSidebarStore()
        let selection = iPadSelectionState()
        let shell = iPadShell(selectionState: selection, sidebarStore: store)
        let sidebar = iPadSidebar(store: store, selectionState: selection)
        let detail = iPadDetailHost(selection: selection.selection, store: store)
        let inspector = iPadDiffInspector(event: nil)

        XCTAssertEqual([Any](arrayLiteral: shell, sidebar, detail, inspector).count, 4)
        XCTAssertTrue(store.workspaces.isEmpty)
        XCTAssertTrue(store.threads.isEmpty)
    }

    func testSelectionStateSurvivesRerender() {
        let store = iPadSidebarStore(
            workspaces: [
                iPadWorkspaceSummary(id: "workspace-1", displayName: "GUIGemini")
            ],
            threads: [
                iPadThreadSummary(
                    id: "thread-1",
                    workspaceID: "workspace-1",
                    title: "Wire iPad",
                    subtitle: "active run",
                    provider: "gemini",
                    isActive: true
                )
            ]
        )
        let selection = iPadSelectionState()
        selection.selectThread("thread-1")

        _ = iPadShell(selectionState: selection, sidebarStore: store)
        _ = iPadShell(selectionState: selection, sidebarStore: store)

        XCTAssertEqual(selection.selection, .thread("thread-1"))
        XCTAssertEqual(selection.selectedThreadID, "thread-1")
    }

    func testSidebarStoreDerivesWorkspaceAndThreadRowsFromSeeds() {
        let store = iPadSidebarStore()
        store.refresh(
            seedWorkspaces: [
                iPadWorkspaceSummary(
                    id: "workspace-1",
                    displayName: "GUIGemini",
                    pathDisplayHint: "~/Developer/GUIGemini",
                    isActive: true
                )
            ],
            seedThreads: [
                iPadThreadSummary(
                    id: "thread-1",
                    workspaceID: "workspace-1",
                    title: "Polish iPad shell",
                    subtitle: "recent",
                    provider: "codex",
                    isActive: true
                )
            ]
        )

        XCTAssertEqual(store.workspaces.first?.id, "workspace-1")
        XCTAssertEqual(store.threads.first?.id, "thread-1")
        XCTAssertEqual(store.threads(in: "workspace-1").count, 1)
    }

    func testDiffInspectorRendersSampleDiffEvent() throws {
        let event = try BridgeRunEvent.decode(eventRecordBytes: Data("""
        {
          "channel": "agent-output",
          "provider": "codex",
          "publishedAt": "2026-05-16T10:30:00.000Z",
          "payload": {
            "kind": "diff",
            "threadId": "thread-1",
            "workspaceId": "workspace-1",
            "path": "Sources/App.swift",
            "diff": "diff --git a/Sources/App.swift b/Sources/App.swift\\n@@ -1,2 +1,2 @@\\n-import Old\\n+import New"
          }
        }
        """.utf8))

        let payload = iPadDiffInspector.diffPayload(from: event)
        let inspector = iPadDiffInspector(event: event)

        XCTAssertEqual(payload?.path, "Sources/App.swift")
        XCTAssertTrue(payload?.unifiedDiff?.contains("+import New") == true)
        XCTAssertNotNil(iPadDiffInspector.latestDiffEvent(in: [event], threadID: "thread-1"))
        XCTAssertEqual([Any](arrayLiteral: inspector).count, 1)
    }

    // MARK: - Bridge summary application

    func testApplyWorkspaceListReplacesEntireWorkspaceArray() {
        let store = iPadSidebarStore(
            workspaces: [
                iPadWorkspaceSummary(id: "stale", displayName: "Stale workspace")
            ]
        )
        store.applyWorkspaceList([
            WorkspaceSummaryPayload(
                workspaceId: "ws-1",
                displayName: "GUIGemini",
                path: "/Users/me/dev/GUIGemini",
                chatCount: 2,
                runningChatCount: 1
            ),
            WorkspaceSummaryPayload(
                workspaceId: "ws-2",
                displayName: "CodexBridge",
                path: "/Users/me/dev/CodexBridge",
                chatCount: 0,
                runningChatCount: 0
            )
        ])
        XCTAssertEqual(store.workspaces.count, 2)
        XCTAssertNil(store.workspace(id: "stale"), "applyWorkspaceList replaces the full list")
        // ws-1 has a running chat → isActive → sorts ahead of inactive ws-2.
        XCTAssertEqual(store.workspaces.first?.id, "ws-1")
        XCTAssertTrue(store.workspaces.first?.isActive ?? false)
        XCTAssertEqual(store.workspaces.first?.pathDisplayHint, "/Users/me/dev/GUIGemini")
    }

    func testApplyWorkspaceUpdateUpsertsSingleWorkspace() {
        let store = iPadSidebarStore()
        store.applyWorkspaceUpdate(
            WorkspaceSummaryPayload(
                workspaceId: "ws-1",
                displayName: "Original",
                path: "/path/one",
                chatCount: 1,
                runningChatCount: 0
            )
        )
        XCTAssertEqual(store.workspaces.count, 1)

        // Same id → replace in place rather than appending.
        store.applyWorkspaceUpdate(
            WorkspaceSummaryPayload(
                workspaceId: "ws-1",
                displayName: "Renamed",
                path: "/path/one",
                chatCount: 1,
                runningChatCount: 1
            )
        )
        XCTAssertEqual(store.workspaces.count, 1)
        XCTAssertEqual(store.workspace(id: "ws-1")?.displayName, "Renamed")
        XCTAssertTrue(store.workspace(id: "ws-1")?.isActive ?? false)

        // New id → insert.
        store.applyWorkspaceUpdate(
            WorkspaceSummaryPayload(
                workspaceId: "ws-2",
                displayName: "Sibling",
                path: "/path/two",
                chatCount: 0,
                runningChatCount: 0
            )
        )
        XCTAssertEqual(store.workspaces.count, 2)
        XCTAssertNotNil(store.workspace(id: "ws-2"))
    }

    func testApplyThreadListReplacesEntireThreadArray() {
        let store = iPadSidebarStore(
            threads: [
                iPadThreadSummary(id: "stale", title: "Old thread")
            ]
        )
        store.applyThreadList([
            ThreadSummaryPayload(
                chatId: "chat-1",
                title: "Active run",
                workspaceId: "ws-1",
                provider: "gemini",
                status: "running",
                lastMessageAt: Date(timeIntervalSinceNow: -10)
            ),
            ThreadSummaryPayload(
                chatId: "chat-2",
                title: "Idle chat",
                workspaceId: "ws-1",
                provider: "codex",
                status: "idle",
                lastMessageAt: Date(timeIntervalSinceNow: -1000)
            )
        ])
        XCTAssertEqual(store.threads.count, 2)
        XCTAssertNil(store.thread(id: "stale"))
        // The running thread should sort first (isActive bubbles up).
        XCTAssertEqual(store.threads.first?.id, "chat-1")
        XCTAssertTrue(store.threads.first?.isActive ?? false)
        XCTAssertEqual(store.threads.first?.provider, "gemini")
        XCTAssertEqual(store.threads(in: "ws-1").count, 2)
    }

    func testApplyThreadUpdateUpsertsSingleThread() {
        let store = iPadSidebarStore()
        store.applyThreadUpdate(
            ThreadSummaryPayload(
                chatId: "chat-1",
                title: "First pass",
                workspaceId: "ws-1",
                provider: "claude",
                status: "running"
            )
        )
        XCTAssertEqual(store.threads.count, 1)
        XCTAssertEqual(store.thread(id: "chat-1")?.title, "First pass")
        XCTAssertTrue(store.thread(id: "chat-1")?.isActive ?? false)

        // Same id → replace; status transitions to success → no longer active.
        store.applyThreadUpdate(
            ThreadSummaryPayload(
                chatId: "chat-1",
                title: "First pass",
                workspaceId: "ws-1",
                provider: "claude",
                status: "success"
            )
        )
        XCTAssertEqual(store.threads.count, 1)
        XCTAssertFalse(store.thread(id: "chat-1")?.isActive ?? true)

        // Global thread (no workspaceId).
        store.applyThreadUpdate(
            ThreadSummaryPayload(
                chatId: "chat-2",
                title: "Global",
                workspaceId: nil,
                provider: "kimi",
                status: "idle"
            )
        )
        XCTAssertEqual(store.threads.count, 2)
        XCTAssertNil(store.thread(id: "chat-2")?.workspaceID)
    }

    func testApplyWorkspaceListIsIdempotentForUnchangedInput() {
        let store = iPadSidebarStore()
        let payload = WorkspaceSummaryPayload(
            workspaceId: "ws-1",
            displayName: "GUIGemini",
            path: "/p",
            chatCount: 0,
            runningChatCount: 0
        )
        store.applyWorkspaceList([payload])
        let snapshot = store.workspaces
        store.applyWorkspaceList([payload])
        XCTAssertEqual(store.workspaces, snapshot)
    }

    func testBriefThreeThemeTokensArePubliclyReachable() {
        let colors: [Color] = [
            Theme.windowBase,
            Theme.cardFill,
            Theme.cardStroke,
            Theme.elevatedCardFill,
            Theme.accent,
            Theme.accentSoft,
            Theme.primaryText,
            Theme.secondaryText,
            Theme.tertiaryText,
            Theme.separator,
            Theme.sidebarBase,
            Theme.Text.primary
        ]
        let _: Material = Theme.cardBlur
        let _: Theme.CardGlassBackgroundModifier = Theme.cardGlassBackground()

        XCTAssertEqual(colors.count, 12)
        XCTAssertGreaterThan(Theme.Radius.card, Theme.Radius.small)
        XCTAssertGreaterThan(Theme.Spacing.section, Theme.Spacing.tight)
    }
}
