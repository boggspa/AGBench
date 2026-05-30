import SwiftUI
import XCTest
@testable import GuiGeminiCompanionCore

@available(iOS 17.0, macOS 14.0, *)
@MainActor
private final class EnsembleActionCallRecorder {
    var calls: [String] = []

    func append(_ call: String) {
        calls.append(call)
    }
}

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

    func testPreviewSamplesAvoidForcedProjectionDecodeCrashes() throws {
        let source = try String(contentsOf: ownedSourceURL("Sources/GuiGeminiCompanionCore/Views/iPad/iPadShell.swift"))

        XCTAssertFalse(source.contains("try! RemoteProjectionEnvelope.decode"))
        XCTAssertFalse(source.contains("fatalError(\"Expected ensemble preview payload\")"))
        XCTAssertTrue(source.contains("iPadPreviewErrorCard"))
    }

    func testRemoteTaskConsoleIconOnlyActionsHaveAccessibilityLabels() throws {
        let source = try String(contentsOf: ownedSourceURL("Sources/GuiGeminiCompanionCore/Views/RemoteTaskConsoleView.swift"))

        XCTAssertTrue(source.contains(".accessibilityLabel(\"Back to task list\")"))
        XCTAssertTrue(source.contains(".accessibilityLabel(\"Submit answer\")"))
        XCTAssertTrue(source.contains(".accessibilityLabel(\"Reject question\")"))
        XCTAssertTrue(source.contains(".accessibilityLabel(\"Send prompt\")"))
    }

    func testIPadEnsembleControlsUseVisibleTextLabels() throws {
        let source = try String(contentsOf: ownedSourceURL("Sources/GuiGeminiCompanionCore/Views/iPad/iPadShell.swift"))

        XCTAssertTrue(source.contains("Label(title, systemImage: systemImage)"))
        XCTAssertTrue(source.contains("Label(\"Queue\", systemImage: \"tray.and.arrow.down\")"))
        XCTAssertTrue(source.contains("Label(\"Steer\", systemImage: \"slider.horizontal.3\")"))
    }

    func testDiffInspectorRemainsReadOnly() throws {
        let source = try String(contentsOf: ownedSourceURL("Sources/GuiGeminiCompanionCore/Views/iPad/iPadDiffInspector.swift"))
        let lowercasedSource = source.lowercased()

        XCTAssertTrue(source.contains("Text(\"read-only\")"))
        XCTAssertFalse(source.contains("Button("))
        for forbiddenMutation in [
            "sendaction",
            "gitstage",
            "gitcommit",
            "providerauth",
            "writefile",
            "applypatch",
            "stage(",
            "commit("
        ] {
            XCTAssertFalse(
                lowercasedSource.contains(forbiddenMutation),
                "Diff inspector must not expose mutation affordance: \(forbiddenMutation)"
            )
        }
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

    func testSelectionStateSupportsTaskRoute() {
        let selection = iPadSelectionState()

        selection.selectTask("task-1")

        XCTAssertEqual(selection.selection, .task("task-1"))
        XCTAssertEqual(selection.selectedTaskID, "task-1")
        XCTAssertEqual(selection.selection?.id, "task:task-1")
    }

    func testRemoteComposerTargetResolvesSelectedThreadContext() {
        let thread = iPadThreadSummary(
            id: "thread-1",
            workspaceID: "workspace-1",
            title: "Remote iPad shell",
            subtitle: "running",
            provider: "codex"
        )

        let target = iPadRemoteComposerTarget(
            threadID: thread.id,
            thread: thread,
            taskDetail: nil,
            fallbackProvider: "gemini"
        )

        XCTAssertEqual(target.workspaceId, "workspace-1")
        XCTAssertEqual(target.threadId, "thread-1")
        XCTAssertEqual(target.provider, "codex")
        XCTAssertEqual(target.title, "Remote iPad shell")
        XCTAssertTrue(target.capabilityAllowsStartTurn)
        XCTAssertNil(target.unavailableReason)
    }

    func testRemoteComposerTargetUsesTaskCapabilityGate() {
        let task = RemoteTaskCard(
            id: "task-1",
            workspaceId: "workspace-projected",
            workspaceDisplayName: "GUIGemini",
            threadId: "thread-projected",
            threadTitle: "Projected task",
            provider: "claude",
            status: .running,
            capabilities: RemoteTaskCapabilities(startTurn: false)
        )
        let detail = RemoteTaskDetail(
            task: task,
            approvals: [],
            questions: [],
            threadSnapshot: nil,
            diffSummary: nil,
            ensemble: nil,
            actionState: nil
        )

        let target = iPadRemoteComposerTarget(
            threadID: "thread-fallback",
            thread: iPadThreadSummary(
                id: "thread-fallback",
                workspaceID: "workspace-fallback",
                title: "Fallback",
                provider: "gemini"
            ),
            taskDetail: detail,
            fallbackProvider: "gemini"
        )

        XCTAssertEqual(target.workspaceId, "workspace-projected")
        XCTAssertEqual(target.threadId, "thread-projected")
        XCTAssertEqual(target.provider, "claude")
        XCTAssertFalse(target.capabilityAllowsStartTurn)
        XCTAssertEqual(target.unavailableReason, "Start turn is unavailable for this task.")
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
              "roundId": "round-ensemble",
              "status": "running",
              "roundStatus": "turn-bound",
              "activeParticipantId": "planner",
              "participants": [
                {
                  "id": "planner",
                  "provider": "gemini",
                  "role": "Planner",
                  "status": "running",
                  "isActive": true,
                  "wakeupId": "wakeup-planner"
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
        XCTAssertEqual(detail?.ensemble?.roundId, "round-ensemble")
        XCTAssertEqual(detail?.ensemble?.participants.first?.wakeupId, "wakeup-planner")
        XCTAssertEqual(detail?.ensemble?.queue.count, 1)
        XCTAssertEqual(detail?.ensemble?.capabilities.queueLimit, 2)
        XCTAssertTrue(detail?.ensemble?.capabilities.cancelRound ?? false)
        XCTAssertEqual([Any](arrayLiteral: shell).count, 1)
    }

    func testIPadTaskSelectionDrivesShellDetailAndInspectorInputs() throws {
        let store = RemoteTaskStore()
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        store.apply(RemoteProjectionEnvelope(
            kind: .task,
            taskId: "task-1",
            publishedAt: now,
            payload: .task(RemoteTaskCard(
                id: "task-1",
                workspaceId: "workspace-1",
                workspaceDisplayName: "GUIGemini",
                threadId: "thread-1",
                threadTitle: "Task-first iPad",
                runId: "run-1",
                provider: "codex",
                status: .awaitingApproval,
                updatedAt: now,
                capabilities: RemoteTaskCapabilities(approve: true, startTurn: true)
            ))
        ))
        store.apply(RemoteProjectionEnvelope(
            kind: .approval,
            taskId: "task-1",
            publishedAt: now,
            payload: .approval(MobileApprovalCard(
                id: "approval-1",
                taskId: "task-1",
                workspaceId: "workspace-1",
                threadId: "thread-1",
                runId: "run-1",
                provider: "codex",
                title: "Run smoke",
                expiresAt: now.addingTimeInterval(300)
            ))
        ))
        let selection = iPadSelectionState(initialSelection: .task("task-1"))
        let sidebarStore = iPadSidebarStore(
            workspaces: [iPadWorkspaceSummary(id: "workspace-1", displayName: "GUIGemini")],
            threads: [iPadThreadSummary(id: "thread-1", workspaceID: "workspace-1", title: "Task-first iPad")]
        )

        let sidebar = iPadSidebar(store: sidebarStore, selectionState: selection, remoteTaskStore: store)
        let detail = iPadDetailHost(
            selection: selection.selection,
            store: sidebarStore,
            remoteTaskStore: store
        )
        let shell = iPadShell(
            remoteTaskStore: store,
            selectionState: selection,
            sidebarStore: sidebarStore
        )

        XCTAssertEqual(store.buckets.needsAttention.map(\.id), ["task-1"])
        XCTAssertEqual(store.detail(for: "task-1")?.approvals.first?.id, "approval-1")
        XCTAssertEqual([Any](arrayLiteral: sidebar, detail, shell).count, 3)
    }

    func testEnsembleControlActionsCanBeInvokedFromShellHandlers() async throws {
        let state = try ensembleStateForActionTests()
        let recorder = EnsembleActionCallRecorder()
        let actions = iPadEnsembleControlActions(
            cancelRound: { state in recorder.append("cancel:\(state.roundId ?? "")") },
            skipActiveParticipant: { state in recorder.append("skip:\(state.activeParticipantId ?? "")") },
            wakeNow: { state in recorder.append("wake:\(state.participants.first?.wakeupId ?? "")") },
            cancelWakeup: { state in recorder.append("cancelWakeup:\(state.participants.first?.wakeupId ?? "")") },
            queuePrompt: { state, text in recorder.append("queue:\(state.roundId ?? ""):\(text)") },
            steer: { state, text in recorder.append("steer:\(state.threadId):\(text)") }
        )

        await actions.cancelRound?(state)
        await actions.skipActiveParticipant?(state)
        await actions.wakeNow?(state)
        await actions.cancelWakeup?(state)
        await actions.queuePrompt?(state, "next")
        await actions.steer?(state, "focus")

        XCTAssertEqual(recorder.calls, [
            "cancel:round-ensemble",
            "skip:planner",
            "wake:wakeup-planner",
            "cancelWakeup:wakeup-planner",
            "queue:round-ensemble:next",
            "steer:thread-ensemble:focus"
        ])
    }

    func testRemoteTaskConsoleViewModelRoutesEnsembleActionState() async throws {
        let store = RemoteTaskStore()
        store.ingest(try ensembleProjectionEventForActionTests())
        let viewModel = RemoteTaskConsoleViewModel(store: store)
        let state = try XCTUnwrap(store.detail(threadID: "thread-ensemble")?.ensemble)

        await viewModel.ensembleCancelRound(state)
        guard case .failed(let cancelKind, let cancelTarget, let cancelMessage, _) = store.actionStatesByTaskId["task-ensemble"] else {
            return XCTFail("Expected cancel round to fail without a bridge client")
        }
        XCTAssertEqual(cancelKind, .ensembleCancelRound)
        XCTAssertEqual(cancelTarget, "round-ensemble")
        XCTAssertEqual(cancelMessage, "Bridge is not connected")

        await viewModel.ensembleWakeNow(state)
        guard case .failed(let wakeKind, let wakeTarget, let wakeMessage, _) = store.actionStatesByTaskId["task-ensemble"] else {
            return XCTFail("Expected wake now to fail without a bridge client")
        }
        XCTAssertEqual(wakeKind, .ensembleWakeNow)
        XCTAssertEqual(wakeTarget, "wakeup-planner")
        XCTAssertEqual(wakeMessage, "Bridge is not connected")
        XCTAssertEqual(viewModel.lastActionMessage, "Bridge is not connected")
    }

    func testRemoteTaskConsoleViewModelDoesNotSendWakeActionWithoutWakeupId() async throws {
        let store = RemoteTaskStore()
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
              "roundId": "round-ensemble",
              "status": "running",
              "activeParticipantId": "planner",
              "participants": [
                { "id": "planner", "provider": "gemini", "role": "Planner", "isActive": true }
              ],
              "capabilities": {
                "wakeNow": true
              }
            }
          }
        }
        """.utf8))
        store.ingest(event)
        let viewModel = RemoteTaskConsoleViewModel(store: store)
        let state = try XCTUnwrap(store.detail(threadID: "thread-ensemble")?.ensemble)

        await viewModel.ensembleWakeNow(state)

        guard case .failed(let kind, let target, let message, _) = store.actionStatesByTaskId["task-ensemble"] else {
            return XCTFail("Expected wake now to fail before bridge send")
        }
        XCTAssertEqual(kind, .ensembleWakeNow)
        XCTAssertEqual(target, "planner")
        XCTAssertEqual(message, "No pending wakeup id is available for this Ensemble.")
    }

    private func ensembleStateForActionTests() throws -> RemoteEnsembleProjection {
        let store = RemoteTaskStore()
        store.ingest(try ensembleProjectionEventForActionTests())
        return try XCTUnwrap(store.detail(threadID: "thread-ensemble")?.ensemble)
    }

    private func ensembleProjectionEventForActionTests() throws -> BridgeRunEvent {
        try BridgeRunEvent.decode(eventRecordBytes: Data("""
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
              "roundId": "round-ensemble",
              "status": "running",
              "roundStatus": "turn-bound",
              "activeParticipantId": "planner",
              "participants": [
                {
                  "id": "planner",
                  "provider": "gemini",
                  "role": "Planner",
                  "status": "running",
                  "isActive": true,
                  "wakeupId": "wakeup-planner"
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
                "cancelWakeup": true,
                "queuePrompt": true,
                "steer": true,
                "queueLimit": 2
              }
            }
          }
        }
        """.utf8))
    }

    private func ownedSourceURL(_ relativePath: String) -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent(relativePath)
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
