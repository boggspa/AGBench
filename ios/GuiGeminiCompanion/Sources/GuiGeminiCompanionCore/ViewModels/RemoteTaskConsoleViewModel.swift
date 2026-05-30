import Foundation
import Observation

@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class RemoteTaskConsoleViewModel {
    public let store: RemoteTaskStore
    public var promptDraft: String = ""
    public var questionAnswerDraft: String = ""
    public private(set) var lastActionMessage: String?

    private let client: GuiGeminiBridgeClient?

    public init(
        client: GuiGeminiBridgeClient? = nil,
        store: RemoteTaskStore = RemoteTaskStore()
    ) {
        self.client = client
        self.store = store
    }

    public var buckets: RemoteTaskBuckets {
        store.buckets
    }

    public var selectedTaskDetail: RemoteTaskDetail? {
        store.selectedTaskDetail
    }

    public func ingest(_ event: BridgeRunEvent) {
        store.ingest(event)
    }

    public func selectTask(_ id: String?) {
        store.selectTask(id)
        promptDraft = ""
        questionAnswerDraft = ""
    }

    public func respond(
        to approval: MobileApprovalCard,
        decision: BridgeActionPayload.ApprovalDecision
    ) async {
        guard let taskId = taskId(for: approval) else { return }
        guard approval.isPending() else {
            store.markActionStale(
                taskId: taskId,
                kind: decision == .decline ? .decline : .approve,
                targetId: approval.id,
                message: "This approval is no longer pending."
            )
            return
        }
        let kind: RemoteTaskActionKind = decision == .decline ? .decline : .approve
        store.markActionSending(taskId: taskId, kind: kind, targetId: approval.id)
        let action = BridgeActionPayload.approvalReply(
            workspaceId: approval.workspaceId ?? "",
            threadId: approval.threadId,
            toolCallId: approval.id,
            decision: decision,
            message: nil
        )
        await send(action: action, taskId: taskId, kind: kind, targetId: approval.id)
    }

    public func answer(_ question: MobileQuestionCard, answer: String) async {
        guard let taskId = taskId(for: question) else { return }
        let trimmed = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            lastActionMessage = "Answer is empty"
            return
        }
        guard question.isPending() else {
            store.markActionStale(
                taskId: taskId,
                kind: .answerQuestion,
                targetId: question.id,
                message: "This question is no longer pending."
            )
            return
        }
        store.markActionSending(taskId: taskId, kind: .answerQuestion, targetId: question.id)
        let action = BridgeActionPayload.questionReply(
            workspaceId: question.workspaceId ?? "",
            threadId: question.threadId,
            promptId: question.id,
            answer: trimmed
        )
        questionAnswerDraft = ""
        await send(action: action, taskId: taskId, kind: .answerQuestion, targetId: question.id)
    }

    public func reject(_ question: MobileQuestionCard) async {
        guard let taskId = taskId(for: question) else { return }
        store.markActionSending(taskId: taskId, kind: .rejectQuestion, targetId: question.id)
        let action = BridgeActionPayload.questionReject(
            workspaceId: question.workspaceId ?? "",
            threadId: question.threadId,
            promptId: question.id,
            message: "Rejected from iPhone"
        )
        await send(action: action, taskId: taskId, kind: .rejectQuestion, targetId: question.id)
    }

    public func cancel(_ task: RemoteTaskCard) async {
        guard let runId = task.runId, !runId.isEmpty else {
            lastActionMessage = "No active run id for this task"
            return
        }
        let provider = task.provider ?? "gemini"
        store.markActionSending(taskId: task.id, kind: .cancelRun, targetId: runId)
        let action = BridgeActionPayload.cancelRun(
            workspaceId: task.workspaceId ?? "",
            threadId: task.threadId,
            provider: provider,
            runId: runId,
            message: "Canceled from iPhone task console"
        )
        await send(action: action, taskId: task.id, kind: .cancelRun, targetId: runId)
    }

    public func sendPrompt(_ task: RemoteTaskCard, text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            lastActionMessage = "Prompt is empty"
            return
        }
        let provider = task.provider ?? "gemini"
        store.markActionSending(taskId: task.id, kind: .prompt, targetId: task.threadId)
        let action = BridgeActionPayload.composerPrompt(
            workspaceId: task.workspaceId ?? "",
            threadId: task.threadId,
            text: trimmed,
            provider: provider,
            approvalMode: nil,
            model: nil,
            contextTurns: 5
        )
        promptDraft = ""
        await send(action: action, taskId: task.id, kind: .prompt, targetId: task.threadId)
    }

    private func send(
        action: BridgeActionPayload,
        taskId: String,
        kind: RemoteTaskActionKind,
        targetId: String
    ) async {
        guard let client else {
            let message = "Bridge is not connected"
            lastActionMessage = message
            store.markActionFailed(taskId: taskId, kind: kind, targetId: targetId, message: message)
            return
        }
        do {
            let ack = try await client.sendAction(action)
            if ack?.accepted == true {
                let message = ack?.message ?? "Action sent"
                lastActionMessage = message
                store.markActionAcknowledged(taskId: taskId, kind: kind, targetId: targetId, message: message)
            } else {
                let message = ack?.message ?? "Desktop rejected the action"
                lastActionMessage = message
                store.markActionFailed(taskId: taskId, kind: kind, targetId: targetId, message: message)
            }
        } catch {
            let message = "Action send failed: \(error.localizedDescription)"
            lastActionMessage = message
            store.markActionFailed(taskId: taskId, kind: kind, targetId: targetId, message: message)
        }
    }

    private func taskId(for approval: MobileApprovalCard) -> String? {
        if let taskId = approval.taskId, store.tasksById[taskId] != nil {
            return taskId
        }
        return store.tasksById.first { _, task in
            task.threadId == approval.threadId && (approval.runId == nil || task.runId == approval.runId)
        }?.key
    }

    private func taskId(for question: MobileQuestionCard) -> String? {
        if let taskId = question.taskId, store.tasksById[taskId] != nil {
            return taskId
        }
        return store.tasksById.first { _, task in
            task.threadId == question.threadId && (question.runId == nil || task.runId == question.runId)
        }?.key
    }
}
