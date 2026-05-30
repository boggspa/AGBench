import XCTest
@testable import GuiGeminiCompanionCore

@MainActor
final class RemoteTaskStoreTests: XCTestCase {
    func testBucketsClassifyAttentionActiveAndRecentTasks() {
        let store = RemoteTaskStore()
        let now = Date(timeIntervalSince1970: 1_800_000_000)

        store.apply(RemoteProjectionEnvelope(
            kind: .task,
            taskId: "active",
            publishedAt: now,
            payload: .task(RemoteTaskCard(
                id: "active",
                threadId: "chat-active",
                runId: "run-active",
                provider: "codex",
                status: .running,
                lastMessage: "working",
                updatedAt: now
            ))
        ))
        store.apply(RemoteProjectionEnvelope(
            kind: .task,
            taskId: "recent",
            publishedAt: now.addingTimeInterval(-60),
            payload: .task(RemoteTaskCard(
                id: "recent",
                threadId: "chat-recent",
                provider: "gemini",
                status: .completed,
                lastMessage: "done",
                updatedAt: now.addingTimeInterval(-60)
            ))
        ))
        store.apply(RemoteProjectionEnvelope(
            kind: .approval,
            taskId: "attention",
            publishedAt: now.addingTimeInterval(10),
            payload: .approval(MobileApprovalCard(
                id: "approval-1",
                taskId: "attention",
                workspaceId: "ws",
                threadId: "chat-attention",
                runId: "run-attention",
                provider: "codex",
                title: "Run tests",
                summary: "swift test",
                expiresAt: now.addingTimeInterval(300)
            ))
        ))

        let buckets = store.buckets
        XCTAssertEqual(buckets.needsAttention.map(\.id), ["attention"])
        XCTAssertEqual(buckets.active.map(\.id), ["active"])
        XCTAssertEqual(buckets.recent.map(\.id), ["recent"])
        XCTAssertEqual(store.pendingApprovalCount(for: "attention"), 1)
    }

    func testSelectedTaskDetailCollectsProjectionPayloads() {
        let store = RemoteTaskStore()
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        store.apply(RemoteProjectionEnvelope(
            kind: .task,
            taskId: "task-1",
            publishedAt: now,
            payload: .task(RemoteTaskCard(
                id: "task-1",
                threadId: "chat-1",
                runId: "run-1",
                provider: "codex",
                status: .waiting,
                updatedAt: now,
                capabilities: RemoteTaskCapabilities(answer: true)
            ))
        ))
        store.apply(RemoteProjectionEnvelope(
            kind: .question,
            taskId: "task-1",
            publishedAt: now,
            payload: .question(MobileQuestionCard(
                id: "question-1",
                taskId: "task-1",
                workspaceId: "ws",
                threadId: "chat-1",
                runId: "run-1",
                provider: "codex",
                prompt: "Continue?"
            ))
        ))

        store.selectTask("task-1")

        XCTAssertEqual(store.selectedTaskDetail?.task.id, "task-1")
        XCTAssertEqual(store.selectedTaskDetail?.questions.first?.id, "question-1")
        XCTAssertEqual(store.selectedTaskDetail?.task.capabilities.answer, true)
    }

    @available(iOS 17.0, macOS 14.0, *)
    func testRemoteTaskConsoleViewComposesListAndDetailStates() {
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
                threadId: "chat-1",
                runId: "run-1",
                provider: "codex",
                status: .awaitingApproval,
                attentionReason: "Shell command needs approval",
                updatedAt: now,
                capabilities: RemoteTaskCapabilities(approve: true, cancel: true, startTurn: true)
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
                threadId: "chat-1",
                runId: "run-1",
                provider: "codex",
                title: "Run tests",
                summary: "swift test",
                expiresAt: now.addingTimeInterval(300)
            ))
        ))
        let viewModel = RemoteTaskConsoleViewModel(store: store)
        let listView = RemoteTaskConsoleView(viewModel: viewModel)
        store.selectTask("task-1")
        let detailView = RemoteTaskConsoleView(viewModel: viewModel)

        XCTAssertEqual([Any](arrayLiteral: listView, detailView).count, 2)
        XCTAssertEqual(viewModel.selectedTaskDetail?.approvals.first?.id, "approval-1")
    }

    func testRefreshStaleActionStatesMarksExpiredSendingAction() {
        let store = RemoteTaskStore(actionStaleAfter: 10)
        let started = Date(timeIntervalSince1970: 1_800_000_000)
        store.apply(RemoteProjectionEnvelope(
            kind: .task,
            taskId: "task-1",
            publishedAt: started,
            payload: .task(RemoteTaskCard(
                id: "task-1",
                threadId: "chat-1",
                status: .running,
                updatedAt: started
            ))
        ))
        store.markActionSending(taskId: "task-1", kind: .cancelRun, targetId: "run-1", now: started)

        store.refreshStaleActionStates(now: started.addingTimeInterval(11))

        guard case .stale(let kind, let targetId, _, _) = store.actionStatesByTaskId["task-1"] else {
            XCTFail("expected stale action")
            return
        }
        XCTAssertEqual(kind, .cancelRun)
        XCTAssertEqual(targetId, "run-1")
    }

    func testStickyActionFeedbackStoresAcknowledgedFailedAndStaleStates() {
        let store = RemoteTaskStore(actionStaleAfter: 10)
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        store.apply(RemoteProjectionEnvelope(
            kind: .task,
            taskId: "task-1",
            publishedAt: now,
            payload: .task(RemoteTaskCard(
                id: "task-1",
                threadId: "chat-1",
                status: .running,
                updatedAt: now
            ))
        ))

        store.markActionAcknowledged(taskId: "task-1", kind: .prompt, targetId: "chat-1", message: "queued", now: now)
        guard case .acknowledged(let ackKind, let ackTarget, let ackMessage, _) = store.detail(for: "task-1")?.actionState else {
            return XCTFail("expected acknowledged state")
        }
        XCTAssertEqual(ackKind, .prompt)
        XCTAssertEqual(ackTarget, "chat-1")
        XCTAssertEqual(ackMessage, "queued")

        store.markActionFailed(taskId: "task-1", kind: .cancelRun, targetId: "run-1", message: "denied", now: now)
        guard case .failed(let failedKind, let failedTarget, let failedMessage, _) = store.detail(for: "task-1")?.actionState else {
            return XCTFail("expected failed state")
        }
        XCTAssertEqual(failedKind, .cancelRun)
        XCTAssertEqual(failedTarget, "run-1")
        XCTAssertEqual(failedMessage, "denied")

        store.markActionStale(taskId: "task-1", kind: .approve, targetId: "approval-1", message: "expired", now: now)
        guard case .stale(let staleKind, let staleTarget, let staleMessage, _) = store.detail(for: "task-1")?.actionState else {
            return XCTFail("expected stale state")
        }
        XCTAssertEqual(staleKind, .approve)
        XCTAssertEqual(staleTarget, "approval-1")
        XCTAssertEqual(staleMessage, "expired")
    }
}
