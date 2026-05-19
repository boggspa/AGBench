import Foundation
import Observation

/// ApprovalPreview — structured preview payload that accompanies a rich
/// approval request from the desktop. Mirrors the loose shape the
/// desktop sends in `agent-approval-request.preview` (see
/// `src/main/index.ts` near the `recordApprovalLedgerRequest` call
/// sites). All fields are optional because the desktop emits different
/// shapes depending on the requesting service:
///
///   - Host-command approvals: `command` + `cwd`
///   - Tool approvals: `toolName` + arbitrary parameter blob
///   - Edit / patch approvals: `patchPreview` (unified diff) or
///     `changes` (file-path list)
///   - Workspace-trust approvals: `workspacePath`
///
/// The `kind` discriminator lets the renderer choose a layout without
/// having to taste-test fields. Unknown kinds fall back to a generic
/// "review the body" rendering so a new desktop-side preview shape
/// doesn't break the iPhone surface.
public struct ApprovalPreview: Codable, Sendable, Equatable {
    public enum Kind: String, Codable, Sendable, Equatable {
        case command
        case tool
        case patch
        case files
        case workspaceTrust = "workspace-trust"
        case generic
    }

    public let kind: Kind
    public let command: String?
    public let cwd: String?
    public let toolName: String?
    public let patchPreview: String?
    public let changes: [String]?
    public let workspacePath: String?

    public init(
        kind: Kind,
        command: String? = nil,
        cwd: String? = nil,
        toolName: String? = nil,
        patchPreview: String? = nil,
        changes: [String]? = nil,
        workspacePath: String? = nil
    ) {
        self.kind = kind
        self.command = command
        self.cwd = cwd
        self.toolName = toolName
        self.patchPreview = patchPreview
        self.changes = changes
        self.workspacePath = workspacePath
    }
}

/// PendingApproval — a single tool-call approval prompt the desktop has
/// surfaced via a bridge event. The view renders one card per entry.
///
/// Backward compatibility:
///   The original lean shape (id / workspaceId / threadId / summary /
///   receivedAt) is still supported via the legacy `init`. The richer
///   fields (title / body / preview / actions / provider / method /
///   approvalId) are optional and default to nil — fixtures and tests
///   that decoded the lean shape continue to compile and run.
///
/// `summary` is preserved as the short user-facing description used
/// when no `title` was provided by the desktop. It defaults to the
/// title when both are set, which keeps the iPad sidebar's "Approval
/// needed" subtitle stable.
public struct PendingApproval: Identifiable, Sendable, Equatable {
    public let id: String  // toolCallId / approvalId — also the discriminator
    public let workspaceId: String
    public let threadId: String
    public let summary: String  // short user-facing description (falls back to title)
    public let receivedAt: Date
    /// Rich title from the desktop's structured payload. nil for legacy
    /// lean approvals where only `summary` was available.
    public let title: String?
    /// Longer body / explanation. nil when not provided.
    public let body: String?
    /// Structured preview (command, diff, file list, etc.). nil when the
    /// desktop didn't emit a preview block — typical for the lean
    /// `approval_pending` shape that's currently on the bridge.
    public let preview: ApprovalPreview?
    /// Action labels the desktop offers. Mirrors the desktop's
    /// `AgentApprovalAction` union strings: `accept`,
    /// `acceptForSession`, `acceptForWorkspace`, `decline`, `cancel`.
    /// When empty/nil the renderer falls back to the three-state
    /// default (accept / acceptForSession / decline) for back-compat.
    public let actions: [String]
    /// Provider id (`gemini`, `codex`, `claude`, `kimi`). nil when the
    /// payload didn't surface one (rare).
    public let provider: String?
    /// Method name (e.g. `approval/request`, `host-command/approve`,
    /// `tools/call`). nil when not set on the wire.
    public let method: String?
    /// Desktop-side approvalId (the registry key). Most of the time
    /// equal to `id`; surfaced separately in case future approvals
    /// distinguish the two (e.g. nested tool calls).
    public let approvalId: String?

    public init(
        id: String,
        workspaceId: String,
        threadId: String,
        summary: String,
        receivedAt: Date = Date(),
        title: String? = nil,
        body: String? = nil,
        preview: ApprovalPreview? = nil,
        actions: [String] = [],
        provider: String? = nil,
        method: String? = nil,
        approvalId: String? = nil
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.threadId = threadId
        self.summary = summary
        self.receivedAt = receivedAt
        self.title = title
        self.body = body
        self.preview = preview
        self.actions = actions
        self.provider = provider
        self.method = method
        self.approvalId = approvalId
    }

    /// Convenience for rendering: prefer the structured `title`, fall
    /// back to `summary` for legacy / lean payloads.
    public var displayTitle: String {
        if let title = title?.trimmingCharacters(in: .whitespacesAndNewlines),
           !title.isEmpty {
            return title
        }
        return summary
    }

    /// True when the desktop emitted a usable structured preview block
    /// (command + cwd, patch text, file list, etc.). Drives whether the
    /// renderer shows the rich preview card or just falls back to the
    /// title/body row.
    public var hasRichPreview: Bool {
        guard let preview else { return false }
        if let command = preview.command, !command.isEmpty { return true }
        if let patch = preview.patchPreview, !patch.isEmpty { return true }
        if let changes = preview.changes, !changes.isEmpty { return true }
        if let workspacePath = preview.workspacePath, !workspacePath.isEmpty { return true }
        if let toolName = preview.toolName, !toolName.isEmpty { return true }
        return false
    }

    /// Resolved action list for the renderer. Mirrors the desktop's
    /// emitted `actions` when present, else falls back to the
    /// three-state default that's been the iOS shape since launch.
    public var resolvedActions: [BridgeActionPayload.ApprovalDecision] {
        guard !actions.isEmpty else {
            return [.accept, .acceptForSession, .decline]
        }
        return actions.compactMap { BridgeActionPayload.ApprovalDecision(rawValue: $0) }
    }
}

/// ApprovalViewModel — state + actions for the iOS approval cards.
///
/// Pending approvals are tracked here keyed by toolCallId. The view
/// renders each as a card with three buttons (Accept, Accept for
/// session, Decline), mirroring the three-state decision contract
/// (`BridgeActionPayload.ApprovalDecision`).
///
/// When the user taps a decision, the view model:
///   1. Builds the typed `BridgeActionPayload.approvalReply(...)`
///   2. Sends via `client.sendAction(...)`
///   3. Removes the card from `pending` regardless of outcome
///      (the desktop's typed ack confirms whether the approval was
///      live; if it wasn't, the desktop has already auto-decided
///      and the user's tap is a no-op)
@Observable
@MainActor
public final class ApprovalViewModel {
    public private(set) var pending: [PendingApproval] = []
    public private(set) var lastResultMessage: String?

    private let client: GuiGeminiBridgeClient

    public init(client: GuiGeminiBridgeClient) {
        self.client = client
    }

    /// Called by the screen-coordinator when an approval-needed signal
    /// arrives from the desktop. (Future: hooked into the runEvents
    /// stream once the desktop emits a typed approval-needed payload.)
    public func enqueue(_ approval: PendingApproval) {
        // De-dupe by toolCallId — multiple notifications for the same
        // approval (push + transport echo) should produce one card.
        if !pending.contains(where: { $0.id == approval.id }) {
            pending.append(approval)
        }
    }

    /// Remove an approval card without sending a decision. Useful for
    /// timeouts or when the user dismisses a stale card.
    public func dismiss(toolCallId: String) {
        pending.removeAll { $0.id == toolCallId }
    }

    /// Resolve the approval with the given decision. Returns the
    /// desktop's typed ack (or nil on transport timeout). The card is
    /// removed immediately on send — the desktop's ack only confirms
    /// outcome, doesn't block the optimistic UI.
    public func respond(
        to approval: PendingApproval,
        decision: BridgeActionPayload.ApprovalDecision,
        message: String? = nil
    ) async {
        let action = BridgeActionPayload.approvalReply(
            workspaceId: approval.workspaceId,
            threadId: approval.threadId,
            toolCallId: approval.id,
            decision: decision,
            message: message
        )
        dismiss(toolCallId: approval.id)
        do {
            let ack = try await client.sendAction(action)
            lastResultMessage = ack?.message
                ?? "Approval \(decision.rawValue) sent for tool-call \(approval.id)"
        } catch {
            lastResultMessage = "Approval send failed: \(error.localizedDescription)"
        }
    }
}
