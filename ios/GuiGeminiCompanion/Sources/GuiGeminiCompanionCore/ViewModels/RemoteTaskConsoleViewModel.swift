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

    public func ensembleCancelRound(_ ensemble: RemoteEnsembleProjection) async {
        let taskId = taskId(for: ensemble)
        let targetId = ensemble.roundId ?? ensemble.runId ?? ensemble.threadId
        guard ensemble.capabilities.cancelRound else {
            markUnavailable(taskId: taskId, kind: .ensembleCancelRound, targetId: targetId, message: "Cancel round is unavailable for this Ensemble.")
            return
        }
        store.markActionSending(taskId: taskId, kind: .ensembleCancelRound, targetId: targetId)
        let action = BridgeActionPayload.ensembleCancelRound(
            workspaceId: workspaceId(for: ensemble, taskId: taskId),
            threadId: ensemble.threadId,
            roundId: ensemble.roundId,
            message: "cancelled from iPad"
        )
        await send(action: action, taskId: taskId, kind: .ensembleCancelRound, targetId: targetId)
    }

    public func ensembleSkipActiveParticipant(_ ensemble: RemoteEnsembleProjection) async {
        let taskId = taskId(for: ensemble)
        let participantId = ensemble.activeParticipantId
        let targetId = participantId ?? ensemble.roundId ?? ensemble.threadId
        guard ensemble.capabilities.skipActiveParticipant else {
            markUnavailable(taskId: taskId, kind: .ensembleSkipActiveParticipant, targetId: targetId, message: "Skip active participant is unavailable for this Ensemble.")
            return
        }
        store.markActionSending(taskId: taskId, kind: .ensembleSkipActiveParticipant, targetId: targetId)
        let action = BridgeActionPayload.ensembleSkipActiveParticipant(
            workspaceId: workspaceId(for: ensemble, taskId: taskId),
            threadId: ensemble.threadId,
            roundId: ensemble.roundId,
            participantId: participantId,
            message: "skipped from iPad"
        )
        await send(action: action, taskId: taskId, kind: .ensembleSkipActiveParticipant, targetId: targetId)
    }

    public func ensembleWakeNow(_ ensemble: RemoteEnsembleProjection) async {
        let taskId = taskId(for: ensemble)
        let targetId = wakeupId(for: ensemble) ?? ensemble.activeParticipantId ?? ensemble.threadId
        guard ensemble.capabilities.wakeNow else {
            markUnavailable(taskId: taskId, kind: .ensembleWakeNow, targetId: targetId, message: "Wake now is unavailable for this Ensemble.")
            return
        }
        guard let wakeupId = wakeupId(for: ensemble) else {
            markUnavailable(taskId: taskId, kind: .ensembleWakeNow, targetId: targetId, message: "No pending wakeup id is available for this Ensemble.")
            return
        }
        store.markActionSending(taskId: taskId, kind: .ensembleWakeNow, targetId: wakeupId)
        let action = BridgeActionPayload.ensembleWakeNow(
            workspaceId: workspaceId(for: ensemble, taskId: taskId),
            threadId: ensemble.threadId,
            wakeupId: wakeupId,
            message: "woken from iPad"
        )
        await send(action: action, taskId: taskId, kind: .ensembleWakeNow, targetId: wakeupId)
    }

    public func ensembleCancelWakeup(_ ensemble: RemoteEnsembleProjection) async {
        let taskId = taskId(for: ensemble)
        let targetId = wakeupId(for: ensemble) ?? ensemble.activeParticipantId ?? ensemble.threadId
        guard ensemble.capabilities.cancelWakeup else {
            markUnavailable(taskId: taskId, kind: .ensembleCancelWakeup, targetId: targetId, message: "Cancel wakeup is unavailable for this Ensemble.")
            return
        }
        guard let wakeupId = wakeupId(for: ensemble) else {
            markUnavailable(taskId: taskId, kind: .ensembleCancelWakeup, targetId: targetId, message: "No pending wakeup id is available for this Ensemble.")
            return
        }
        store.markActionSending(taskId: taskId, kind: .ensembleCancelWakeup, targetId: wakeupId)
        let action = BridgeActionPayload.ensembleCancelWakeup(
            workspaceId: workspaceId(for: ensemble, taskId: taskId),
            threadId: ensemble.threadId,
            wakeupId: wakeupId,
            message: "cancelled from iPad"
        )
        await send(action: action, taskId: taskId, kind: .ensembleCancelWakeup, targetId: wakeupId)
    }

    public func ensembleQueuePrompt(_ ensemble: RemoteEnsembleProjection, text: String) async {
        let taskId = taskId(for: ensemble)
        let targetId = ensemble.roundId ?? ensemble.threadId
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard ensemble.capabilities.queuePrompt else {
            markUnavailable(taskId: taskId, kind: .ensembleQueuePrompt, targetId: targetId, message: "Queue prompt is unavailable for this Ensemble.")
            return
        }
        guard !trimmed.isEmpty else {
            lastActionMessage = "Prompt is empty"
            return
        }
        if let limit = ensemble.capabilities.queueLimit, ensemble.queue.count >= limit {
            markUnavailable(taskId: taskId, kind: .ensembleQueuePrompt, targetId: targetId, message: "The Ensemble queue is full.")
            return
        }
        store.markActionSending(taskId: taskId, kind: .ensembleQueuePrompt, targetId: targetId)
        let action = BridgeActionPayload.ensembleQueuePrompt(
            workspaceId: workspaceId(for: ensemble, taskId: taskId),
            threadId: ensemble.threadId,
            roundId: ensemble.roundId,
            text: trimmed,
            message: "queued from iPad"
        )
        await send(action: action, taskId: taskId, kind: .ensembleQueuePrompt, targetId: targetId)
    }

    public func ensembleSteer(_ ensemble: RemoteEnsembleProjection, text: String) async {
        let taskId = taskId(for: ensemble)
        let targetId = ensemble.roundId ?? ensemble.threadId
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard ensemble.capabilities.steer else {
            markUnavailable(taskId: taskId, kind: .ensembleSteer, targetId: targetId, message: "Steer is unavailable for this Ensemble.")
            return
        }
        guard !trimmed.isEmpty else {
            lastActionMessage = "Steer text is empty"
            return
        }
        store.markActionSending(taskId: taskId, kind: .ensembleSteer, targetId: targetId)
        let action = BridgeActionPayload.ensembleSteer(
            workspaceId: workspaceId(for: ensemble, taskId: taskId),
            threadId: ensemble.threadId,
            roundId: ensemble.roundId,
            text: trimmed,
            message: "steered from iPad"
        )
        await send(action: action, taskId: taskId, kind: .ensembleSteer, targetId: targetId)
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

    private func taskId(for ensemble: RemoteEnsembleProjection) -> String {
        if let taskId = ensemble.taskId, store.tasksById[taskId] != nil {
            return taskId
        }
        if let matching = store.tasksById.first(where: { _, task in
            task.threadId == ensemble.threadId && (ensemble.runId == nil || task.runId == ensemble.runId)
        })?.key {
            return matching
        }
        return RemoteTaskIdentity.makeTaskId(
            workspaceId: ensemble.workspaceId,
            threadId: ensemble.threadId,
            runId: ensemble.runId
        )
    }

    private func workspaceId(for ensemble: RemoteEnsembleProjection, taskId: String) -> String {
        ensemble.workspaceId ?? store.tasksById[taskId]?.workspaceId ?? ""
    }

    private func wakeupId(for ensemble: RemoteEnsembleProjection) -> String? {
        if let wakeupId = ensemble.wakeupId, !wakeupId.isEmpty {
            return wakeupId
        }
        if let activeParticipantId = ensemble.activeParticipantId,
           let wakeupId = ensemble.participants.first(where: { $0.id == activeParticipantId })?.wakeupId,
           !wakeupId.isEmpty {
            return wakeupId
        }
        return ensemble.participants.first { participant in
            participant.wakeupId?.isEmpty == false
        }?.wakeupId
    }

    private func markUnavailable(
        taskId: String,
        kind: RemoteTaskActionKind,
        targetId: String,
        message: String
    ) {
        lastActionMessage = message
        store.markActionFailed(taskId: taskId, kind: kind, targetId: targetId, message: message)
    }
}
