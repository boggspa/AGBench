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
        let shell = iPadShell(
            yoloModeEnabled: true,
            onSetYoloMode: { _ in },
            selectionState: selection,
            sidebarStore: store
        )
        let sidebar = iPadSidebar(store: store, selectionState: selection)
        let detail = iPadDetailHost(
            selection: selection.selection,
            store: store,
            yoloModeEnabled: true,
            onSetYoloMode: { _ in }
        )
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

    func testMobileDiffSummaryClampLimitsFilesHunksAndLines() {
        let longHunk = MobileDiffHunk(
            filePath: "Sources/App.swift",
            header: "@@ -1,120 +1,120 @@",
            previewLines: (0..<120).map { "+line \($0)" }
        )
        let files = (0..<10).map { index in
            MobileDiffFile(
                path: "Sources/File\(index).swift",
                additions: 120,
                deletions: 0,
                hunks: [longHunk]
            )
        }
        let summary = MobileDiffSummary(
            runId: "run-clamp",
            filesChanged: 10,
            files: files
        )

        let clamped = summary.clamped(maxFiles: 2, maxHunksPerFile: 1, maxPreviewLinesPerHunk: 3)

        XCTAssertEqual(clamped.files.count, 2)
        XCTAssertEqual(clamped.files.first?.hunks.count, 1)
        XCTAssertEqual(clamped.files.first?.hunks.first?.previewLines.count, 3)
        XCTAssertTrue(clamped.files.first?.hunks.first?.truncated ?? false)
        XCTAssertTrue(clamped.truncated)
    }

    func testMobileDiffSummaryDecodesBinarySensitiveAndMultiFileStates() throws {
        let envelope = try RemoteProjectionEnvelope.decode(payloadJSON: Data("""
        {
          "kind": "diff",
          "taskId": "task-1",
          "workspaceId": "workspace-1",
          "threadId": "thread-1",
          "payload": {
            "runId": "run-1",
            "filesChanged": 3,
            "files": [
              {
                "path": "Sources/App.swift",
                "status": "modified",
                "additions": 2,
                "deletions": 1,
                "hunks": [
                  {
                    "header": "@@ -1,1 +1,2 @@",
                    "previewLines": ["-old", "+new", "+more"]
                  }
                ]
              },
              {
                "path": "Assets/logo.png",
                "status": "modified",
                "binary": true
              },
              {
                "path": "Secrets/.env",
                "status": "modified",
                "sensitive": true,
                "sensitiveReason": "redacted by desktop policy"
              }
            ]
          }
        }
        """.utf8))

        guard case .diff(let summary) = envelope.payload else {
            return XCTFail("Expected diff projection")
        }
        let inspector = iPadDiffInspector(summary: summary)

        XCTAssertEqual(summary.filesChanged, 3)
        XCTAssertEqual(summary.files.count, 3)
        XCTAssertEqual(summary.binaryFileCount, 1)
        XCTAssertEqual(summary.sensitiveFileCount, 1)
        XCTAssertEqual(iPadDiffInspector.diffPayload(from: summary)?.path, "Sources/App.swift")
        XCTAssertEqual([Any](arrayLiteral: inspector).count, 1)
    }

    func testRemoteTaskStoreProjectsEnsembleStatusForSelectedThread() throws {
        let event = try BridgeRunEvent.decode(eventRecordBytes: Data("""
        {
          "channel": "remote-projection",
          "provider": "ensemble",
          "publishedAt": "2026-05-20T12:00:00.000Z",
          "payload": {
            "kind": "ensemble",
            "taskId": "task-ensemble",
            "workspaceId": "workspace-1",
            "threadId": "thread-ensemble",
            "payload": {
              "threadId": "thread-ensemble",
              "runId": "run-ensemble",
              "status": "running",
              "roundStatus": "turn-bound",
              "activeParticipantId": "planner",
              "participants": [
                {
                  "id": "planner",
                  "provider": "gemini",
                  "role": "Planner",
                  "status": "running",
                  "isActive": true
                },
                {
                  "id": "reviewer",
                  "provider": "codex",
                  "role": "Reviewer",
                  "status": "idle"
                }
              ],
              "queue": [
                { "id": "queued-1", "label": "Follow-up", "participantId": "reviewer" }
              ],
              "capabilities": {
                "cancelRound": true,
                "skipActiveParticipant": true,
                "wakeNow": true,
                "cancelWakeup": false,
                "queuePrompt": true,
                "steer": true,
                "queueLimit": 2
              }
            }
          }
        }
        """.utf8))
        let store = RemoteTaskStore()

        store.ingest(event)
        let detail = store.detail(threadID: "thread-ensemble")
        let shell = iPadShell(
            remoteTaskStore: store,
            selectionState: iPadSelectionState(initialSelection: .thread("thread-ensemble")),
            sidebarStore: iPadSidebarStore(
                threads: [
                    iPadThreadSummary(id: "thread-ensemble", title: "Ensemble run")
                ]
            )
        )

        XCTAssertEqual(detail?.ensemble?.participants.count, 2)
        XCTAssertEqual(detail?.ensemble?.activeParticipantId, "planner")
        XCTAssertEqual(detail?.ensemble?.queue.count, 1)
        XCTAssertEqual(detail?.ensemble?.capabilities.queueLimit, 2)
        XCTAssertTrue(detail?.ensemble?.capabilities.cancelRound ?? false)
        XCTAssertEqual([Any](arrayLiteral: shell).count, 1)
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

    func testSubthreadIndexPromotesVisibleChildWhenParentIsFilteredOut() {
        SidebarSubThreadAssociation.reset()
        defer { SidebarSubThreadAssociation.reset() }
        SidebarSubThreadAssociation.recordParent(threadId: "child", parentChatId: "parent")

        let index = SidebarSubThreadIndex(threads: [
            iPadThreadSummary(
                id: "child",
                workspaceID: "ws-1",
                title: "Child match",
                provider: "codex"
            )
        ])

        let rows = index.flattenedRenderOrder()
        XCTAssertEqual(rows.map(\.thread.id), ["child"])
        XCTAssertEqual(rows.first?.depth, 0)
    }
}
