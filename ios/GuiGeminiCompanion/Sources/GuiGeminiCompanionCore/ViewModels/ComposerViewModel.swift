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
    public private(set) var currentRunId: String?

    public var canCancelRun: Bool {
        guard let currentRunId, !currentRunId.isEmpty else { return false }
        if case .sending = status { return true }
        if case .sent = status { return true }
        return false
    }

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
            if ack?.accepted == true,
               let appRunId = Self.extractAppRunId(from: ack?.message) {
                currentRunId = appRunId
                prompt = ""  // clear the input after a successful send
                status = .sent(message: ack?.message ?? "Run dispatched")
            } else {
                status = .sendFailed(message: ack?.message ?? "Desktop rejected the prompt")
            }
        } catch {
            status = .sendFailed(message: "Send failed: \(error.localizedDescription)")
        }
    }

    /// Cancel the currently tracked run, if any. `currentRunId` is set
    /// from a successful composer ack (`appRunId=...`) and refreshed from
    /// live run events for the selected workspace/thread.
    public func cancelCurrentRun() async {
        guard let currentRunId else {
            status = .sendFailed(message: "No active run to cancel")
            return
        }
        await cancelRun(runId: currentRunId)
    }

    /// Cancel an in-flight run.
    public func cancelRun(runId: String) async {
        let action = BridgeActionPayload.cancelRun(
            workspaceId: workspaceId,
            threadId: threadId,
            provider: provider,
            runId: runId,
            message: "Canceled from iPhone"
        )
        do {
            let ack = try await client.sendAction(action)
            if ack?.accepted == true {
                currentRunId = nil
                status = .sent(message: ack?.message ?? "Cancel requested")
            } else {
                status = .sendFailed(message: ack?.message ?? "Desktop rejected the cancel request")
            }
        } catch {
            status = .sendFailed(message: "Cancel send failed: \(error.localizedDescription)")
        }
    }

    public func observeRunEvent(_ event: BridgeRunEvent) {
        guard let payload = event.payloadDictionary() else { return }
        let eventWorkspaceId = Self.string(payload, keys: ["workspaceId", "workspaceID", "workspace_id", "workspace"])
        let eventThreadId = Self.string(payload, keys: ["threadId", "threadID", "thread_id", "appChatId", "chatId"])
        let eventProvider = Self.string(payload, keys: ["provider"]) ?? event.provider
        guard eventWorkspaceId == workspaceId,
              eventThreadId == threadId,
              eventProvider == provider
        else { return }
        guard let runId = Self.string(payload, keys: ["appRunId", "runId", "runID"]) else { return }
        switch event.channel {
        case .agentExit, .geminiExit, .agentError, .geminiError:
            if currentRunId == runId { currentRunId = nil }
        case .agentOutput, .geminiOutput:
            currentRunId = runId
        case .workspaceList, .workspaceUpdated, .threadList, .threadUpdated:
            break
        }
    }

    private static func extractAppRunId(from message: String?) -> String? {
        guard let message else { return nil }
        guard let range = message.range(of: "appRunId=") else { return nil }
        let suffix = message[range.upperBound...]
        let token = suffix.prefix { char in
            !char.isWhitespace && char != "," && char != ";" && char != ")"
        }
        let value = String(token).trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private static func string(_ payload: [String: Any], keys: [String]) -> String? {
        for key in keys {
            if let value = payload[key] as? String {
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { return trimmed }
            }
        }
        return nil
    }
}
