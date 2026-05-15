import Foundation
import Observation
import BridgeCore

/// ComposerViewModel — state + send-action for the iOS composer view.
///
/// The composer is the iPhone-minimal version of the desktop's new-turn
/// flow. The user picks a workspace (from the desktop-curated allowlist
/// surfaced via a future remote-workspaces feed), picks a provider,
/// types a prompt, and taps Send. The view model builds a typed
/// `BridgeActionPayload.composerPrompt(...)` and ships it.
///
/// Optional pre-flight: before sending the composerPrompt action the
/// view model can `prepareStartTurn()` to validate the workspace +
/// provider + approvalMode combination with the desktop. The desktop
/// returns a typed ack telling us whether the combo is allowed; if
/// not, the UI shows the deny reason instead of sending the run.
@Observable
@MainActor
public final class ComposerViewModel {
    /// User-supplied state, two-way bound to the SwiftUI form.
    public var workspaceId: String = ""
    public var threadId: String = ""
    public var provider: String = "gemini"
    public var prompt: String = ""
    public var approvalMode: String = "default"
    public var model: String = ""
    public var contextTurns: Int = 5

    public enum Status: Sendable, Equatable {
        case idle
        case preparing
        case prepareDenied(reason: String)
        case sending
        case sent(message: String)
        case sendFailed(message: String)
    }

    public private(set) var status: Status = .idle

    private let client: GuiGeminiBridgeClient

    public init(client: GuiGeminiBridgeClient) {
        self.client = client
    }

    /// Optional pre-flight check. Asks the desktop to evaluate the
    /// workspace + provider + approvalMode combo via the allowlist
    /// before we send the actual prompt. Useful UX: shows the user
    /// "Workspace not on allowlist" before they type a long prompt.
    public func prepareStartTurn() async {
        guard !workspaceId.isEmpty, !threadId.isEmpty else {
            status = .prepareDenied(reason: "workspaceId and threadId are required")
            return
        }
        status = .preparing
        let request = BridgePrepareStartTurnRequest(
            prepareID: UUID().uuidString.lowercased(),
            workspaceID: WorkspaceID(workspaceId),
            threadID: threadId.isEmpty ? nil : ThreadID(threadId)
        )
        if let ack = await client.sendPrepareStartTurn(request) {
            if ack.accepted {
                status = .idle
            } else {
                status = .prepareDenied(reason: ack.message ?? "Workspace allowlist denied prepare-start-turn")
            }
        } else {
            status = .prepareDenied(reason: "No response from desktop (transport offline?)")
        }
    }

    /// Build the typed composerPrompt action and ship it. The desktop
    /// returns the dispatched appRunId in the ack's `data` field so
    /// the iOS UI can offer a "Watch this run" deep-link.
    public func send() async {
        guard !workspaceId.isEmpty, !threadId.isEmpty, !provider.isEmpty, !prompt.isEmpty else {
            status = .sendFailed(message: "workspaceId, threadId, provider, and prompt are required")
            return
        }
        let action = BridgeActionPayload.composerPrompt(
            workspaceId: workspaceId,
            threadId: threadId,
            text: prompt,
            provider: provider,
            approvalMode: approvalMode.isEmpty ? nil : approvalMode,
            model: model.isEmpty ? nil : model,
            contextTurns: contextTurns
        )
        status = .sending
        do {
            let ack = try await client.sendAction(action)
            if ack?.accepted == true {
                prompt = ""  // clear the input after a successful send
                status = .sent(message: ack?.message ?? "Run dispatched")
            } else {
                status = .sendFailed(message: ack?.message ?? "Desktop rejected the prompt")
            }
        } catch {
            status = .sendFailed(message: "Send failed: \(error.localizedDescription)")
        }
    }

    /// Cancel an in-flight run. The iOS UI would pull `runId` from a
    /// previously-dispatched action's ack.data, or from a runEvent's
    /// payload. Provided here as a convenience entry point.
    public func cancelRun(runId: String) async {
        let action = BridgeActionPayload.cancelRun(
            workspaceId: workspaceId,
            threadId: threadId,
            provider: provider,
            runId: runId,
            message: "Canceled from iPhone"
        )
        do {
            _ = try await client.sendAction(action)
        } catch {
            status = .sendFailed(message: "Cancel send failed: \(error.localizedDescription)")
        }
    }
}
