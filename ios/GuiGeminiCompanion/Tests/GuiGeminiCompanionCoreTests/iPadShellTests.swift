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
