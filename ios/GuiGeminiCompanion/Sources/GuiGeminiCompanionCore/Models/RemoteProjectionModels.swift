import Foundation

public enum RemoteProjectionDecodeError: Error, Equatable, Sendable {
    case malformedJSON(String)
    case missingProjectionKind
    case unknownProjectionKind(String)
    case payloadDecodeFailed(String)
}

public enum RemoteProjectionKind: String, Codable, Sendable, Equatable {
    case task
    case approval
    case question
    case thread
    case diff
    case ensemble

    public init?(wireValue: String?) {
        guard let wireValue else { return nil }
        let normalized = wireValue
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: ".", with: "")
        switch normalized {
        case "task", "taskcard", "remotetaskcard", "remotetask":
            self = .task
        case "approval", "approvalcard", "mobileapprovalcard":
            self = .approval
        case "question", "questioncard", "mobilequestioncard":
            self = .question
        case "thread", "threadsnapshot", "remotethreadsnapshot":
            self = .thread
        case "diff", "diffsummary", "mobilediffsummary":
            self = .diff
        case "ensemble", "ensemblestate", "remoteensembleprojection":
            self = .ensemble
        default:
            return nil
        }
    }
}

public struct RemoteProjectionEnvelope: Sendable, Equatable {
    public enum Payload: Sendable, Equatable {
        case task(RemoteTaskCard)
        case approval(MobileApprovalCard)
        case question(MobileQuestionCard)
        case thread(RemoteThreadSnapshot)
        case diff(MobileDiffSummary)
        case ensemble(RemoteEnsembleProjection)
    }

    public let schemaVersion: Int
    public let kind: RemoteProjectionKind
    public let taskId: String?
    public let workspaceId: String?
    public let threadId: String?
    public let runId: String?
    public let publishedAt: Date?
    public let payload: Payload

    public init(
        schemaVersion: Int = 1,
        kind: RemoteProjectionKind,
        taskId: String? = nil,
        workspaceId: String? = nil,
        threadId: String? = nil,
        runId: String? = nil,
        publishedAt: Date? = nil,
        payload: Payload
    ) {
        self.schemaVersion = schemaVersion
        self.kind = kind
        self.taskId = taskId
        self.workspaceId = workspaceId
        self.threadId = threadId
        self.runId = runId
        self.publishedAt = publishedAt
        self.payload = payload
    }

    public static func decode(event: BridgeRunEvent) throws -> RemoteProjectionEnvelope? {
        guard let object = try? jsonObject(from: event.payloadJSON) else { return nil }
        let explicitKind = projectionKind(in: object)
        let eventIsProjection = event.channel == .remoteProjection
        guard eventIsProjection || explicitKind != nil else { return nil }
        return try decode(
            payloadJSON: event.payloadJSON,
            fallbackPublishedAt: event.publishedAt,
            allowInference: eventIsProjection
        )
    }

    public static func decode(
        payloadJSON: Data,
        fallbackPublishedAt: Date? = nil,
        allowInference: Bool = true
    ) throws -> RemoteProjectionEnvelope {
        let object = try jsonObject(from: payloadJSON)
        let kind: RemoteProjectionKind
        if let explicit = projectionKind(in: object) {
            kind = explicit
        } else if allowInference, let inferred = inferredProjectionKind(in: object) {
            kind = inferred
        } else {
            throw RemoteProjectionDecodeError.missingProjectionKind
        }

        let payloadAny = projectedPayload(in: object, kind: kind)
        let payloadData: Data
        do {
            payloadData = try JSONSerialization.data(withJSONObject: payloadAny, options: [.sortedKeys, .fragmentsAllowed])
        } catch {
            throw RemoteProjectionDecodeError.malformedJSON("payload subtree is not JSON-serializable")
        }

        var taskId = string(in: object, keys: ["taskId", "taskID", "id"])
        var workspaceId = string(in: object, keys: ["workspaceId", "workspaceID", "workspace_id"])
        var threadId = string(in: object, keys: ["threadId", "threadID", "thread_id", "chatId", "appChatId"])
        var runId = string(in: object, keys: ["runId", "runID", "appRunId", "appRunID"])
        let schemaVersion = int(in: object, keys: ["schemaVersion", "schema_version"]) ?? 1
        let publishedAt = date(in: object, keys: ["publishedAt", "generatedAt", "updatedAt"]) ?? fallbackPublishedAt
        let payload: Payload

        do {
            switch kind {
            case .task:
                let card = try jsonDecoder.decode(RemoteTaskCard.self, from: payloadData)
                payload = .task(card)
                taskId = taskId ?? card.id
                workspaceId = workspaceId ?? card.workspaceId
                threadId = threadId ?? card.threadId
                runId = runId ?? card.runId
            case .approval:
                let approval = try jsonDecoder.decode(MobileApprovalCard.self, from: payloadData)
                payload = .approval(approval)
                taskId = taskId ?? approval.taskId
                workspaceId = workspaceId ?? approval.workspaceId
                threadId = threadId ?? approval.threadId
                runId = runId ?? approval.runId
            case .question:
                let question = try jsonDecoder.decode(MobileQuestionCard.self, from: payloadData)
                payload = .question(question)
                taskId = taskId ?? question.taskId
                workspaceId = workspaceId ?? question.workspaceId
                threadId = threadId ?? question.threadId
                runId = runId ?? question.runId
            case .thread:
                let snapshot = try jsonDecoder.decode(RemoteThreadSnapshot.self, from: payloadData)
                payload = .thread(snapshot)
                taskId = taskId ?? snapshot.taskId
                workspaceId = workspaceId ?? snapshot.workspaceId
                threadId = threadId ?? snapshot.threadId
                runId = runId ?? snapshot.runSummary?.runId
            case .diff:
                let diff = try jsonDecoder.decode(MobileDiffSummary.self, from: payloadData)
                payload = .diff(diff)
                taskId = taskId ?? diff.taskId
                workspaceId = workspaceId ?? diff.workspaceId
                threadId = threadId ?? diff.threadId
                runId = runId ?? diff.runId
            case .ensemble:
                let ensemble = try jsonDecoder.decode(RemoteEnsembleProjection.self, from: payloadData)
                payload = .ensemble(ensemble)
                taskId = taskId ?? ensemble.taskId
                workspaceId = workspaceId ?? ensemble.workspaceId
                threadId = threadId ?? ensemble.threadId
                runId = runId ?? ensemble.runId
            }
        } catch {
            throw RemoteProjectionDecodeError.payloadDecodeFailed(error.localizedDescription)
        }

        return RemoteProjectionEnvelope(
            schemaVersion: schemaVersion,
            kind: kind,
            taskId: taskId,
            workspaceId: workspaceId,
            threadId: threadId,
            runId: runId,
            publishedAt: publishedAt,
            payload: payload
        )
    }

    private static func jsonObject(from data: Data) throws -> [String: Any] {
        guard
            let object = try? JSONSerialization.jsonObject(with: data),
            let dict = object as? [String: Any]
        else {
            throw RemoteProjectionDecodeError.malformedJSON("projection JSON is not a top-level object")
        }
        return dict
    }

    private static func projectionKind(in object: [String: Any]) -> RemoteProjectionKind? {
        let raw = string(in: object, keys: [
            "projectionKind", "projection", "payloadKind", "kind", "type", "cardKind"
        ])
        return RemoteProjectionKind(wireValue: raw)
    }

    private static func inferredProjectionKind(in object: [String: Any]) -> RemoteProjectionKind? {
        if object["approvalId"] != nil || object["approvalID"] != nil { return .approval }
        if object["questionId"] != nil || object["questionID"] != nil || object["promptId"] != nil { return .question }
        if object["rows"] != nil && object["totalRows"] != nil { return .thread }
        if object["filesChanged"] != nil || object["files"] != nil || object["hunks"] != nil { return .diff }
        if object["participants"] != nil || object["roundStatus"] != nil || object["activeParticipantId"] != nil { return .ensemble }
        if object["taskId"] != nil || object["pendingApprovalCount"] != nil || object["lastMessage"] != nil { return .task }
        return nil
    }

    private static func projectedPayload(in object: [String: Any], kind: RemoteProjectionKind) -> Any {
        if let payload = object["payload"] { return payload }
        switch kind {
        case .task:
            return object["task"] ?? object["card"] ?? object
        case .approval:
            return object["approval"] ?? object["card"] ?? object
        case .question:
            return object["question"] ?? object["card"] ?? object
        case .thread:
            return object["thread"] ?? object["snapshot"] ?? object
        case .diff:
            return object["diff"] ?? object["summary"] ?? object
        case .ensemble:
            return object["ensemble"] ?? object["state"] ?? object
        }
    }

    private static let jsonDecoder: JSONDecoder = RemoteProjectionJSON.decoder
}

public struct RemoteTaskCapabilities: Codable, Sendable, Equatable {
    public let monitor: Bool
    public let approve: Bool
    public let answer: Bool
    public let steer: Bool
    public let cancel: Bool
    public let startTurn: Bool
    public let diffReview: Bool
    public let cancelRound: Bool
    public let skipActiveParticipant: Bool
    public let wakeNow: Bool
    public let cancelWakeup: Bool
    public let queuePrompt: Bool
    public let queueLimit: Int?

    public static let none = RemoteTaskCapabilities()

    public init(
        monitor: Bool = false,
        approve: Bool = false,
        answer: Bool = false,
        steer: Bool = false,
        cancel: Bool = false,
        startTurn: Bool = false,
        diffReview: Bool = false,
        cancelRound: Bool = false,
        skipActiveParticipant: Bool = false,
        wakeNow: Bool = false,
        cancelWakeup: Bool = false,
        queuePrompt: Bool = false,
        queueLimit: Int? = nil
    ) {
        self.monitor = monitor
        self.approve = approve
        self.answer = answer
        self.steer = steer
        self.cancel = cancel
        self.startTurn = startTurn
        self.diffReview = diffReview
        self.cancelRound = cancelRound
        self.skipActiveParticipant = skipActiveParticipant
        self.wakeNow = wakeNow
        self.cancelWakeup = cancelWakeup
        self.queuePrompt = queuePrompt
        self.queueLimit = queueLimit
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: RemoteProjectionCodingKey.self)
        monitor = container.decodeBool(keys: ["monitor", "canMonitor"]) ?? false
        approve = container.decodeBool(keys: ["approve", "canApprove", "approval"]) ?? false
        answer = container.decodeBool(keys: ["answer", "canAnswer", "question"]) ?? false
        steer = container.decodeBool(keys: ["steer", "canSteer"]) ?? false
        cancel = container.decodeBool(keys: ["cancel", "canCancel"]) ?? false
        startTurn = container.decodeBool(keys: ["startTurn", "canStartTurn", "prompt", "canPrompt"]) ?? false
        diffReview = container.decodeBool(keys: ["diffReview", "canReviewDiff", "reviewDiff"]) ?? false
        cancelRound = container.decodeBool(keys: ["cancelRound", "canCancelRound"]) ?? cancel
        skipActiveParticipant = container.decodeBool(keys: ["skipActiveParticipant", "canSkipActiveParticipant"]) ?? false
        wakeNow = container.decodeBool(keys: ["wakeNow", "canWakeNow"]) ?? false
        cancelWakeup = container.decodeBool(keys: ["cancelWakeup", "canCancelWakeup"]) ?? false
        queuePrompt = container.decodeBool(keys: ["queuePrompt", "canQueuePrompt"]) ?? startTurn
        queueLimit = container.decodeInt(keys: ["queueLimit", "maxQueueDepth", "maxQueuedPrompts"])
    }
}

public enum RemoteTaskStatus: String, Codable, Sendable, Equatable {
    case idle
    case queued
    case running
    case awaitingApproval
    case waiting
    case completed
    case failed
    case cancelled
    case sleeping
    case unknown

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self = Self.normalized(try? container.decode(String.self))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    public static func normalized(_ raw: String?) -> RemoteTaskStatus {
        let normalized = (raw ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: "-", with: "")
        switch normalized {
        case "idle": return .idle
        case "queued", "pending": return .queued
        case "running", "active", "streaming", "inflight": return .running
        case "awaitingapproval", "approval", "blockedapproval": return .awaitingApproval
        case "waiting", "blocked", "needsinput", "question": return .waiting
        case "completed", "complete", "success", "succeeded", "done": return .completed
        case "failed", "failure", "error": return .failed
        case "cancelled", "canceled": return .cancelled
        case "sleeping", "asleep": return .sleeping
        default: return .unknown
        }
    }

    public var isActive: Bool {
        switch self {
        case .queued, .running, .awaitingApproval, .waiting, .sleeping:
            return true
        case .idle, .completed, .failed, .cancelled, .unknown:
            return false
        }
    }
}

public struct RemoteTaskCard: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let workspaceId: String?
    public let workspaceDisplayName: String?
    public let threadId: String
    public let threadTitle: String?
    public let runId: String?
    public let provider: String?
    public let ensembleLabel: String?
    public let status: RemoteTaskStatus
    public let attentionReason: String?
    public let lastMessage: String?
    public let pendingApprovalCount: Int
    public let pendingQuestionCount: Int
    public let updatedAt: Date
    public let capabilities: RemoteTaskCapabilities

    public init(
        id: String,
        workspaceId: String? = nil,
        workspaceDisplayName: String? = nil,
        threadId: String,
        threadTitle: String? = nil,
        runId: String? = nil,
        provider: String? = nil,
        ensembleLabel: String? = nil,
        status: RemoteTaskStatus = .idle,
        attentionReason: String? = nil,
        lastMessage: String? = nil,
        pendingApprovalCount: Int = 0,
        pendingQuestionCount: Int = 0,
        updatedAt: Date = Date(timeIntervalSince1970: 0),
        capabilities: RemoteTaskCapabilities = .none
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.workspaceDisplayName = workspaceDisplayName
        self.threadId = threadId
        self.threadTitle = threadTitle
        self.runId = runId
        self.provider = provider
        self.ensembleLabel = ensembleLabel
        self.status = status
        self.attentionReason = attentionReason
        self.lastMessage = lastMessage
        self.pendingApprovalCount = max(0, pendingApprovalCount)
        self.pendingQuestionCount = max(0, pendingQuestionCount)
        self.updatedAt = updatedAt
        self.capabilities = capabilities
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: RemoteProjectionCodingKey.self)
        let threadId = container.decodeString(keys: ["threadId", "threadID", "chatId", "appChatId"]) ?? ""
        let runId = container.decodeString(keys: ["runId", "runID", "appRunId", "appRunID"])
        let fallbackId = RemoteTaskIdentity.makeTaskId(
            workspaceId: container.decodeString(keys: ["workspaceId", "workspaceID", "workspace_id"]),
            threadId: threadId,
            runId: runId
        )
        id = container.decodeString(keys: ["taskId", "taskID", "id"]) ?? fallbackId
        workspaceId = container.decodeString(keys: ["workspaceId", "workspaceID", "workspace_id"])
        workspaceDisplayName = container.decodeString(keys: ["workspaceDisplayName", "workspaceName", "workspaceTitle"])
        self.threadId = threadId
        threadTitle = container.decodeString(keys: ["threadTitle", "title", "chatTitle"])
        self.runId = runId
        provider = container.decodeString(keys: ["provider", "providerId"])
        ensembleLabel = container.decodeString(keys: ["ensembleLabel", "participantLabel", "actorLabel"])
        status = (try? container.decode(RemoteTaskStatus.self, forKey: "status"))
            ?? (try? container.decode(RemoteTaskStatus.self, forKey: "state"))
            ?? .unknown
        attentionReason = container.decodeString(keys: ["attentionReason", "needsAttentionReason", "attention"])
        lastMessage = container.decodeString(keys: ["lastMessage", "lastMessagePreview", "preview", "summary"])
        pendingApprovalCount = container.decodeInt(keys: ["pendingApprovalCount", "approvalCount", "approvalsQueued"]) ?? 0
        pendingQuestionCount = container.decodeInt(keys: ["pendingQuestionCount", "questionCount", "questionsQueued"]) ?? 0
        updatedAt = container.decodeDate(keys: ["updatedAt", "lastActivityAt", "generatedAt", "publishedAt"])
            ?? Date(timeIntervalSince1970: 0)
        capabilities = (try? container.decode(RemoteTaskCapabilities.self, forKey: "capabilities")) ?? .none
    }

    public var displayTitle: String {
        let title = threadTitle?.trimmingCharacters(in: .whitespacesAndNewlines)
        if title?.isEmpty == false { return title! }
        return threadId.isEmpty ? id : threadId
    }

    public var providerLabel: String {
        if let ensembleLabel, !ensembleLabel.isEmpty { return ensembleLabel }
        if let provider, !provider.isEmpty { return provider }
        return "AGBench"
    }
}

public enum MobileApprovalState: String, Codable, Sendable, Equatable {
    case pending
    case approved
    case declined
    case cancelled
    case expired
    case resolved
    case unknown

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self = Self.normalized(try? container.decode(String.self))
    }

    public static func normalized(_ raw: String?) -> MobileApprovalState {
        let normalized = (raw ?? "pending").lowercased().replacingOccurrences(of: "_", with: "")
        switch normalized {
        case "pending", "open", "requested": return .pending
        case "approved", "accept", "accepted": return .approved
        case "declined", "deny", "denied", "rejected": return .declined
        case "cancelled", "canceled": return .cancelled
        case "expired", "timeout", "timedout": return .expired
        case "resolved", "closed": return .resolved
        default: return .unknown
        }
    }
}

public struct MobileApprovalCard: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let taskId: String?
    public let workspaceId: String?
    public let threadId: String
    public let runId: String?
    public let provider: String?
    public let participantId: String?
    public let actorLabel: String?
    public let actionKind: String?
    public let scope: String?
    public let title: String
    public let summary: String?
    public let body: String?
    public let offeredActions: [String]
    public let expiresAt: Date?
    public let createdAt: Date?
    public let state: MobileApprovalState

    public init(
        id: String,
        taskId: String? = nil,
        workspaceId: String? = nil,
        threadId: String,
        runId: String? = nil,
        provider: String? = nil,
        participantId: String? = nil,
        actorLabel: String? = nil,
        actionKind: String? = nil,
        scope: String? = nil,
        title: String,
        summary: String? = nil,
        body: String? = nil,
        offeredActions: [String] = [],
        expiresAt: Date? = nil,
        createdAt: Date? = nil,
        state: MobileApprovalState = .pending
    ) {
        self.id = id
        self.taskId = taskId
        self.workspaceId = workspaceId
        self.threadId = threadId
        self.runId = runId
        self.provider = provider
        self.participantId = participantId
        self.actorLabel = actorLabel
        self.actionKind = actionKind
        self.scope = scope
        self.title = title
        self.summary = summary
        self.body = body
        self.offeredActions = offeredActions
        self.expiresAt = expiresAt
        self.createdAt = createdAt
        self.state = state
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: RemoteProjectionCodingKey.self)
        id = container.decodeString(keys: ["approvalId", "approvalID", "id", "toolCallId", "callId"]) ?? ""
        taskId = container.decodeString(keys: ["taskId", "taskID"])
        workspaceId = container.decodeString(keys: ["workspaceId", "workspaceID", "workspace_id"])
        threadId = container.decodeString(keys: ["threadId", "threadID", "chatId", "appChatId"]) ?? ""
        runId = container.decodeString(keys: ["runId", "runID", "appRunId", "appRunID"])
        provider = container.decodeString(keys: ["provider", "providerId"])
        participantId = container.decodeString(keys: ["participantId", "participantID", "actorId"])
        actorLabel = container.decodeString(keys: ["actorLabel", "actor", "participantLabel"])
        actionKind = container.decodeString(keys: ["actionKind", "approvalType", "kindName", "toolName"])
        scope = container.decodeString(keys: ["scope"])
        title = container.decodeString(keys: ["title", "summary", "actionKind"]) ?? "Approval requested"
        summary = container.decodeString(keys: ["summary", "subtitle"])
        body = container.decodeString(keys: ["body", "message", "description"])
        offeredActions = container.decodeStringArray(keys: ["offeredActions", "actions", "allowedActions"])
        expiresAt = container.decodeDate(keys: ["expiresAt", "expires_at"])
        createdAt = container.decodeDate(keys: ["createdAt", "requestedAt", "publishedAt"])
        state = (try? container.decode(MobileApprovalState.self, forKey: "state"))
            ?? (try? container.decode(MobileApprovalState.self, forKey: "status"))
            ?? .pending
    }

    public func isPending(now: Date = Date()) -> Bool {
        guard state == .pending || state == .unknown else { return false }
        guard let expiresAt else { return true }
        return expiresAt > now
    }

    public var approvalDecisions: [BridgeActionPayload.ApprovalDecision] {
        let source = offeredActions.isEmpty ? ["accept", "decline"] : offeredActions
        return source.compactMap(BridgeActionPayload.ApprovalDecision.init(rawValue:))
    }
}

public enum MobileQuestionState: String, Codable, Sendable, Equatable {
    case pending
    case answered
    case rejected
    case expired
    case cancelled
    case unknown

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self = Self.normalized(try? container.decode(String.self))
    }

    public static func normalized(_ raw: String?) -> MobileQuestionState {
        let normalized = (raw ?? "pending").lowercased().replacingOccurrences(of: "_", with: "")
        switch normalized {
        case "pending", "open", "requested": return .pending
        case "answered", "accepted", "resolved": return .answered
        case "rejected", "declined", "denied": return .rejected
        case "expired", "timeout", "timedout": return .expired
        case "cancelled", "canceled": return .cancelled
        default: return .unknown
        }
    }
}

public struct RemoteQuestionOption: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let label: String
    public let value: String

    public init(id: String, label: String, value: String? = nil) {
        self.id = id
        self.label = label
        self.value = value ?? id
    }

    public init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(),
           let raw = try? single.decode(String.self) {
            id = raw
            label = raw
            value = raw
            return
        }
        let container = try decoder.container(keyedBy: RemoteProjectionCodingKey.self)
        let decodedLabel = container.decodeString(keys: ["label", "title", "text"]) ?? ""
        let decodedValue = container.decodeString(keys: ["value", "id"]) ?? decodedLabel
        id = container.decodeString(keys: ["id", "value"]) ?? decodedValue
        label = decodedLabel.isEmpty ? decodedValue : decodedLabel
        value = decodedValue
    }
}

public struct MobileQuestionCard: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let taskId: String?
    public let workspaceId: String?
    public let threadId: String
    public let runId: String?
    public let provider: String?
    public let participantId: String?
    public let prompt: String
    public let options: [RemoteQuestionOption]
    public let context: String?
    public let expiresAt: Date?
    public let createdAt: Date?
    public let state: MobileQuestionState

    public init(
        id: String,
        taskId: String? = nil,
        workspaceId: String? = nil,
        threadId: String,
        runId: String? = nil,
        provider: String? = nil,
        participantId: String? = nil,
        prompt: String,
        options: [RemoteQuestionOption] = [],
        context: String? = nil,
        expiresAt: Date? = nil,
        createdAt: Date? = nil,
        state: MobileQuestionState = .pending
    ) {
        self.id = id
        self.taskId = taskId
        self.workspaceId = workspaceId
        self.threadId = threadId
        self.runId = runId
        self.provider = provider
        self.participantId = participantId
        self.prompt = prompt
        self.options = options
        self.context = context
        self.expiresAt = expiresAt
        self.createdAt = createdAt
        self.state = state
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: RemoteProjectionCodingKey.self)
        id = container.decodeString(keys: ["questionId", "questionID", "promptId", "id"]) ?? ""
        taskId = container.decodeString(keys: ["taskId", "taskID"])
        workspaceId = container.decodeString(keys: ["workspaceId", "workspaceID", "workspace_id"])
        threadId = container.decodeString(keys: ["threadId", "threadID", "chatId", "appChatId"]) ?? ""
        runId = container.decodeString(keys: ["runId", "runID", "appRunId", "appRunID"])
        provider = container.decodeString(keys: ["provider", "providerId"])
        participantId = container.decodeString(keys: ["participantId", "participantID", "actorId"])
        prompt = container.decodeString(keys: ["prompt", "question", "title", "message"]) ?? "Question"
        options = (try? container.decode([RemoteQuestionOption].self, forKey: "options")) ?? []
        context = container.decodeString(keys: ["context", "body", "description"])
        expiresAt = container.decodeDate(keys: ["expiresAt", "expires_at"])
        createdAt = container.decodeDate(keys: ["createdAt", "requestedAt", "publishedAt"])
        state = (try? container.decode(MobileQuestionState.self, forKey: "state"))
            ?? (try? container.decode(MobileQuestionState.self, forKey: "status"))
            ?? .pending
    }

    public func isPending(now: Date = Date()) -> Bool {
        guard state == .pending || state == .unknown else { return false }
        guard let expiresAt else { return true }
        return expiresAt > now
    }
}

public enum RemoteProjectionMode: Codable, Sendable, Equatable {
    case latestN(Int)
    case aroundRow(rowId: String, radius: Int)
    case attention
    case summaryOnly
    case unknown(String)

    public init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(),
           let raw = try? single.decode(String.self) {
            self = Self.normalized(kind: raw, n: nil, rowId: nil, radius: nil)
            return
        }
        let container = try decoder.container(keyedBy: RemoteProjectionCodingKey.self)
        let kind = container.decodeString(keys: ["kind", "type", "mode"]) ?? ""
        self = Self.normalized(
            kind: kind,
            n: container.decodeInt(keys: ["n", "count", "limit"]),
            rowId: container.decodeString(keys: ["rowId", "rowID", "id"]),
            radius: container.decodeInt(keys: ["radius"])
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: RemoteProjectionCodingKey.self)
        switch self {
        case .latestN(let n):
            try container.encode("latestN", forKey: "kind")
            try container.encode(n, forKey: "n")
        case .aroundRow(let rowId, let radius):
            try container.encode("aroundRow", forKey: "kind")
            try container.encode(rowId, forKey: "rowId")
            try container.encode(radius, forKey: "radius")
        case .attention:
            try container.encode("attention", forKey: "kind")
        case .summaryOnly:
            try container.encode("summaryOnly", forKey: "kind")
        case .unknown(let raw):
            try container.encode(raw, forKey: "kind")
        }
    }

    private static func normalized(kind: String, n: Int?, rowId: String?, radius: Int?) -> RemoteProjectionMode {
        let normalized = kind.lowercased().replacingOccurrences(of: "_", with: "").replacingOccurrences(of: "-", with: "")
        switch normalized {
        case "latest", "latestn":
            return .latestN(max(0, n ?? 0))
        case "aroundrow", "around":
            return .aroundRow(rowId: rowId ?? "", radius: max(0, radius ?? 0))
        case "attention":
            return .attention
        case "summaryonly", "summary":
            return .summaryOnly
        default:
            return .unknown(kind)
        }
    }
}

public enum RemoteThreadRowKind: String, Codable, Sendable, Equatable {
    case user
    case assistant
    case tool
    case runBoundary
    case system
    case error
    case attention
    case summary
    case unknown

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = (try? container.decode(String.self)) ?? ""
        self = RemoteThreadRowKind(rawValue: raw) ?? .unknown
    }
}

public struct RemoteThreadToolSummary: Codable, Sendable, Equatable {
    public let activityCount: Int
    public let status: String
}

public struct RemoteThreadAttention: Codable, Sendable, Equatable {
    public let kind: String
    public let promptPreview: String
}

public struct RemoteThreadRow: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let runId: String?
    public let role: String
    public let kind: RemoteThreadRowKind
    public let preview: String
    public let truncated: Bool
    public let toolSummary: RemoteThreadToolSummary?
    public let attention: RemoteThreadAttention?
    public let timestamp: Date

    public init(
        id: String,
        runId: String? = nil,
        role: String,
        kind: RemoteThreadRowKind,
        preview: String,
        truncated: Bool = false,
        toolSummary: RemoteThreadToolSummary? = nil,
        attention: RemoteThreadAttention? = nil,
        timestamp: Date
    ) {
        self.id = id
        self.runId = runId
        self.role = role
        self.kind = kind
        self.preview = preview
        self.truncated = truncated
        self.toolSummary = toolSummary
        self.attention = attention
        self.timestamp = timestamp
    }
}

public struct RemoteRunSummary: Codable, Sendable, Equatable {
    public struct FileChanges: Codable, Sendable, Equatable {
        public let filesChanged: Int
        public let additions: Int
        public let deletions: Int
    }

    public let runId: String
    public let provider: String?
    public let model: String?
    public let status: String?
    public let exitCode: Int?
    public let startedAt: Date?
    public let endedAt: Date?
    public let durationMs: Int?
    public let totalTokens: Int?
    public let fileChanges: FileChanges?
}

public struct RemoteThreadSnapshot: Codable, Sendable, Equatable {
    public let taskId: String?
    public let workspaceId: String?
    public let threadId: String
    public let schemaVersion: Int
    public let mode: RemoteProjectionMode
    public let rows: [RemoteThreadRow]
    public let totalRows: Int
    public let windowStartIndex: Int
    public let hasMoreAbove: Bool
    public let hasMoreBelow: Bool
    public let runSummary: RemoteRunSummary?
    public let provider: String?
    public let participantLabels: [String]
    public let queueState: String?
    public let sleepingState: String?
    public let generatedAt: Date

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: RemoteProjectionCodingKey.self)
        taskId = container.decodeString(keys: ["taskId", "taskID"])
        workspaceId = container.decodeString(keys: ["workspaceId", "workspaceID", "workspace_id"])
        threadId = container.decodeString(keys: ["threadId", "threadID", "chatId", "appChatId"]) ?? ""
        schemaVersion = container.decodeInt(keys: ["schemaVersion", "schema_version"]) ?? 1
        mode = (try? container.decode(RemoteProjectionMode.self, forKey: "mode")) ?? .latestN(0)
        rows = (try? container.decode([RemoteThreadRow].self, forKey: "rows")) ?? []
        totalRows = container.decodeInt(keys: ["totalRows", "totalRowCount"]) ?? rows.count
        windowStartIndex = container.decodeInt(keys: ["windowStartIndex", "startIndex"]) ?? 0
        hasMoreAbove = container.decodeBool(keys: ["hasMoreAbove"]) ?? false
        hasMoreBelow = container.decodeBool(keys: ["hasMoreBelow"]) ?? false
        runSummary = try? container.decode(RemoteRunSummary.self, forKey: "runSummary")
        provider = container.decodeString(keys: ["provider", "providerId"])
        participantLabels = container.decodeStringArray(keys: ["participantLabels", "participants"])
        queueState = container.decodeString(keys: ["queueState"])
        sleepingState = container.decodeString(keys: ["sleepingState"])
        generatedAt = container.decodeDate(keys: ["generatedAt", "updatedAt", "publishedAt"]) ?? Date(timeIntervalSince1970: 0)
    }
}

public struct MobileDiffHunk: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let filePath: String?
    public let header: String?
    public let previewLines: [String]
    public let oldStart: Int?
    public let newStart: Int?
    public let truncated: Bool

    public init(
        id: String? = nil,
        filePath: String? = nil,
        header: String? = nil,
        previewLines: [String],
        oldStart: Int? = nil,
        newStart: Int? = nil,
        truncated: Bool = false
    ) {
        self.filePath = filePath
        self.header = header
        self.previewLines = previewLines
        self.oldStart = oldStart
        self.newStart = newStart
        self.truncated = truncated
        self.id = id
            ?? [filePath, header, oldStart.map(String.init), newStart.map(String.init)]
                .compactMap { $0 }
                .joined(separator: ":")
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: RemoteProjectionCodingKey.self)
        filePath = container.decodeString(keys: ["filePath", "path"])
        header = container.decodeString(keys: ["header", "title"])
        previewLines = container.decodeStringArray(keys: ["previewLines", "lines"])
        oldStart = container.decodeInt(keys: ["oldStart"])
        newStart = container.decodeInt(keys: ["newStart"])
        truncated = container.decodeBool(keys: ["truncated", "clamped"]) ?? false
        id = container.decodeString(keys: ["id"])
            ?? [filePath, header, oldStart.map(String.init), newStart.map(String.init)]
                .compactMap { $0 }
                .joined(separator: ":")
    }
}

public struct MobileDiffFile: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let path: String
    public let status: String?
    public let additions: Int
    public let deletions: Int
    public let hunks: [MobileDiffHunk]
    public let truncated: Bool
    public let binary: Bool
    public let sensitive: Bool
    public let sensitiveReason: String?

    public init(
        id: String? = nil,
        path: String,
        status: String? = nil,
        additions: Int = 0,
        deletions: Int = 0,
        hunks: [MobileDiffHunk] = [],
        truncated: Bool = false,
        binary: Bool = false,
        sensitive: Bool = false,
        sensitiveReason: String? = nil
    ) {
        self.path = path
        self.id = id ?? path
        self.status = status
        self.additions = max(0, additions)
        self.deletions = max(0, deletions)
        self.hunks = hunks
        self.truncated = truncated
        self.binary = binary
        self.sensitive = sensitive
        self.sensitiveReason = sensitiveReason
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: RemoteProjectionCodingKey.self)
        path = container.decodeString(keys: ["path", "filePath", "relativePath"]) ?? ""
        id = container.decodeString(keys: ["id"]) ?? path
        status = container.decodeString(keys: ["status", "changeType"])
        additions = container.decodeInt(keys: ["additions", "added"]) ?? 0
        deletions = container.decodeInt(keys: ["deletions", "deleted"]) ?? 0
        hunks = (try? container.decode([MobileDiffHunk].self, forKey: "hunks")) ?? []
        truncated = container.decodeBool(keys: ["truncated", "clamped"]) ?? false
        binary = container.decodeBool(keys: ["binary", "isBinary"]) ?? false
        sensitive = container.decodeBool(keys: ["sensitive", "isSensitive", "redacted"]) ?? false
        sensitiveReason = container.decodeString(keys: ["sensitiveReason", "redactionReason"])
    }
}

public struct MobileDiffSummary: Codable, Sendable, Equatable {
    public let taskId: String?
    public let workspaceId: String?
    public let threadId: String?
    public let runId: String
    public let filesChanged: Int
    public let additions: Int
    public let deletions: Int
    public let files: [MobileDiffFile]
    public let hunks: [MobileDiffHunk]
    public let truncated: Bool
    public let updatedAt: Date?

    public init(
        taskId: String? = nil,
        workspaceId: String? = nil,
        threadId: String? = nil,
        runId: String,
        filesChanged: Int? = nil,
        additions: Int? = nil,
        deletions: Int? = nil,
        files: [MobileDiffFile] = [],
        hunks: [MobileDiffHunk] = [],
        truncated: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.taskId = taskId
        self.workspaceId = workspaceId
        self.threadId = threadId
        self.runId = runId
        self.files = files
        self.hunks = hunks
        self.filesChanged = max(filesChanged ?? files.count, files.count)
        self.additions = additions ?? files.reduce(0) { $0 + $1.additions }
        self.deletions = deletions ?? files.reduce(0) { $0 + $1.deletions }
        self.truncated = truncated || files.contains(where: \.truncated) || hunks.contains(where: \.truncated)
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: RemoteProjectionCodingKey.self)
        taskId = container.decodeString(keys: ["taskId", "taskID"])
        workspaceId = container.decodeString(keys: ["workspaceId", "workspaceID", "workspace_id"])
        threadId = container.decodeString(keys: ["threadId", "threadID", "chatId", "appChatId"])
        runId = container.decodeString(keys: ["runId", "runID", "appRunId", "appRunID"]) ?? ""
        files = (try? container.decode([MobileDiffFile].self, forKey: "files")) ?? []
        hunks = (try? container.decode([MobileDiffHunk].self, forKey: "hunks")) ?? []
        filesChanged = container.decodeInt(keys: ["filesChanged", "fileCount"]) ?? files.count
        additions = container.decodeInt(keys: ["additions", "added"]) ?? files.reduce(0) { $0 + $1.additions }
        deletions = container.decodeInt(keys: ["deletions", "deleted"]) ?? files.reduce(0) { $0 + $1.deletions }
        truncated = container.decodeBool(keys: ["truncated", "clamped"]) ?? files.contains(where: \.truncated) || hunks.contains(where: \.truncated)
        updatedAt = container.decodeDate(keys: ["updatedAt", "generatedAt", "publishedAt"])
    }

    public var binaryFileCount: Int {
        files.filter(\.binary).count
    }

    public var sensitiveFileCount: Int {
        files.filter(\.sensitive).count
    }

    public func clamped(
        maxFiles: Int = 8,
        maxHunksPerFile: Int = 8,
        maxPreviewLinesPerHunk: Int = 80
    ) -> MobileDiffSummary {
        let filesLimit = max(0, maxFiles)
        let hunkLimit = max(0, maxHunksPerFile)
        let lineLimit = max(0, maxPreviewLinesPerHunk)
        let nextFiles = files.prefix(filesLimit).map { file in
            let nextHunks = file.hunks.prefix(hunkLimit).map { hunk in
                let nextLines = Array(hunk.previewLines.prefix(lineLimit))
                let hunkWasClamped = hunk.previewLines.count > nextLines.count
                return MobileDiffHunk(
                    id: hunk.id,
                    filePath: hunk.filePath,
                    header: hunk.header,
                    previewLines: nextLines,
                    oldStart: hunk.oldStart,
                    newStart: hunk.newStart,
                    truncated: hunk.truncated || hunkWasClamped
                )
            }
            return MobileDiffFile(
                id: file.id,
                path: file.path,
                status: file.status,
                additions: file.additions,
                deletions: file.deletions,
                hunks: Array(nextHunks),
                truncated: file.truncated || file.hunks.count > nextHunks.count || nextHunks.contains(where: \.truncated),
                binary: file.binary,
                sensitive: file.sensitive,
                sensitiveReason: file.sensitiveReason
            )
        }
        let topLevelHunks = hunks.prefix(hunkLimit).map { hunk in
            let nextLines = Array(hunk.previewLines.prefix(lineLimit))
            return MobileDiffHunk(
                id: hunk.id,
                filePath: hunk.filePath,
                header: hunk.header,
                previewLines: nextLines,
                oldStart: hunk.oldStart,
                newStart: hunk.newStart,
                truncated: hunk.truncated || hunk.previewLines.count > nextLines.count
            )
        }
        return MobileDiffSummary(
            taskId: taskId,
            workspaceId: workspaceId,
            threadId: threadId,
            runId: runId,
            filesChanged: filesChanged,
            additions: additions,
            deletions: deletions,
            files: Array(nextFiles),
            hunks: Array(topLevelHunks),
            truncated: truncated || files.count > nextFiles.count || hunks.count > topLevelHunks.count,
            updatedAt: updatedAt
        )
    }
}

public struct RemoteEnsembleParticipant: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let provider: String?
    public let role: String?
    public let model: String?
    public let status: String?
    public let isActive: Bool
    public let sleepingUntil: Date?
    public let wakeupId: String?
    public let pendingApprovalCount: Int

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: RemoteProjectionCodingKey.self)
        id = container.decodeString(keys: ["id", "participantId", "participantID"]) ?? ""
        provider = container.decodeString(keys: ["provider", "providerId"])
        role = container.decodeString(keys: ["role", "ensembleRole"])
        model = container.decodeString(keys: ["model", "modelAlias"])
        status = container.decodeString(keys: ["status", "state"])
        isActive = container.decodeBool(keys: ["isActive", "active"]) ?? false
        sleepingUntil = container.decodeDate(keys: ["sleepingUntil", "wakeupAt"])
        wakeupId = container.decodeString(keys: ["wakeupId", "wakeupID", "activeWakeupId", "pendingWakeupId"])
        pendingApprovalCount = container.decodeInt(keys: ["pendingApprovalCount", "approvalCount"]) ?? 0
    }
}

public struct RemoteEnsembleQueuedTurn: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let participantId: String?
    public let label: String
    public let queuedAt: Date?

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: RemoteProjectionCodingKey.self)
        id = container.decodeString(keys: ["id", "turnId", "turnID"]) ?? UUID().uuidString
        participantId = container.decodeString(keys: ["participantId", "participantID"])
        label = container.decodeString(keys: ["label", "summary", "role"]) ?? "Queued turn"
        queuedAt = container.decodeDate(keys: ["queuedAt", "createdAt"])
    }
}

public struct RemoteEnsembleProjection: Codable, Sendable, Equatable {
    public let taskId: String?
    public let workspaceId: String?
    public let threadId: String
    public let runId: String?
    public let roundId: String?
    public let status: String?
    public let roundStatus: String?
    public let activeParticipantId: String?
    public let wakeupId: String?
    public let participants: [RemoteEnsembleParticipant]
    public let queue: [RemoteEnsembleQueuedTurn]
    public let capabilities: RemoteTaskCapabilities
    public let updatedAt: Date?

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: RemoteProjectionCodingKey.self)
        taskId = container.decodeString(keys: ["taskId", "taskID"])
        workspaceId = container.decodeString(keys: ["workspaceId", "workspaceID", "workspace_id"])
        threadId = container.decodeString(keys: ["threadId", "threadID", "chatId", "appChatId"]) ?? ""
        runId = container.decodeString(keys: ["runId", "runID", "appRunId", "appRunID"])
        roundId = container.decodeString(keys: ["roundId", "roundID", "activeRoundId", "activeRoundID"])
        status = container.decodeString(keys: ["status", "state"])
        roundStatus = container.decodeString(keys: ["roundStatus", "orchestrationStatus"])
        activeParticipantId = container.decodeString(keys: ["activeParticipantId", "activeParticipantID"])
        wakeupId = container.decodeString(keys: ["wakeupId", "wakeupID", "activeWakeupId", "pendingWakeupId"])
        participants = (try? container.decode([RemoteEnsembleParticipant].self, forKey: "participants")) ?? []
        queue = (try? container.decode([RemoteEnsembleQueuedTurn].self, forKey: "queue")) ?? []
        capabilities = (try? container.decode(RemoteTaskCapabilities.self, forKey: "capabilities")) ?? .none
        updatedAt = container.decodeDate(keys: ["updatedAt", "generatedAt", "publishedAt"])
    }
}

public typealias RemoteEnsembleState = RemoteEnsembleProjection

enum RemoteTaskIdentity {
    static func makeTaskId(workspaceId: String?, threadId: String, runId: String?) -> String {
        let thread = threadId.trimmingCharacters(in: .whitespacesAndNewlines)
        let run = runId?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let run, !run.isEmpty {
            return thread.isEmpty ? run : "\(thread)#\(run)"
        }
        if !thread.isEmpty { return thread }
        let workspace = workspaceId?.trimmingCharacters(in: .whitespacesAndNewlines)
        return workspace?.isEmpty == false ? workspace! : "remote-task"
    }
}

private enum RemoteProjectionJSON {
    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            if let raw = try? container.decode(String.self),
               let date = parseDate(raw) {
                return date
            }
            if let raw = try? container.decode(Double.self) {
                return Date(timeIntervalSince1970: raw > 10_000_000_000 ? raw / 1000 : raw)
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "invalid date")
        }
        return decoder
    }()

    static func parseDate(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        let primary = ISO8601DateFormatter()
        primary.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = primary.date(from: raw) { return date }
        let fallback = ISO8601DateFormatter()
        fallback.formatOptions = [.withInternetDateTime]
        return fallback.date(from: raw)
    }
}

struct RemoteProjectionCodingKey: CodingKey, ExpressibleByStringLiteral {
    let stringValue: String
    let intValue: Int?

    init(stringLiteral value: String) {
        self.stringValue = value
        self.intValue = nil
    }

    init(_ stringValue: String) {
        self.stringValue = stringValue
        self.intValue = nil
    }

    init?(stringValue: String) {
        self.stringValue = stringValue
        self.intValue = nil
    }

    init?(intValue: Int) {
        self.stringValue = String(intValue)
        self.intValue = intValue
    }
}

extension KeyedDecodingContainer where Key == RemoteProjectionCodingKey {
    func decode<T: Decodable>(_ type: T.Type, forKey key: String) throws -> T {
        try decode(type, forKey: RemoteProjectionCodingKey(key))
    }

    func decodeString(keys: [String]) -> String? {
        for key in keys {
            let codingKey = RemoteProjectionCodingKey(key)
            if let value = try? decode(String.self, forKey: codingKey) {
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { return trimmed }
            }
            if let value = try? decode(Int.self, forKey: codingKey) {
                return String(value)
            }
            if let value = try? decode(Double.self, forKey: codingKey) {
                return String(value)
            }
        }
        return nil
    }

    func decodeInt(keys: [String]) -> Int? {
        for key in keys {
            let codingKey = RemoteProjectionCodingKey(key)
            if let value = try? decode(Int.self, forKey: codingKey) { return value }
            if let value = try? decode(Double.self, forKey: codingKey) { return Int(value) }
            if let value = try? decode(String.self, forKey: codingKey),
               let int = Int(value.trimmingCharacters(in: .whitespacesAndNewlines)) {
                return int
            }
        }
        return nil
    }

    func decodeBool(keys: [String]) -> Bool? {
        for key in keys {
            let codingKey = RemoteProjectionCodingKey(key)
            if let value = try? decode(Bool.self, forKey: codingKey) { return value }
            if let value = try? decode(String.self, forKey: codingKey) {
                let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                if ["true", "yes", "1"].contains(normalized) { return true }
                if ["false", "no", "0"].contains(normalized) { return false }
            }
            if let value = try? decode(Int.self, forKey: codingKey) {
                return value != 0
            }
        }
        return nil
    }

    func decodeDate(keys: [String]) -> Date? {
        for key in keys {
            let codingKey = RemoteProjectionCodingKey(key)
            if let value = try? decode(Date.self, forKey: codingKey) { return value }
            if let value = try? decode(String.self, forKey: codingKey),
               let date = RemoteProjectionJSON.parseDate(value) {
                return date
            }
            if let value = try? decode(Double.self, forKey: codingKey) {
                return Date(timeIntervalSince1970: value > 10_000_000_000 ? value / 1000 : value)
            }
            if let value = try? decode(Int.self, forKey: codingKey) {
                let double = Double(value)
                return Date(timeIntervalSince1970: double > 10_000_000_000 ? double / 1000 : double)
            }
        }
        return nil
    }

    func decodeStringArray(keys: [String]) -> [String] {
        for key in keys {
            let codingKey = RemoteProjectionCodingKey(key)
            if let values = try? decode([String].self, forKey: codingKey) {
                return values.filter { !$0.isEmpty }
            }
            if let value = try? decode(String.self, forKey: codingKey), !value.isEmpty {
                return [value]
            }
        }
        return []
    }
}

private func string(in object: [String: Any], keys: [String]) -> String? {
    for key in keys {
        if let value = object[key] as? String {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }
        if let value = object[key] as? CustomStringConvertible {
            let text = value.description.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { return text }
        }
    }
    return nil
}

private func int(in object: [String: Any], keys: [String]) -> Int? {
    for key in keys {
        if let value = object[key] as? Int { return value }
        if let value = object[key] as? NSNumber { return value.intValue }
        if let value = object[key] as? String, let int = Int(value) { return int }
    }
    return nil
}

private func date(in object: [String: Any], keys: [String]) -> Date? {
    for key in keys {
        if let value = object[key] as? Date { return value }
        if let value = object[key] as? String,
           let date = RemoteProjectionJSON.parseDate(value) {
            return date
        }
        if let value = object[key] as? NSNumber {
            let double = value.doubleValue
            return Date(timeIntervalSince1970: double > 10_000_000_000 ? double / 1000 : double)
        }
    }
    return nil
}
