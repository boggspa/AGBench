import Foundation

/// BridgeWorkspaceSummaries — payload definitions and a small decoder
/// helper for the four workspace/thread "summary" channels broadcast by
/// the desktop's `BridgeBroadcaster`.
///
/// Wire path: the Mac main process publishes a RunEvent with one of the
/// four `summary-kind` channels (`workspace-list`, `workspace-updated`,
/// `thread-list`, `thread-updated`); the Swift daemon forwards the bytes
/// untouched as a `bridge.runEvent` notification; iOS receives it on
/// `GuiGeminiBridgeClient.runEvents` as a `BridgeRunEvent`. The event's
/// `payloadJSON` blob carries one of the four payloads defined here.
///
/// The shapes are intentionally narrow: only the fields the iPad sidebar
/// currently renders. Future additions on the Mac side stay backwards-
/// compatible because all new fields are additive; unknown fields are
/// ignored by JSONDecoder.

public struct WorkspaceSummaryPayload: Codable, Sendable, Equatable {
    public let workspaceId: String
    public let displayName: String
    public let path: String
    public let chatCount: Int
    public let runningChatCount: Int
    /// ISO8601 wall-clock at which any chat in the workspace last produced
    /// output. nil when the workspace has never been activated this session.
    public let lastActivityAt: Date?
    /// True when the desktop marks this workspace as pinned.
    public let pinned: Bool?

    public init(
        workspaceId: String,
        displayName: String,
        path: String,
        chatCount: Int,
        runningChatCount: Int,
        lastActivityAt: Date? = nil,
        pinned: Bool? = nil
    ) {
        self.workspaceId = workspaceId
        self.displayName = displayName
        self.path = path
        self.chatCount = chatCount
        self.runningChatCount = runningChatCount
        self.lastActivityAt = lastActivityAt
        self.pinned = pinned
    }
}

public struct ThreadSummaryPayload: Codable, Sendable, Equatable {
    public let chatId: String
    public let title: String
    /// nil for "global" chats that don't belong to a workspace (rare;
    /// reserved for future settings/diagnostics chats).
    public let workspaceId: String?
    /// Loose provider id — mirrors the desktop's ProviderId enum but kept
    /// as a string so adding a provider on the Mac doesn't require an iOS
    /// rebuild. UI maps unknown values to a generic icon.
    public let provider: String
    /// One of "idle" | "running" | "failed" | "success". Stringly-typed
    /// for the same forward-compatibility reason as `provider`.
    public let status: String
    /// ISO8601 wall-clock of the last message in the chat. nil when the
    /// chat has been created but no message exchanged yet.
    public let lastMessageAt: Date?
    /// Parent chat id when this thread is a sub-thread spawned via the
    /// desktop's Multi-Provider Sub-Threads feature (`ChatRecord.parentChatId`
    /// in `src/main/store/types.ts`). nil for root chats — the common case.
    public let parentChatId: String?
    /// True when the desktop marks this chat as pinned. nil for chats
    /// where the desktop has not surfaced a pinned flag — defaults to
    /// "not pinned" in the sidebar's pinned section selector.
    public let pinned: Bool?
    /// Currently-running run id for this thread, when desktop has one.
    public let runId: String?
    /// Start timestamp for `runId`. Used by active-run elapsed timers so
    /// message updates do not reset the clock.
    public let runStartedAt: Date?

    public init(
        chatId: String,
        title: String,
        workspaceId: String?,
        provider: String,
        status: String,
        lastMessageAt: Date? = nil,
        parentChatId: String? = nil,
        pinned: Bool? = nil,
        runId: String? = nil,
        runStartedAt: Date? = nil
    ) {
        self.chatId = chatId
        self.title = title
        self.workspaceId = workspaceId
        self.provider = provider
        self.status = status
        self.lastMessageAt = lastMessageAt
        self.parentChatId = parentChatId
        self.pinned = pinned
        self.runId = runId
        self.runStartedAt = runStartedAt
    }
}

// MARK: - Envelope wrappers

public struct WorkspaceListPayload: Codable, Sendable, Equatable {
    public let workspaces: [WorkspaceSummaryPayload]

    public init(workspaces: [WorkspaceSummaryPayload]) {
        self.workspaces = workspaces
    }
}

public struct WorkspaceUpdatedPayload: Codable, Sendable, Equatable {
    public let workspace: WorkspaceSummaryPayload

    public init(workspace: WorkspaceSummaryPayload) {
        self.workspace = workspace
    }
}

public struct ThreadListPayload: Codable, Sendable, Equatable {
    public let threads: [ThreadSummaryPayload]

    public init(threads: [ThreadSummaryPayload]) {
        self.threads = threads
    }
}

public struct ThreadUpdatedPayload: Codable, Sendable, Equatable {
    public let thread: ThreadSummaryPayload

    public init(thread: ThreadSummaryPayload) {
        self.thread = thread
    }
}

// MARK: - Decoder dispatch

/// BridgeWorkspaceSummariesDecoder — single entry point for routing a
/// raw `BridgeRunEvent` to its typed summary payload.
///
/// Usage:
///
///     for await event in client.runEvents {
///         if let decoded = try? BridgeWorkspaceSummariesDecoder.decode(event: event) {
///             switch decoded {
///             case .workspaceList(let p): store.applyWorkspaceList(p.workspaces)
///             case .workspaceUpdated(let p): store.applyWorkspaceUpdate(p.workspace)
///             case .threadList(let p): store.applyThreadList(p.threads)
///             case .threadUpdated(let p): store.applyThreadUpdate(p.thread)
///             }
///         }
///     }
///
/// Returns nil (not throws) when the event's channel isn't one of the
/// four summary kinds — keeps subscriber code one branch instead of two.
public enum BridgeWorkspaceSummariesDecoder {
    public enum Decoded: Sendable, Equatable {
        case workspaceList(WorkspaceListPayload)
        case workspaceUpdated(WorkspaceUpdatedPayload)
        case threadList(ThreadListPayload)
        case threadUpdated(ThreadUpdatedPayload)
    }

    /// Decode a workspace/thread payload from a `BridgeRunEvent`'s
    /// `payloadJSON`. Returns nil if the event's channel isn't one of the
    /// four summary kinds; throws when the channel matches but the
    /// payload bytes don't decode into the expected shape.
    public static func decode(event: BridgeRunEvent) throws -> Decoded? {
        let decoder = Self.jsonDecoder
        switch event.channel {
        case .workspaceList:
            let payload = try decoder.decode(WorkspaceListPayload.self, from: event.payloadJSON)
            return .workspaceList(payload)
        case .workspaceUpdated:
            let payload = try decoder.decode(WorkspaceUpdatedPayload.self, from: event.payloadJSON)
            return .workspaceUpdated(payload)
        case .threadList:
            let payload = try decoder.decode(ThreadListPayload.self, from: event.payloadJSON)
            return .threadList(payload)
        case .threadUpdated:
            let payload = try decoder.decode(ThreadUpdatedPayload.self, from: event.payloadJSON)
            return .threadUpdated(payload)
        case .agentOutput, .agentError, .agentExit,
             .geminiOutput, .geminiError, .geminiExit,
             .remoteProjection:
            return nil
        }
    }

    /// Shared JSON decoder using ISO8601 with fractional seconds when
    /// present, falling back to no-fractional. Matches the BridgeRunEvent
    /// decoder's tolerance so the two paths agree on date formats coming
    /// off the wire.
    private static let jsonDecoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            let primary = ISO8601DateFormatter()
            primary.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = primary.date(from: raw) {
                return date
            }
            let fallback = ISO8601DateFormatter()
            fallback.formatOptions = [.withInternetDateTime]
            if let date = fallback.date(from: raw) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "invalid ISO8601 date: \(raw)"
            )
        }
        return decoder
    }()
}
