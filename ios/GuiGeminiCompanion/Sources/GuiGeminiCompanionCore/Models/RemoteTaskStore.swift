import Foundation
import Observation

public enum RemoteTaskActionKind: String, Sendable, Equatable {
    case approve
    case decline
    case answerQuestion
    case rejectQuestion
    case cancelRun
    case prompt
    case ensembleCancelRound
    case ensembleSkipActiveParticipant
    case ensembleWakeNow
    case ensembleCancelWakeup
    case ensembleQueuePrompt
    case ensembleSteer
}

public enum RemoteTaskActionState: Sendable, Equatable {
    case sending(kind: RemoteTaskActionKind, targetId: String, startedAt: Date)
    case acknowledged(kind: RemoteTaskActionKind, targetId: String, message: String, at: Date)
    case failed(kind: RemoteTaskActionKind, targetId: String, message: String, at: Date)
    case stale(kind: RemoteTaskActionKind, targetId: String, message: String, at: Date)

    public var targetId: String {
        switch self {
        case .sending(_, let targetId, _),
             .acknowledged(_, let targetId, _, _),
             .failed(_, let targetId, _, _),
             .stale(_, let targetId, _, _):
            return targetId
        }
    }

    public var message: String? {
        switch self {
        case .sending:
            return nil
        case .acknowledged(_, _, let message, _),
             .failed(_, _, let message, _),
             .stale(_, _, let message, _):
            return message
        }
    }
}

public struct RemoteTaskDetail: Identifiable, Sendable, Equatable {
    public let id: String
    public let task: RemoteTaskCard
    public let approvals: [MobileApprovalCard]
    public let questions: [MobileQuestionCard]
    public let threadSnapshot: RemoteThreadSnapshot?
    public let diffSummary: MobileDiffSummary?
    public let ensemble: RemoteEnsembleProjection?
    public let actionState: RemoteTaskActionState?

    public init(
        task: RemoteTaskCard,
        approvals: [MobileApprovalCard],
        questions: [MobileQuestionCard],
        threadSnapshot: RemoteThreadSnapshot?,
        diffSummary: MobileDiffSummary?,
        ensemble: RemoteEnsembleProjection?,
        actionState: RemoteTaskActionState?
    ) {
        self.id = task.id
        self.task = task
        self.approvals = approvals
        self.questions = questions
        self.threadSnapshot = threadSnapshot
        self.diffSummary = diffSummary
        self.ensemble = ensemble
        self.actionState = actionState
    }
}

public struct RemoteTaskBuckets: Sendable, Equatable {
    public let needsAttention: [RemoteTaskCard]
    public let active: [RemoteTaskCard]
    public let recent: [RemoteTaskCard]
}

@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class RemoteTaskStore {
    public private(set) var tasksById: [String: RemoteTaskCard] = [:]
    public private(set) var approvalsByTaskId: [String: [MobileApprovalCard]] = [:]
    public private(set) var questionsByTaskId: [String: [MobileQuestionCard]] = [:]
    public private(set) var threadSnapshotsByTaskId: [String: RemoteThreadSnapshot] = [:]
    public private(set) var diffSummariesByTaskId: [String: MobileDiffSummary] = [:]
    public private(set) var ensembleByTaskId: [String: RemoteEnsembleProjection] = [:]
    public private(set) var actionStatesByTaskId: [String: RemoteTaskActionState] = [:]
    public var selectedTaskId: String?

    public let actionStaleAfter: TimeInterval

    public init(actionStaleAfter: TimeInterval = 45) {
        self.actionStaleAfter = actionStaleAfter
    }

    public var buckets: RemoteTaskBuckets {
        let sorted = tasksById.values.sorted { lhs, rhs in
            if lhs.updatedAt == rhs.updatedAt {
                return lhs.id < rhs.id
            }
            return lhs.updatedAt > rhs.updatedAt
        }
        var attention: [RemoteTaskCard] = []
        var active: [RemoteTaskCard] = []
        var recent: [RemoteTaskCard] = []
        for task in sorted {
            if taskNeedsAttention(task) {
                attention.append(task)
            } else if task.status.isActive {
                active.append(task)
            } else {
                recent.append(task)
            }
        }
        return RemoteTaskBuckets(needsAttention: attention, active: active, recent: recent)
    }

    public var selectedTaskDetail: RemoteTaskDetail? {
        guard let selectedTaskId,
              let task = tasksById[selectedTaskId]
        else { return nil }
        return detail(for: task.id)
    }

    public func selectTask(_ id: String?) {
        selectedTaskId = id
    }

    public func clear() {
        tasksById.removeAll()
        approvalsByTaskId.removeAll()
        questionsByTaskId.removeAll()
        threadSnapshotsByTaskId.removeAll()
        diffSummariesByTaskId.removeAll()
        ensembleByTaskId.removeAll()
        actionStatesByTaskId.removeAll()
        selectedTaskId = nil
    }

    public func ingest(_ event: BridgeRunEvent) {
        guard let envelope = try? RemoteProjectionEnvelope.decode(event: event) else { return }
        apply(envelope)
    }

    public func ingest(_ events: [BridgeRunEvent]) {
        for event in events {
            ingest(event)
        }
    }

    public func apply(_ envelope: RemoteProjectionEnvelope) {
        switch envelope.payload {
        case .task(let task):
            tasksById[task.id] = mergedTask(existing: tasksById[task.id], incoming: task)
        case .approval(let approval):
            applyApproval(approval, envelope: envelope)
        case .question(let question):
            applyQuestion(question, envelope: envelope)
        case .thread(let snapshot):
            let id = taskId(envelope: envelope, threadId: snapshot.threadId, runId: snapshot.runSummary?.runId)
            threadSnapshotsByTaskId[id] = snapshot
            ensureTask(
                id: id,
                workspaceId: envelope.workspaceId ?? snapshot.workspaceId,
                threadId: snapshot.threadId,
                runId: envelope.runId ?? snapshot.runSummary?.runId,
                provider: snapshot.provider ?? snapshot.runSummary?.provider,
                status: RemoteTaskStatus.normalized(snapshot.runSummary?.status),
                lastMessage: snapshot.rows.last?.preview,
                updatedAt: envelope.publishedAt ?? snapshot.generatedAt,
                capabilities: .none
            )
        case .diff(let diff):
            let id = taskId(envelope: envelope, threadId: diff.threadId, runId: diff.runId)
            diffSummariesByTaskId[id] = diff
            ensureTask(
                id: id,
                workspaceId: envelope.workspaceId ?? diff.workspaceId,
                threadId: diff.threadId ?? envelope.threadId ?? "",
                runId: diff.runId,
                provider: nil,
                status: .unknown,
                lastMessage: "\(diff.filesChanged) files changed",
                updatedAt: envelope.publishedAt ?? diff.updatedAt ?? Date(),
                capabilities: RemoteTaskCapabilities(diffReview: true)
            )
        case .ensemble(let ensemble):
            let id = taskId(envelope: envelope, threadId: ensemble.threadId, runId: ensemble.runId)
            ensembleByTaskId[id] = ensemble
            ensureTask(
                id: id,
                workspaceId: envelope.workspaceId ?? ensemble.workspaceId,
                threadId: ensemble.threadId,
                runId: ensemble.runId,
                provider: nil,
                ensembleLabel: ensemble.activeParticipantId,
                status: RemoteTaskStatus.normalized(ensemble.status ?? ensemble.roundStatus),
                lastMessage: ensemble.roundStatus,
                updatedAt: envelope.publishedAt ?? ensemble.updatedAt ?? Date(),
                capabilities: ensemble.capabilities
            )
        }
        refreshStaleActionStates(now: envelope.publishedAt ?? Date())
    }

    public func detail(for taskId: String) -> RemoteTaskDetail? {
        guard let task = tasksById[taskId] else { return nil }
        return RemoteTaskDetail(
            task: task,
            approvals: pendingApprovals(for: taskId),
            questions: pendingQuestions(for: taskId),
            threadSnapshot: threadSnapshotsByTaskId[taskId],
            diffSummary: diffSummariesByTaskId[taskId],
            ensemble: ensembleByTaskId[taskId],
            actionState: actionStatesByTaskId[taskId]
        )
    }

    public func detail(threadID: String?) -> RemoteTaskDetail? {
        guard let threadID else { return nil }
        let candidates = tasksById.values
            .filter { $0.threadId == threadID }
            .sorted { lhs, rhs in
                if lhs.updatedAt == rhs.updatedAt {
                    return lhs.id < rhs.id
                }
                return lhs.updatedAt > rhs.updatedAt
            }
        guard let task = candidates.first else { return nil }
        return detail(for: task.id)
    }

    public func pendingApprovalCount(for taskId: String) -> Int {
        pendingApprovals(for: taskId).count
    }

    public func pendingQuestionCount(for taskId: String) -> Int {
        pendingQuestions(for: taskId).count
    }

    public func pendingApprovals(for taskId: String, now: Date = Date()) -> [MobileApprovalCard] {
        (approvalsByTaskId[taskId] ?? [])
            .filter { $0.isPending(now: now) }
            .sorted { lhs, rhs in
                (lhs.expiresAt ?? .distantFuture) < (rhs.expiresAt ?? .distantFuture)
            }
    }

    public func pendingQuestions(for taskId: String, now: Date = Date()) -> [MobileQuestionCard] {
        (questionsByTaskId[taskId] ?? [])
            .filter { $0.isPending(now: now) }
            .sorted { lhs, rhs in
                (lhs.expiresAt ?? .distantFuture) < (rhs.expiresAt ?? .distantFuture)
            }
    }

    public func markActionSending(
        taskId: String,
        kind: RemoteTaskActionKind,
        targetId: String,
        now: Date = Date()
    ) {
        actionStatesByTaskId[taskId] = .sending(kind: kind, targetId: targetId, startedAt: now)
    }

    public func markActionAcknowledged(
        taskId: String,
        kind: RemoteTaskActionKind,
        targetId: String,
        message: String,
        now: Date = Date()
    ) {
        actionStatesByTaskId[taskId] = .acknowledged(kind: kind, targetId: targetId, message: message, at: now)
    }

    public func markActionFailed(
        taskId: String,
        kind: RemoteTaskActionKind,
        targetId: String,
        message: String,
        now: Date = Date()
    ) {
        actionStatesByTaskId[taskId] = .failed(kind: kind, targetId: targetId, message: message, at: now)
    }

    public func markActionStale(
        taskId: String,
        kind: RemoteTaskActionKind,
        targetId: String,
        message: String,
        now: Date = Date()
    ) {
        actionStatesByTaskId[taskId] = .stale(kind: kind, targetId: targetId, message: message, at: now)
    }

    public func refreshStaleActionStates(now: Date = Date()) {
        for (taskId, state) in actionStatesByTaskId {
            guard case .sending(let kind, let targetId, let startedAt) = state else { continue }
            if now.timeIntervalSince(startedAt) > actionStaleAfter {
                actionStatesByTaskId[taskId] = .stale(
                    kind: kind,
                    targetId: targetId,
                    message: "No fresh acknowledgement arrived before this action went stale.",
                    at: now
                )
                continue
            }
            switch kind {
            case .approve, .decline:
                let stillPending = pendingApprovals(for: taskId, now: now).contains { $0.id == targetId }
                if !stillPending {
                    actionStatesByTaskId[taskId] = .stale(
                        kind: kind,
                        targetId: targetId,
                        message: "The approval projection is no longer pending.",
                        at: now
                    )
                }
            case .answerQuestion, .rejectQuestion:
                let stillPending = pendingQuestions(for: taskId, now: now).contains { $0.id == targetId }
                if !stillPending {
                    actionStatesByTaskId[taskId] = .stale(
                        kind: kind,
                        targetId: targetId,
                        message: "The question projection is no longer pending.",
                        at: now
                    )
                }
            case .cancelRun, .prompt,
                 .ensembleCancelRound, .ensembleSkipActiveParticipant,
                 .ensembleWakeNow, .ensembleCancelWakeup,
                 .ensembleQueuePrompt, .ensembleSteer:
                break
            }
        }
    }

    // MARK: - Private

    private func applyApproval(_ approval: MobileApprovalCard, envelope: RemoteProjectionEnvelope) {
        let id = taskId(envelope: envelope, threadId: approval.threadId, runId: approval.runId)
        var approvals = approvalsByTaskId[id] ?? []
        approvals.removeAll { $0.id == approval.id }
        if approval.isPending(now: envelope.publishedAt ?? Date()) {
            approvals.append(approval)
        }
        approvalsByTaskId[id] = approvals
        ensureTask(
            id: id,
            workspaceId: envelope.workspaceId ?? approval.workspaceId,
            threadId: approval.threadId,
            runId: approval.runId,
            provider: approval.provider,
            status: .awaitingApproval,
            attentionReason: approval.title,
            lastMessage: approval.summary ?? approval.body ?? approval.title,
            updatedAt: envelope.publishedAt ?? approval.createdAt ?? Date(),
            capabilities: RemoteTaskCapabilities(approve: true)
        )
    }

    private func applyQuestion(_ question: MobileQuestionCard, envelope: RemoteProjectionEnvelope) {
        let id = taskId(envelope: envelope, threadId: question.threadId, runId: question.runId)
        var questions = questionsByTaskId[id] ?? []
        questions.removeAll { $0.id == question.id }
        if question.isPending(now: envelope.publishedAt ?? Date()) {
            questions.append(question)
        }
        questionsByTaskId[id] = questions
        ensureTask(
            id: id,
            workspaceId: envelope.workspaceId ?? question.workspaceId,
            threadId: question.threadId,
            runId: question.runId,
            provider: question.provider,
            status: .waiting,
            attentionReason: question.prompt,
            lastMessage: question.context ?? question.prompt,
            updatedAt: envelope.publishedAt ?? question.createdAt ?? Date(),
            capabilities: RemoteTaskCapabilities(answer: true)
        )
    }

    private func taskId(envelope: RemoteProjectionEnvelope, threadId: String?, runId: String?) -> String {
        envelope.taskId ?? RemoteTaskIdentity.makeTaskId(
            workspaceId: envelope.workspaceId,
            threadId: threadId ?? envelope.threadId ?? "",
            runId: runId ?? envelope.runId
        )
    }

    private func ensureTask(
        id: String,
        workspaceId: String?,
        threadId: String,
        runId: String?,
        provider: String?,
        ensembleLabel: String? = nil,
        status: RemoteTaskStatus,
        attentionReason: String? = nil,
        lastMessage: String?,
        updatedAt: Date,
        capabilities: RemoteTaskCapabilities
    ) {
        let incoming = RemoteTaskCard(
            id: id,
            workspaceId: workspaceId,
            threadId: threadId,
            runId: runId,
            provider: provider,
            ensembleLabel: ensembleLabel,
            status: status,
            attentionReason: attentionReason,
            lastMessage: lastMessage,
            pendingApprovalCount: pendingApprovalCount(for: id),
            pendingQuestionCount: pendingQuestionCount(for: id),
            updatedAt: updatedAt,
            capabilities: capabilities
        )
        tasksById[id] = mergedTask(existing: tasksById[id], incoming: incoming)
    }

    private func mergedTask(existing: RemoteTaskCard?, incoming: RemoteTaskCard) -> RemoteTaskCard {
        guard let existing else { return incoming }
        let capabilities = RemoteTaskCapabilities(
            monitor: existing.capabilities.monitor || incoming.capabilities.monitor,
            approve: existing.capabilities.approve || incoming.capabilities.approve,
            answer: existing.capabilities.answer || incoming.capabilities.answer,
            steer: existing.capabilities.steer || incoming.capabilities.steer,
            cancel: existing.capabilities.cancel || incoming.capabilities.cancel,
            startTurn: existing.capabilities.startTurn || incoming.capabilities.startTurn,
            diffReview: existing.capabilities.diffReview || incoming.capabilities.diffReview,
            cancelRound: existing.capabilities.cancelRound || incoming.capabilities.cancelRound,
            skipActiveParticipant: existing.capabilities.skipActiveParticipant || incoming.capabilities.skipActiveParticipant,
            wakeNow: existing.capabilities.wakeNow || incoming.capabilities.wakeNow,
            cancelWakeup: existing.capabilities.cancelWakeup || incoming.capabilities.cancelWakeup,
            queuePrompt: existing.capabilities.queuePrompt || incoming.capabilities.queuePrompt,
            queueLimit: incoming.capabilities.queueLimit ?? existing.capabilities.queueLimit
        )
        return RemoteTaskCard(
            id: incoming.id,
            workspaceId: incoming.workspaceId ?? existing.workspaceId,
            workspaceDisplayName: incoming.workspaceDisplayName ?? existing.workspaceDisplayName,
            threadId: incoming.threadId.isEmpty ? existing.threadId : incoming.threadId,
            threadTitle: incoming.threadTitle ?? existing.threadTitle,
            runId: incoming.runId ?? existing.runId,
            provider: incoming.provider ?? existing.provider,
            ensembleLabel: incoming.ensembleLabel ?? existing.ensembleLabel,
            status: incoming.status == .unknown ? existing.status : incoming.status,
            attentionReason: incoming.attentionReason ?? existing.attentionReason,
            lastMessage: incoming.lastMessage ?? existing.lastMessage,
            pendingApprovalCount: max(incoming.pendingApprovalCount, pendingApprovalCount(for: incoming.id)),
            pendingQuestionCount: max(incoming.pendingQuestionCount, pendingQuestionCount(for: incoming.id)),
            updatedAt: max(incoming.updatedAt, existing.updatedAt),
            capabilities: capabilities
        )
    }

    private func taskNeedsAttention(_ task: RemoteTaskCard) -> Bool {
        if pendingApprovalCount(for: task.id) > 0 || pendingQuestionCount(for: task.id) > 0 {
            return true
        }
        if let reason = task.attentionReason?.trimmingCharacters(in: .whitespacesAndNewlines), !reason.isEmpty {
            return true
        }
        return task.status == .awaitingApproval || task.status == .waiting
    }
}
