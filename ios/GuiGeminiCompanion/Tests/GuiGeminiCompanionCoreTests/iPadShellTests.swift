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

    func testSidebarSelectionSurfaceIsStable() {
        XCTAssertEqual(iPadSidebarSelection.allCases, [.transcripts, .approvals, .compose])
        XCTAssertEqual(iPadSidebarSelection.transcripts.title, "Transcripts")
        XCTAssertEqual(iPadSidebarSelection.approvals.systemImage, "checkmark.shield")
        XCTAssertEqual(iPadSidebarSelection.compose.subtitle, "New desktop turn")
    }

    func testShellSidebarAndDetailConstructWithPackageSafeInputs() {
        let workspaces = [
            iPadWorkspaceSummary(
                id: "workspace-1",
                displayName: "GUIGemini",
                pathDisplayHint: "~/Developer/GUIGemini",
                branchName: "main",
                permissionMode: "write",
                dirtyFileCount: 2,
                isActive: true
            )
        ]

        let shell = iPadShell(workspaces: workspaces, initialSelection: .compose)
        let sidebar = iPadSidebar(
            selection: .constant(.compose),
            selectedWorkspaceID: .constant("workspace-1"),
            workspaces: workspaces
        )
        let detail = iPadDetailHost(
            selection: .compose,
            selectedWorkspace: workspaces[0]
        )

        XCTAssertEqual([Any](arrayLiteral: shell, sidebar, detail).count, 3)
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
