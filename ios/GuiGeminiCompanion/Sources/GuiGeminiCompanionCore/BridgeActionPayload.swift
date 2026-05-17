import Foundation

/// BridgeActionPayload — iOS-side mirror of the Electron-side
/// `BridgeActionPayload.ts` discriminated union. Each variant produces
/// the same JSON shape the Electron-side router expects, so the iOS app
/// can compose actions and the desktop's `BridgeActionPayload` decoder
/// will recognize them.
///
/// Wire path:
///   iOS app composes a `BridgeActionPayload`
///     → `.encode()` returns UTF-8 JSON bytes
///     → bytes flow through the bridge as `bridge.action-record` (or
///       wrapped in the appropriate QUIC envelope)
///     → desktop's `decodeBridgeActionPayload` decodes the same bytes
///     → `BridgeActionRouter` evaluates policy, then dispatches via
///       `BridgeActionExecutor`
///
/// Keep this in sync with `src/main/BridgeActionPayload.ts` field-by-field.
/// The decoder there is strict; missing fields decode as `unknown` and the
/// router denies with "unrecognized action kind".
public enum BridgeActionPayload: Sendable, Equatable {
    public enum ApprovalDecision: String, Sendable, Equatable {
        case accept
        case acceptForSession
        case decline
    }

    public enum ApnsEnv: String, Sendable, Equatable {
        case production
        case sandbox
    }

    case approvalReply(
        workspaceId: String,
        threadId: String,
        toolCallId: String,
        decision: ApprovalDecision,
        message: String? = nil
    )
    case questionReply(
        workspaceId: String,
        threadId: String,
        promptId: String,
        answer: String
    )
    case questionReject(
        workspaceId: String,
        threadId: String,
        promptId: String,
        message: String? = nil
    )
    case composerPrompt(
        workspaceId: String,
        threadId: String,
        text: String,
        provider: String,
        approvalMode: String? = nil,
        model: String? = nil,
        contextTurns: Int? = nil
    )
    case cancelRun(
        workspaceId: String,
        threadId: String,
        provider: String,
        runId: String,
        message: String? = nil
    )
    case registerApnsToken(
        pairID: String,
        deviceToken: String,
        env: ApnsEnv
    )
    case subscribeRunEvents(
        runId: String,
        resumeFrom: Int? = nil
    )

    /// Encode the action as UTF-8 JSON bytes matching the Electron-side
    /// decoder shape. Sorted keys for stable wire bytes (helps logging /
    /// hashing). Throws only on truly anomalous JSON serialization
    /// failures (which shouldn't happen for our shapes).
    public func encode() throws -> Data {
        let dict = self.toJSONDictionary()
        return try JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys])
    }

    /// JSON tree representation. Exposed for tests + diagnostics; the
    /// production caller uses `encode()` directly.
    public func toJSONDictionary() -> [String: Any] {
        switch self {
        case .approvalReply(let workspaceId, let threadId, let toolCallId, let decision, let message):
            var dict: [String: Any] = [
                "kind": "approvalReply",
                "workspaceId": workspaceId,
                "threadId": threadId,
                "toolCallId": toolCallId,
                "decision": decision.rawValue
            ]
            if let message { dict["message"] = message }
            return dict
        case .questionReply(let workspaceId, let threadId, let promptId, let answer):
            return [
                "kind": "questionReply",
                "workspaceId": workspaceId,
                "threadId": threadId,
                "promptId": promptId,
                "answer": answer
            ]
        case .questionReject(let workspaceId, let threadId, let promptId, let message):
            var dict: [String: Any] = [
                "kind": "questionReject",
                "workspaceId": workspaceId,
                "threadId": threadId,
                "promptId": promptId
            ]
            if let message { dict["message"] = message }
            return dict
        case .composerPrompt(let workspaceId, let threadId, let text, let provider, let approvalMode, let model, let contextTurns):
            var dict: [String: Any] = [
                "kind": "composerPrompt",
                "workspaceId": workspaceId,
                "threadId": threadId,
                "text": text,
                "provider": provider
            ]
            if let approvalMode { dict["approvalMode"] = approvalMode }
            if let model { dict["model"] = model }
            if let contextTurns { dict["contextTurns"] = contextTurns }
            return dict
        case .cancelRun(let workspaceId, let threadId, let provider, let runId, let message):
            var dict: [String: Any] = [
                "kind": "cancelRun",
                "workspaceId": workspaceId,
                "threadId": threadId,
                "provider": provider,
                "runId": runId
            ]
            if let message { dict["message"] = message }
            return dict
        case .registerApnsToken(let pairID, let deviceToken, let env):
            return [
                "kind": "registerApnsToken",
                "pairID": pairID,
                "deviceToken": deviceToken,
                "env": env.rawValue
            ]
        case .subscribeRunEvents(let runId, let resumeFrom):
            var dict: [String: Any] = [
                "kind": "subscribe-run-events",
                "runId": runId
            ]
            if let resumeFrom {
                dict["resumeFrom"] = resumeFrom
            } else {
                dict["resumeFrom"] = NSNull()
            }
            return dict
        }
    }
}
