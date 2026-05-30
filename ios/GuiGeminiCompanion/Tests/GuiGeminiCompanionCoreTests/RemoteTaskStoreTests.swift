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
}
