import Foundation
import Observation

/// TranscriptStore — pure Swift coalescer that takes the append-only
/// stream of `BridgeRunEvent`s from `GuiGeminiBridgeClient` and produces
/// a stable, sorted `[TranscriptMessageGroup]` ready for UI consumption.
///
/// Grouping rule (mirrors the CodexBridge `BridgeConversationTurnGroup`
/// shape but at the event-record level since iOS doesn't yet have
/// RemoteMessage / RemoteTurn types on this slice):
///
///   * A new group opens when an inbound event carries a `(runId, role)`
///     pair that does NOT match the most recent group's pair.
///   * Successive text deltas with the same `(runId, role)` append to the
///     latest group's `text` in place — O(1) per delta, no array rebuild.
///   * A terminal event (`agent-exit`, `gemini-exit`) flips ALL groups
///     bound to that runId to `.complete` (or `.failed` for error
///     channels). Mirrors `coerceTerminalStreamingMessages`.
///   * Tool activity payloads upsert a `ToolActivityCard` on the latest
///     assistant group sharing the same runId so the UI can render a
///     compact tool-status card next to the streaming text.
///
/// The store is `@MainActor`-isolated so view consumers can subscribe
/// safely. It does not own its own subscription task — `attach(to:)` on
/// `TranscriptViewModel` is the canonical wire-up point. Callers can
/// also push synthetic events via `ingest(_:)` for unit tests.
///
/// Memory: the underlying group array is capped at `maxRetainedGroups`
/// (default 200). Older groups drop off the front when the cap is hit.
/// This matches the existing `TranscriptViewModel.maxRetained` policy.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class TranscriptStore {
    public private(set) var groups: [TranscriptMessageGroup] = []

    public let maxRetainedGroups: Int

    public init(maxRetainedGroups: Int = 200) {
        self.maxRetainedGroups = max(1, maxRetainedGroups)
    }

    /// Wipe all groups — usually wired to a "clear transcript" button on
    /// the view model. Idempotent and cheap.
    public func clear() {
        if !groups.isEmpty {
            groups.removeAll()
        }
    }

    /// Ingest one `BridgeRunEvent` and update the group array. This is
    /// the single mutation entry point — `TranscriptViewModel.append(_:)`
    /// forwards every non-sidebar event here.
    ///
    /// Returns true if the call changed `groups`. The view model uses
    /// this signal to decide whether to forward to the live-activity
    /// reducer; tests use it to assert on no-op behavior.
    @discardableResult
    public func ingest(_ event: BridgeRunEvent) -> Bool {
        let payload = event.payloadDictionary()
        let runId = Self.extractRunId(from: payload) ?? Self.fallbackRunId(for: event)
        let role = Self.extractRole(channel: event.channel, payload: payload)

        switch event.channel {
        case .agentExit, .geminiExit:
            return applyTerminalEvent(runId: runId, failed: false, at: event.publishedAt)
        case .agentError, .geminiError:
            // Error events carry a message text on the same runId — surface
            // them as a dedicated error group AND flip any open assistant
            // groups on the same runId to `.failed` so the UI's
            // "streaming…" badge does not get stuck.
            let errorText = Self.extractText(from: payload) ?? "Provider error"
            let appended = appendDelta(
                runId: runId,
                role: .error,
                provider: event.provider,
                delta: errorText,
                at: event.publishedAt
            )
            let coerced = applyTerminalEvent(runId: runId, failed: true, at: event.publishedAt)
            return appended || coerced
        case .agentOutput, .geminiOutput:
            return ingestOutputEvent(
                runId: runId,
                role: role,
                provider: event.provider,
                payload: payload,
                at: event.publishedAt
            )
        case .workspaceList, .workspaceUpdated, .threadList, .threadUpdated:
            // Summary channels are sidebar data; never enter the transcript.
            // Mirrors the filter in `TranscriptViewModel.append(_:)` so
            // callers can pass any event without pre-filtering.
            return false
        }
    }

    // MARK: - Output event routing

    private func ingestOutputEvent(
        runId: String,
        role: TranscriptMessageGroup.Role,
        provider: String,
        payload: [String: Any]?,
        at timestamp: Date
    ) -> Bool {
        // Tool-use payload: upsert a ToolActivityCard on the latest
        // assistant group bound to the same runId. If no assistant group
        // exists yet we create a placeholder so the card has a host.
        if let tool = Self.extractToolActivity(payload: payload, at: timestamp) {
            return applyToolActivity(
                runId: runId,
                provider: provider,
                tool: tool,
                at: timestamp
            )
        }
        // Plain text delta: append to (or open) the latest group on the
        // matching (runId, role) pair. Empty deltas still touch
        // `lastUpdatedAt` so callers can rely on the timestamp ratcheting.
        let text = Self.extractText(from: payload) ?? ""
        return appendDelta(
            runId: runId,
            role: role,
            provider: provider,
            delta: text,
            at: timestamp
        )
    }

    /// Append a text delta to the latest group matching `(runId, role)`.
    /// Opens a new group when the latest group doesn't match.
    @discardableResult
    func appendDelta(
        runId: String,
        role: TranscriptMessageGroup.Role,
        provider: String,
        delta: String,
        at timestamp: Date
    ) -> Bool {
        // Most-recent-first lookup: the streaming case is "this delta
        // appends to the most recent group", so scanning from the tail
        // hits in O(1) for the common path.
        if let lastIndex = groups.lastIndex(where: { $0.runId == runId && $0.role == role }),
           groups[lastIndex].state == .streaming {
            groups[lastIndex].appendText(delta, at: timestamp)
            return true
        }
        // No open group → open one. Even an empty-text delta opens a
        // group so downstream activity (tool cards, exit events) has a
        // host to attach to.
        let newGroup = TranscriptMessageGroup(
            id: Self.generateGroupId(runId: runId, role: role, ordinal: groups.count + 1),
            runId: runId,
            role: role,
            provider: provider,
            text: delta,
            state: .streaming,
            startedAt: timestamp,
            lastUpdatedAt: timestamp
        )
        groups.append(newGroup)
        enforceRetentionCap()
        return true
    }

    /// Flip every group sharing `runId` to `.complete` (or `.failed`).
    /// Returns true if any group's state changed.
    @discardableResult
    func applyTerminalEvent(runId: String, failed: Bool, at timestamp: Date) -> Bool {
        var changed = false
        for index in groups.indices where groups[index].runId == runId && groups[index].state == .streaming {
            groups[index].coerceToComplete(failed: failed, at: timestamp)
            changed = true
        }
        return changed
    }

    /// Upsert a tool activity card on the latest assistant group bound to
    /// the same `runId`. Opens a placeholder assistant group if none
    /// exists yet so the card has a place to render. Returns true if any
    /// data changed.
    @discardableResult
    func applyToolActivity(
        runId: String,
        provider: String,
        tool: ToolActivityCard,
        at timestamp: Date
    ) -> Bool {
        if let index = groups.lastIndex(where: { $0.runId == runId && $0.role == .assistant }) {
            // Skip the no-op write so SwiftUI doesn't re-render when a
            // duplicate tool delta arrives unchanged.
            if let existing = groups[index].toolActivities.first(where: { $0.toolId == tool.toolId }),
               existing == tool {
                return false
            }
            groups[index].upsertToolActivity(tool)
            return true
        }
        // Open a placeholder assistant group so the card has a host. The
        // surrounding bubble renders empty until a text delta arrives.
        var placeholder = TranscriptMessageGroup(
            id: Self.generateGroupId(runId: runId, role: .assistant, ordinal: groups.count + 1),
            runId: runId,
            role: .assistant,
            provider: provider,
            text: "",
            state: .streaming,
            startedAt: timestamp,
            lastUpdatedAt: timestamp
        )
        placeholder.upsertToolActivity(tool)
        groups.append(placeholder)
        enforceRetentionCap()
        return true
    }

    private func enforceRetentionCap() {
        if groups.count > maxRetainedGroups {
            groups.removeFirst(groups.count - maxRetainedGroups)
        }
    }

    // MARK: - Static extraction helpers

    /// Pull the assistant/user/system role hint from the event channel +
    /// payload. Conservative defaults: agent/gemini output without an
    /// explicit role field is treated as `.assistant` (the common case).
    static func extractRole(
        channel: BridgeRunEvent.Channel,
        payload: [String: Any]?
    ) -> TranscriptMessageGroup.Role {
        if let explicit = (payload?["role"] as? String)?.lowercased(),
           let role = TranscriptMessageGroup.Role(rawValue: explicit) {
            return role
        }
        // Some desktop payloads use `kind` / `type` to hint at the
        // semantic class — map the common ones explicitly.
        let kind = ((payload?["kind"] as? String)
            ?? (payload?["type"] as? String)
            ?? (payload?["payloadType"] as? String)
            ?? "").lowercased()
        if kind.contains("user") {
            return .user
        }
        if kind.contains("system") || kind.contains("delegation") || kind.contains("subthread") {
            return .system
        }
        switch channel {
        case .agentError, .geminiError:
            return .error
        case .agentOutput, .geminiOutput:
            return .assistant
        default:
            return .assistant
        }
    }

    static func extractText(from payload: [String: Any]?) -> String? {
        guard let payload else { return nil }
        for key in ["delta", "text", "content", "message", "error"] {
            if let value = payload[key] as? String, !value.isEmpty {
                return value
            }
        }
        return nil
    }

    static func extractRunId(from payload: [String: Any]?) -> String? {
        guard let payload else { return nil }
        for key in ["runId", "runID", "appRunId", "run_id", "appRunID"] {
            if let value = payload[key] as? String,
               !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return value
            }
        }
        return nil
    }

    /// Synthetic runId for events that don't carry one — uses the channel
    /// + provider + the start-of-minute timestamp so consecutive deltas
    /// on the same minute coalesce, but separate "no runId" sessions do
    /// not bleed together across long gaps. Stable enough for the empty
    /// fallback while remaining deterministic for tests.
    static func fallbackRunId(for event: BridgeRunEvent) -> String {
        let minuteBucket = Int(event.publishedAt.timeIntervalSince1970 / 60.0)
        return "run-anon-\(event.channel.rawValue)-\(event.provider)-\(minuteBucket)"
    }

    /// Decode a tool-use payload into a `ToolActivityCard`. Returns nil
    /// when the payload does not look like a tool event.
    static func extractToolActivity(
        payload: [String: Any]?,
        at timestamp: Date
    ) -> ToolActivityCard? {
        guard let payload else { return nil }
        let kind = ((payload["kind"] as? String) ?? (payload["type"] as? String) ?? "").lowercased()
        // Tool payloads typically carry an explicit `tool_id` (Anthropic
        // & friends) OR `toolUseId` / `tool_use_id`. We also accept the
        // pure name when no id is present — synthesised ids collide
        // intentionally so a stream of "Bash" calls collapse into one
        // card, which is the desktop's behavior for the same reason.
        let toolId = (payload["toolId"] as? String)
            ?? (payload["tool_id"] as? String)
            ?? (payload["toolUseId"] as? String)
            ?? (payload["tool_use_id"] as? String)
        let toolName = (payload["toolName"] as? String)
            ?? (payload["tool"] as? String)
            ?? (payload["name"] as? String)
        guard kind.contains("tool") || toolId != nil || toolName != nil else {
            return nil
        }
        let resolvedId = toolId ?? toolName ?? "tool-anon"
        let resolvedName = toolName ?? "tool"
        let summary = (payload["summary"] as? String)
            ?? (payload["status"] as? String)
            ?? (payload["text"] as? String)
        let statusString = ((payload["status"] as? String)
            ?? (payload["toolStatus"] as? String)
            ?? "").lowercased()
        let status: ToolActivityCard.Status
        switch statusString {
        case "success", "complete", "completed", "done":
            status = .success
        case "failed", "error":
            status = .failed
        case "pending", "queued":
            status = .pending
        default:
            status = .running
        }
        return ToolActivityCard(
            toolId: resolvedId,
            toolName: resolvedName,
            status: status,
            summary: summary,
            startedAt: timestamp,
            lastUpdatedAt: timestamp
        )
    }

    /// Build a deterministic, collision-free group id from the
    /// `runId × role` pair plus an ordinal index. Ordinal matters because
    /// a single runId can host multiple successive assistant groups after
    /// a tool/result interleave; without it `Identifiable` would collide.
    static func generateGroupId(
        runId: String,
        role: TranscriptMessageGroup.Role,
        ordinal: Int
    ) -> String {
        "g-\(runId)-\(role.rawValue)-\(ordinal)"
    }
}
