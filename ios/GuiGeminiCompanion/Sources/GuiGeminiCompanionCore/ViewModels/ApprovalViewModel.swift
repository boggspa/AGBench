import Foundation
import Observation

/// PendingApproval — a single tool-call approval prompt the desktop has
/// surfaced via a bridge event. The view renders one card per entry.
public struct PendingApproval: Identifiable, Sendable, Equatable {
    public let id: String  // toolCallId — also the discriminator
    public let workspaceId: String
    public let threadId: String
    public let summary: String  // short user-facing description
    public let receivedAt: Date

    public init(
        id: String,
        workspaceId: String,
        threadId: String,
        summary: String,
        receivedAt: Date = Date()
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.threadId = threadId
        self.summary = summary
        self.receivedAt = receivedAt
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
