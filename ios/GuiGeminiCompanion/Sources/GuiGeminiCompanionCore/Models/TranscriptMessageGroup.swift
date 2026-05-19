import Foundation

/// TranscriptMessageGroup — coalesces inbound `BridgeRunEvent` text
/// deltas by `(runId, role)` into one assistant-message bubble that grows
/// as deltas arrive, instead of producing one transcript row per event.
///
/// Design mirrors the CodexBridge `BridgeConversationTurnGroup` shape
/// (one Identifiable struct per turn, with a small `state` field that
/// flips on terminal exit) but is simpler: this slice does not need the
/// `SequentialPresentation` typewriter walker — we render the latest text
/// directly. The grouping rule (one group per `runId × role` until a
/// terminal event arrives) is enough to fix the "one row per delta"
/// regression that ships with the current `TranscriptView`.
///
/// Each group exposes:
///   * `id` — stable, derived from `runId × role × sequenceIndex` so two
///     consecutive assistant runs on the same runId still produce two
///     separate groups (in practice that's rare, but the index ensures
///     `Identifiable` keys never collide).
///   * `runId`, `role`, `provider`
///   * `text` — the coalesced text accumulated so far
///   * `state` — `.streaming` while deltas keep arriving, `.complete`
///     when a terminal `agent-exit` / `gemini-exit` / `agent-error` /
///     `gemini-error` event lands on the same runId
///   * `toolActivities` — separate `[ToolActivityCard]` keyed by `tool_id`
///     so tool-use cards render next to (not inside) the assistant bubble
///   * `startedAt`, `lastUpdatedAt`
///
/// The group is a pure-data struct so `TranscriptStore` can vend
/// arrays of groups with `Equatable` and `Identifiable` semantics that
/// SwiftUI can diff cheaply. Mutation goes through the store so the
/// view reads a stable, fully-sorted array.
public struct TranscriptMessageGroup: Identifiable, Equatable, Sendable {
    public enum Role: String, Sendable, Equatable {
        case user
        case assistant
        case system
        case tool
        case error
    }

    public enum State: Sendable, Equatable {
        case streaming
        case complete
        case failed
    }

    public let id: String
    public let runId: String
    public let role: Role
    /// Provider id mirrored from the originating `BridgeRunEvent.provider`.
    /// Loose-typed so adding a desktop provider doesn't break iOS decode.
    public let provider: String
    public internal(set) var text: String
    public internal(set) var state: State
    public internal(set) var toolActivities: [ToolActivityCard]
    public let startedAt: Date
    public internal(set) var lastUpdatedAt: Date

    public init(
        id: String,
        runId: String,
        role: Role,
        provider: String,
        text: String = "",
        state: State = .streaming,
        toolActivities: [ToolActivityCard] = [],
        startedAt: Date,
        lastUpdatedAt: Date? = nil
    ) {
        self.id = id
        self.runId = runId
        self.role = role
        self.provider = provider
        self.text = text
        self.state = state
        self.toolActivities = toolActivities
        self.startedAt = startedAt
        self.lastUpdatedAt = lastUpdatedAt ?? startedAt
    }

    /// O(1) text append used by `TranscriptStore.appendDelta(...)` when
    /// successive deltas land on the same (runId, role).
    public mutating func appendText(_ delta: String, at timestamp: Date) {
        guard !delta.isEmpty else {
            lastUpdatedAt = timestamp
            return
        }
        text.append(delta)
        lastUpdatedAt = timestamp
    }

    /// Flip from `.streaming` → `.complete` (or `.failed`) on terminal
    /// exit / error events. Idempotent — repeated calls only refresh the
    /// `lastUpdatedAt` cursor; once complete a group never re-opens.
    /// Mirrors `BridgeConversationFeedStore.coerceTerminalStreamingMessages`.
    public mutating func coerceToComplete(failed: Bool = false, at timestamp: Date) {
        guard state == .streaming else {
            lastUpdatedAt = max(lastUpdatedAt, timestamp)
            return
        }
        state = failed ? .failed : .complete
        lastUpdatedAt = timestamp
    }

    /// Upsert a tool activity card by `toolId`. Mutates an existing entry
    /// in place when the id matches so streaming tool status updates flow
    /// into the same card.
    public mutating func upsertToolActivity(_ activity: ToolActivityCard) {
        if let index = toolActivities.firstIndex(where: { $0.toolId == activity.toolId }) {
            toolActivities[index] = activity
        } else {
            toolActivities.append(activity)
        }
        lastUpdatedAt = activity.lastUpdatedAt
    }
}

/// ToolActivityCard — single compact card describing one tool invocation
/// in a transcript group. Multiple deltas on the same `toolId` upsert in
/// place via `TranscriptMessageGroup.upsertToolActivity(_:)`.
public struct ToolActivityCard: Identifiable, Equatable, Sendable {
    public enum Status: String, Sendable, Equatable {
        case pending
        case running
        case success
        case failed
    }

    public let id: String
    public let toolId: String
    public let toolName: String
    public internal(set) var status: Status
    public internal(set) var summary: String?
    public let startedAt: Date
    public internal(set) var lastUpdatedAt: Date

    public init(
        toolId: String,
        toolName: String,
        status: Status = .running,
        summary: String? = nil,
        startedAt: Date,
        lastUpdatedAt: Date? = nil
    ) {
        self.id = toolId
        self.toolId = toolId
        self.toolName = toolName
        self.status = status
        self.summary = summary
        self.startedAt = startedAt
        self.lastUpdatedAt = lastUpdatedAt ?? startedAt
    }
}
