// Domain models — Codable mirrors of the projection/action shapes the Mac
// produces (src/main/RemoteTaskProjection.ts) and consumes
// (src/main/BridgeActionPayload.ts). Decoded from the `params` of inbound app
// messages; encoded into the `params` of outbound `bridge.requestActionAck`.
//
// Forward-compatible by design: the Mac adds fields additively, so these decode
// the subset the UI needs and ignore the rest. `payload` on the envelope stays
// raw JSON so a card kind the app doesn't model yet still round-trips for
// display/debugging.

import Foundation

// ── Projections (Mac → iPhone) ────────────────────────────────────────────────

/// `bridge.broadcastRemoteProjectionSnapshot` params.
public struct RemoteProjectionSnapshot: Codable, Sendable {
    public let projections: [RemoteProjectionEnvelope]
}

/// `bridge.broadcastWorkspaceList` params — the allowlist-visible workspaces.
/// This is the compose surface: a paired phone may start tasks ONLY against
/// workspaces the Mac's iOS Remote Workspace Allowlist exposes.
public struct WorkspaceListMessage: Codable, Sendable {
    public let workspaces: [WorkspaceSummary]
}

/// `bridge.broadcastProviderModels` params — per-provider model catalogs
/// (same source as the desktop picker: live CLI/daemon lists + static
/// fallbacks). Drives the hierarchical provider -> model pickers.
public struct ProviderModelsMessage: Codable, Sendable {
    public let providers: [ProviderModelCatalog]
}

public struct ProviderModelCatalog: Codable, Sendable, Identifiable {
    public let provider: String
    public let models: [ModelOption]
    public var id: String { provider }

    public init(provider: String, models: [ModelOption]) {
        self.provider = provider
        self.models = models
    }
}

public struct ModelOption: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let label: String?
    public let isDefault: Bool?
}

public struct WorkspaceSummary: Codable, Sendable, Identifiable, Hashable {
    public let workspaceId: String
    public let displayName: String
    public let path: String
    public let chatCount: Int?
    public let runningChatCount: Int?
    public var id: String { workspaceId }
}

/// The locked envelope shape: `{schemaVersion:1, source:'mac', kind, payload}`.
/// `payload` is kept as raw JSON and decoded on demand by `kind`.
public struct RemoteProjectionEnvelope: Codable, Sendable {
    public let schemaVersion: Int
    public let source: String
    public let kind: String
    public let envelopeId: String?
    public let workspaceId: String?
    public let threadId: String?
    public let runId: String?
    public let payload: RawJSON

    public func decodePayload<T: Decodable>(_ type: T.Type) -> T? {
        try? JSONDecoder().decode(T.self, from: payload.data)
    }
}

public struct RemoteTaskCard: Codable, Sendable {
    public let id: String
    public let title: String?
    public let status: String?
    public let provider: String?
    public let workspaceId: String?
    public let threadId: String?
    /// Present for sub-threads / isolated side chats — nested under the
    /// parent thread like the desktop sidebar.
    public let parentChatId: String?
    /// ISO8601 — feed the welcome screen's activity heatmap.
    public let createdAt: String?
    public let updatedAt: String?
    public let parentChatRelation: String?
    /// Sidebar pin (desktop parity — drives the Pinned section).
    public let pinned: Bool?
    /// Sub-agent character identity (desktop parity).
    public let agentName: String?
    public let agentAccent: String?
    public let agentSlug: String?
    public let sideChatMode: String?
    public let chatKind: String?
    public let runId: String?
    public let pendingApprovalCount: Int?
    public let pendingQuestionCount: Int?

    public var isEnsemble: Bool { chatKind == "ensemble" }
    public var isGuestSideChat: Bool {
        parentChatRelation == "sideChat" && sideChatMode == "guestParticipant"
    }
    public var isSubThread: Bool {
        parentChatRelation == "subThread" || (parentChatId != nil && parentChatRelation == nil)
    }
    public var isIsolatedSideChat: Bool {
        parentChatRelation == "sideChat" && sideChatMode != "guestParticipant"
    }

    /// Placeholder card for the inline new-chat canvas composer.
    public static func newChatDraft(
        workspaceId: String?, provider: String = "claude"
    ) -> RemoteTaskCard {
        RemoteTaskCard(
            id: "new-chat-draft",
            title: nil,
            status: nil,
            provider: provider,
            workspaceId: workspaceId,
            threadId: nil,
            parentChatId: nil,
            createdAt: nil,
            updatedAt: nil,
            parentChatRelation: nil,
            pinned: nil,
            agentName: nil,
            agentAccent: nil,
            agentSlug: nil,
            sideChatMode: nil,
            chatKind: "single",
            runId: nil,
            pendingApprovalCount: nil,
            pendingQuestionCount: nil)
    }
}

/// Nested `result` inside a successful `bridge.ack` for action requests.
public struct BridgeActionAck: Codable, Sendable {
    public let accepted: Bool?
    public let message: String?
    public let executed: Bool?
    public let reasonCode: String?
    public let threadId: String?
    public let data: BridgeActionAckData?
}

public struct BridgeActionAckData: Codable, Sendable {
    public let threadId: String?
    public let chatKind: String?
    public let rowId: String?
    public let row: RemoteThreadSnapshot.Row?
}

public struct MobileApprovalCard: Codable, Sendable {
    public let toolCallId: String?
    public let title: String?
    public let summary: String?
    public let workspaceId: String?
    public let threadId: String?
    public let runId: String?
}

public struct MobileQuestionCard: Codable, Sendable {
    public let questionId: String?
    public let prompt: String?
    public let options: [String]?
    public let workspaceId: String?
    public let threadId: String?
    public let runId: String?
    public let status: String?
}

/// `ensembleState` projection payload — the live round/participant state
/// the desktop roster chips render from.
public struct RemoteEnsembleState: Codable, Sendable {
    public struct Participant: Codable, Sendable, Identifiable {
        public let participantId: String
        public let provider: String?
        public let role: String?
        public let order: Int?
        public let status: String?
        public var id: String { participantId }
    }
    public let threadId: String?
    public let taskId: String?
    public let status: String?
    public let activeParticipantId: String?
    public let participants: [Participant]?
    /// The CONFIGURED (editable) roster — present even when idle.
    public let roster: [RosterEntry]?

    public struct RosterEntry: Codable, Sendable, Identifiable {
        public let id: String
        public let provider: String
        public let role: String?
        public let enabled: Bool?
        public let order: Int?
        public let model: String?
        public let brief: String?
        public init(
            id: String, provider: String, role: String?, enabled: Bool?,
            order: Int?, model: String?, brief: String?
        ) {
            self.id = id
            self.provider = provider
            self.role = role
            self.enabled = enabled
            self.order = order
            self.model = model
            self.brief = brief
        }
    }
}

/// `diffSummary` projection payload — run file changes for the inspector
/// diff tab + the above-composer changes row.
public struct MobileDiffSummary: Codable, Sendable {
    public struct File: Codable, Sendable, Identifiable {
        public let path: String
        public let status: String?
        public let additions: Int?
        public let deletions: Int?
        public let isBinary: Bool?
        public var id: String { path }
    }
    public let taskId: String?
    public let threadId: String?
    public let runId: String?
    public let filesChanged: Int?
    public let additions: Int?
    public let deletions: Int?
    public let createdFiles: Int?
    public let modifiedFiles: Int?
    public let deletedFiles: Int?
    public let files: [File]?
    public let truncated: Bool?
    /** Per-workspace breakdown (stats-only on the wire). */
    public let workspaces: [WorkspaceBreakdown]?

    public struct WorkspaceBreakdown: Codable, Sendable, Identifiable {
        public let workspacePath: String
        public let filesChanged: Int?
        public let additions: Int?
        public let deletions: Int?
        public var id: String { workspacePath }
    }
}

public struct RemoteThreadSnapshot: Codable, Sendable {
    public struct Row: Codable, Sendable, Identifiable {
        public let id: String
        /// Run that produced this row — lets the live streaming bubble
        /// supersede the in-flight snapshot row without duplication.
        public let runId: String?
        public let role: String?
        public let kind: String?
        /// Ensemble participant identity, mirroring the desktop transcript
        /// tag minus the #pN handle: "Provider / Role (Model)". Absent for
        /// solo chats and user rows.
        public let speaker: String?
        /// Images attached to this message (desktop or phone) — chip count.
        public let imageAttachmentCount: Int?
        /// Bounded one-screen preview of the row body (Mac-side sanitized).
        public let preview: String?
        public let truncated: Bool?
        public struct ToolSummary: Codable, Sendable {
            public let activityCount: Int?
            public let status: String?
            /// Per-tool detail (desktop activity-card parity).
            public let tools: [ToolEntry]?
        }
        public struct ToolEntry: Codable, Sendable, Identifiable {
            public let name: String
            public let category: String?
            public let status: String?
            public let file: String?
            public let additions: Int?
            public let deletions: Int?
            public let detail: String?
            public var id: String { name + (file ?? "") + (detail ?? "") }
            public init(
                name: String, category: String?, status: String?, file: String?,
                additions: Int?, deletions: Int?, detail: String?
            ) {
                self.name = name
                self.category = category
                self.status = status
                self.file = file
                self.additions = additions
                self.deletions = deletions
                self.detail = detail
            }
        }
        public let toolSummary: ToolSummary?
    }
    public struct RunSummary: Codable, Sendable {
        public let runId: String?
        public let provider: String?
        public let model: String?
        public let status: String?
        public let startedAt: String?
        public let endedAt: String?
        public let durationMs: Int?
        public let totalTokens: Int?
        public let tokensIn: Int?
        public let tokensOut: Int?
        public let costText: String?
    }
    public let threadId: String?
    public let taskId: String?
    public let workspaceId: String?
    public let provider: String?
    public let rows: [Row]?
    public let totalRows: Int?
    public let runSummary: RunSummary?
    /// Thread notes (markdown, clipped Mac-side).
    public let notes: String?
    /// Pinned messages — may fall outside the latestN row window.
    public let pinnedRows: [Row]?
    public let hasMoreAbove: Bool?
}

// ── Actions (iPhone → Mac) ────────────────────────────────────────────────────
//
// Encoded as the base64 payload inside `bridge.requestActionAck`. Helpers build
// the routable params dict the runtime/BridgeActionRouter expect:
//   { pairID?, payloadBytes, payloadBase64 }  (pairID is overwritten Mac-side).

public enum BridgeAction {
    /// Approve/deny an approval card.
    public static func approvalReply(
        toolCallId: String, decision: String, workspaceId: String, threadId: String,
        actionId: String = UUID().uuidString
    ) -> [String: Any] {
        encode([
            "kind": "approvalReply", "actionId": actionId, "toolCallId": toolCallId,
            "decision": decision, "workspaceId": workspaceId, "threadId": threadId,
        ])
    }

    /// Answer an agent question.
    public static func questionReply(
        questionId: String, answer: String, workspaceId: String, threadId: String,
        actionId: String = UUID().uuidString
    ) -> [String: Any] {
        encode([
            "kind": "questionReply", "actionId": actionId, "questionId": questionId,
            "answer": answer, "workspaceId": workspaceId, "threadId": threadId,
        ])
    }

    /// Cancel a running agent.
    public static func cancelRun(
        provider: String, runId: String, workspaceId: String, threadId: String,
        message: String? = nil, actionId: String = UUID().uuidString
    ) -> [String: Any] {
        var payload: [String: Any] = [
            "kind": "cancelRun", "actionId": actionId, "provider": provider, "runId": runId,
            "workspaceId": workspaceId, "threadId": threadId,
        ]
        if let message { payload["message"] = message }
        return encode(payload)
    }

    /// Start a new agent run in an allowlisted workspace. A FRESH `threadId`
    /// (e.g. "ios-<uuid>") starts a new chat; an existing one continues it.
    /// The Mac enforces the allowlist (workspace, provider, approval mode)
    /// and the run appears live in the desktop transcript too.
    public static func composerPrompt(
        workspaceId: String, threadId: String, provider: String, text: String,
        approvalMode: String? = nil, model: String? = nil, extraWorkspaceIds: [String]? = nil,
        imageAttachments: [[String: Any]]? = nil,
        actionId: String = UUID().uuidString
    ) -> [String: Any] {
        var payload: [String: Any] = [
            "kind": "composerPrompt", "actionId": actionId, "workspaceId": workspaceId,
            "threadId": threadId, "provider": provider, "text": text,
        ]
        if let approvalMode { payload["approvalMode"] = approvalMode }
        if let model { payload["model"] = model }
        if let extraWorkspaceIds, !extraWorkspaceIds.isEmpty {
            payload["extraWorkspaceIds"] = extraWorkspaceIds
        }
        if let imageAttachments, !imageAttachments.isEmpty {
            payload["imageAttachments"] = imageAttachments
        }
        return encode(payload)
    }

    /// Queue a user turn on an ensemble chat (requires `steer` capability).
    /// Steer the ensemble: starts a round when idle, injects steering when
    /// one is active. This is the correct send primitive for phone prompts —
    /// ensembleQueuePrompt only queues WORK-SESSION continuations and
    /// silently no-ops on an idle panel.
    /// Replace the ensemble's configured roster. Array order is the
    /// speaking order; entries with a known id update in place (the Mac
    /// preserves runtime/permission fields), new entries are minted from
    /// same-provider seeds, omission removes.
    public static func setThreadNotes(
        workspaceId: String, threadId: String, notes: String,
        actionId: String = UUID().uuidString
    ) -> [String: Any] {
        encode([
            "kind": "setThreadNotes", "actionId": actionId,
            "workspaceId": workspaceId, "threadId": threadId, "notes": notes,
        ])
    }

    public static func toggleMessagePin(
        workspaceId: String, threadId: String, messageId: String, pinned: Bool,
        actionId: String = UUID().uuidString
    ) -> [String: Any] {
        encode([
            "kind": "toggleMessagePin", "actionId": actionId,
            "workspaceId": workspaceId, "threadId": threadId,
            "messageId": messageId, "pinned": pinned,
        ])
    }

    public static func ensembleRosterUpdate(
        workspaceId: String, threadId: String, participants: [[String: Any]],
        actionId: String = UUID().uuidString
    ) -> [String: Any] {
        encode([
            "kind": "ensembleRosterUpdate", "actionId": actionId,
            "workspaceId": workspaceId, "threadId": threadId,
            "participants": participants,
        ])
    }

    public static func ensembleSteer(
        workspaceId: String, threadId: String, text: String,
        actionId: String = UUID().uuidString
    ) -> [String: Any] {
        encode([
            "kind": "ensembleSteer", "actionId": actionId,
            "workspaceId": workspaceId, "threadId": threadId, "text": text,
        ])
    }

    public static func ensembleQueuePrompt(
        workspaceId: String, threadId: String, text: String, roundId: String? = nil,
        actionId: String = UUID().uuidString
    ) -> [String: Any] {
        var payload: [String: Any] = [
            "kind": "ensembleQueuePrompt", "actionId": actionId,
            "workspaceId": workspaceId, "threadId": threadId, "text": text,
        ]
        if let roundId { payload["roundId"] = roundId }
        return encode(payload)
    }

    /// Create an empty chat (workspace solo, ensemble, or global) without
    /// starting a run.
    public static func createThread(
        workspaceId: String, variant: String, threadId: String? = nil,
        provider: String? = nil, title: String? = nil,
        participants: [[String: Any]]? = nil,
        actionId: String = UUID().uuidString
    ) -> [String: Any] {
        var payload: [String: Any] = [
            "kind": "createThread", "actionId": actionId,
            "workspaceId": workspaceId, "variant": variant,
        ]
        if let threadId { payload["threadId"] = threadId }
        if let provider { payload["provider"] = provider }
        if let title { payload["title"] = title }
        if let participants, !participants.isEmpty {
            payload["participants"] = participants
        }
        return encode(payload)
    }

    /// Request a bounded transcript window for one thread. Read-only
    /// (capability `monitor`); the snapshot arrives as a single
    /// `bridge.broadcastRemoteProjection` threadSnapshot envelope, the ack
    /// only reports ok/denied.
    /// Fetch a longer preview for one clipped transcript row.
    public static func threadRowExpand(
        workspaceId: String, threadId: String, rowId: String, maxChars: Int = 32000,
        actionId: String = UUID().uuidString
    ) -> [String: Any] {
        encode([
            "kind": "threadRowExpand", "actionId": actionId,
            "workspaceId": workspaceId, "threadId": threadId, "rowId": rowId,
            "maxChars": maxChars,
        ])
    }

    public static func threadSnapshotRequest(
        workspaceId: String, threadId: String, limit: Int = 40,
        actionId: String = UUID().uuidString
    ) -> [String: Any] {
        encode([
            "kind": "threadSnapshotRequest", "actionId": actionId,
            "workspaceId": workspaceId, "threadId": threadId, "limit": limit,
        ])
    }

    /// Wrap a typed action payload as the `bridge.requestActionAck` params.
    private static func encode(_ payload: [String: Any]) -> [String: Any] {
        let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data()
        return ["payloadBase64": data.base64EncodedString(), "payloadBytes": data.count]
    }
}

// ── RawJSON — hold an arbitrary JSON value losslessly inside a Codable type ────

public struct RawJSON: Codable, Sendable {
    /// Canonical JSON bytes of the held value.
    public let data: Data

    public init(data: Data) { self.data = data }

    public init(from decoder: Decoder) throws {
        // Decode into a Foundation JSON value, then re-serialize to bytes. Goes
        // through AnyCodableValue so JSONDecoder (which has no "any JSON" type)
        // can walk arbitrary structure; the bytes are what decodePayload reads.
        let value = try AnyCodableValue(from: decoder)
        data =
            (try? JSONSerialization.data(
                withJSONObject: value.foundationObject, options: [.fragmentsAllowed]))
            ?? Data("null".utf8)
    }

    public func encode(to encoder: Encoder) throws {
        let object = (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]))
        try AnyCodableValue(foundationObject: object as Any).encode(to: encoder)
    }
}

/// Minimal any-JSON Codable bridge used only to ferry RawJSON through
/// JSONDecoder/Encoder (which have no native "arbitrary JSON" type).
enum AnyCodableValue: Codable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([AnyCodableValue])
    case object([String: AnyCodableValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Int.self) { self = .int(v) }
        else if let v = try? c.decode(Double.self) { self = .double(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([AnyCodableValue].self) { self = .array(v) }
        else if let v = try? c.decode([String: AnyCodableValue].self) { self = .object(v) }
        else { self = .null }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .double(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }

    var foundationObject: Any {
        switch self {
        case .null: return NSNull()
        case .bool(let v): return v
        case .int(let v): return v
        case .double(let v): return v
        case .string(let v): return v
        case .array(let v): return v.map { $0.foundationObject }
        case .object(let v): return v.mapValues { $0.foundationObject }
        }
    }

    init(foundationObject: Any) {
        switch foundationObject {
        case is NSNull: self = .null
        case let v as Bool where type(of: foundationObject) == type(of: NSNumber(value: true)):
            self = .bool(v)
        case let v as Int: self = .int(v)
        case let v as Double: self = .double(v)
        case let v as String: self = .string(v)
        case let v as [Any]: self = .array(v.map { AnyCodableValue(foundationObject: $0) })
        case let v as [String: Any]:
            self = .object(v.mapValues { AnyCodableValue(foundationObject: $0) })
        default: self = .null
        }
    }
}
