import Foundation

/// BridgeApprovalEventDecoder — translate a `BridgeRunEvent` into a
/// typed `PendingApproval`, when its payload looks like an
/// approval-request emission from the desktop.
///
/// Wire shapes accepted:
///
///   1) **Lean approval_pending** (what the desktop currently emits
///      over the bridge — see `src/main/services/ApprovalService.ts`
///      `emitApprovalRunEvent`):
///
///        { "type": "approval_pending",
///          "approvalId": "1730000000000-abc",
///          "provider": "codex",
///          "workspaceId": "/path/to/ws",
///          "threadId": "chat-77",
///          "appRunId": "run-3",
///          "appChatId": "chat-77" }
///
///      No title/body/preview here — we map these to the legacy
///      PendingApproval fields with a generated `summary` so the
///      ApprovalCardsView still renders something useful.
///
///   2) **Rich approval-request** (the shape sent today over Electron
///      IPC `agent-approval-request`, anticipated to be re-emitted to
///      the bridge in a follow-up — see `src/main/index.ts` lines
///      ~2540-2670 and `recordApprovalLedgerRequest`):
///
///        { "method": "host-command/approve",
///          "title": "Run shell command",
///          "body": "ls -la",
///          "approvalId": "...", "id": "...",
///          "provider": "codex",
///          "preview": { "command": "ls -la", "cwd": "/tmp", "actions": [...] },
///          "actions": ["accept", "acceptForSession", "decline", "cancel"],
///          "appRunId": "run-3", "appChatId": "chat-77" }
///
///      We extract title/body/preview/actions verbatim and surface them
///      on PendingApproval.
///
/// Decoder returns nil when:
///   - The event isn't on a channel we look at (only `agent-output` /
///     `gemini-output` carry approval emissions today).
///   - The payload doesn't have an `approvalId` (every approval shape
///     has one; without it we have nothing to dispatch back to).
///   - The payload's `type` is `approval_resolved` (we surface only
///     pending approvals — resolved ones are echoed for ledger sync
///     but the UI shouldn't pop a card).
///
/// All decoding is best-effort: unknown fields are ignored, missing
/// fields fall back to nil. If a future desktop emission ships a new
/// preview kind, the renderer falls back to `.generic` rather than
/// dropping the approval.
public enum BridgeApprovalEventDecoder {
    /// Decode an approval-request from a BridgeRunEvent's payload, if
    /// the payload looks like one. Returns nil otherwise — callers
    /// should iterate every event and ignore nils.
    public static func decode(event: BridgeRunEvent) -> PendingApproval? {
        guard isApprovalCarryingChannel(event.channel) else { return nil }
        guard let payload = event.payloadDictionary() else { return nil }
        return decode(payload: payload, fallbackProvider: event.provider, receivedAt: event.publishedAt)
    }

    /// Same as `decode(event:)` but operating on an already-decoded
    /// `[String: Any]` payload tree. Exposed for tests + for callers
    /// that have pre-decoded the bridge event.
    public static func decode(
        payload: [String: Any],
        fallbackProvider: String,
        receivedAt: Date = Date()
    ) -> PendingApproval? {
        // Skip resolved-side events; they're informational only.
        if let type = payload["type"] as? String,
           type == "approval_resolved" || type == "approval_canceled" {
            return nil
        }
        // Pull the approval id (multiple sources for tolerance).
        let approvalId = string(payload, keys: ["approvalId", "id", "toolCallId", "callId"])
        guard let approvalId, !approvalId.isEmpty else { return nil }
        // type=="approval_pending" is the strongest signal; if absent,
        // a payload that carries an `actions` array with approval-shaped
        // strings (accept/decline/etc.) also looks like an approval
        // prompt. Otherwise we ignore — most agent-output events are
        // plain stdout, not approvals.
        let typeMatches = (payload["type"] as? String) == "approval_pending"
        let methodLooksLikeApproval = (payload["method"] as? String)?.hasPrefix("approval") == true
        let kindLooksLikeApproval = (payload["kind"] as? String) == "approval-request"
        let hasApprovalActions = approvalActions(from: payload).contains(where: { action in
            BridgeActionPayload.ApprovalDecision(rawValue: action) != nil
        })
        guard typeMatches || methodLooksLikeApproval || kindLooksLikeApproval || hasApprovalActions else {
            return nil
        }

        let workspaceId = string(payload, keys: ["workspaceId", "workspaceID", "workspace_id"]) ?? ""
        let threadId = string(payload, keys: [
            "threadId", "threadID", "thread_id",
            "appChatId", "chatId", "appRunId", "runId"
        ]) ?? approvalId
        let provider = string(payload, keys: ["provider"]) ?? fallbackProvider
        let title = string(payload, keys: ["title", "summary"])
        let body = string(payload, keys: ["body", "message", "description"])
        let method = string(payload, keys: ["method"])
        let actions = approvalActions(from: payload)
        let preview = decodePreview(from: payload["preview"], title: title, body: body)
        let summary = title?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmptyOrNil
            ?? body?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmptyOrNil
            ?? "Approval requested (\(provider))"

        return PendingApproval(
            id: approvalId,
            workspaceId: workspaceId,
            threadId: threadId,
            summary: summary,
            receivedAt: receivedAt,
            title: title,
            body: body,
            preview: preview,
            actions: actions,
            provider: provider,
            method: method,
            approvalId: approvalId
        )
    }

    /// Channels that may carry approval payloads on the wire. Today's
    /// desktop fans approval_pending through `agent-output` only; the
    /// `gemini-output` legacy channel is included for symmetry in case
    /// gemini-specific flows reuse the old channel.
    private static func isApprovalCarryingChannel(_ channel: BridgeRunEvent.Channel) -> Bool {
        switch channel {
        case .agentOutput, .geminiOutput: return true
        case .agentError, .agentExit, .geminiError, .geminiExit,
             .workspaceList, .workspaceUpdated, .threadList, .threadUpdated:
            return false
        }
    }

    private static func approvalActions(from payload: [String: Any]) -> [String] {
        if let arr = payload["actions"] as? [String], !arr.isEmpty {
            return arr
        }
        if let preview = payload["preview"] as? [String: Any],
           let arr = preview["actions"] as? [String], !arr.isEmpty {
            return arr
        }
        return []
    }

    private static func decodePreview(
        from raw: Any?,
        title: String?,
        body: String?
    ) -> ApprovalPreview? {
        guard let dict = raw as? [String: Any] else { return nil }
        let kindRaw = (dict["kind"] as? String) ?? inferKind(dict, title: title, body: body)
        let kind = ApprovalPreview.Kind(rawValue: kindRaw) ?? .generic
        let command = string(dict, keys: ["command", "cmd"])
        let cwd = string(dict, keys: ["cwd", "workingDirectory"])
        let toolName = string(dict, keys: ["toolName", "tool", "name"])
        let patch = string(dict, keys: ["patchPreview", "patch", "diff"])
        let changes = (dict["changes"] as? [String])
            ?? (dict["files"] as? [String])
        let workspacePath = string(dict, keys: ["workspacePath", "path"])
        // Drop completely empty previews — better to return nil than an
        // all-nil struct that confuses `hasRichPreview` calculations.
        if command == nil, cwd == nil, toolName == nil, patch == nil,
           (changes ?? []).isEmpty, workspacePath == nil, kind == .generic {
            return nil
        }
        return ApprovalPreview(
            kind: kind,
            command: command,
            cwd: cwd,
            toolName: toolName,
            patchPreview: patch,
            changes: changes,
            workspacePath: workspacePath
        )
    }

    private static func inferKind(_ dict: [String: Any], title: String?, body: String?) -> String {
        if dict["command"] != nil { return ApprovalPreview.Kind.command.rawValue }
        if dict["patchPreview"] != nil || dict["patch"] != nil { return ApprovalPreview.Kind.patch.rawValue }
        if dict["changes"] != nil || dict["files"] != nil { return ApprovalPreview.Kind.files.rawValue }
        if dict["workspacePath"] != nil { return ApprovalPreview.Kind.workspaceTrust.rawValue }
        if dict["toolName"] != nil || dict["tool"] != nil { return ApprovalPreview.Kind.tool.rawValue }
        let lowerTitle = (title ?? "").lowercased()
        if lowerTitle.contains("trust") || lowerTitle.contains("workspace") {
            return ApprovalPreview.Kind.workspaceTrust.rawValue
        }
        if lowerTitle.contains("patch") || lowerTitle.contains("diff") || lowerTitle.contains("edit") {
            return ApprovalPreview.Kind.patch.rawValue
        }
        return ApprovalPreview.Kind.generic.rawValue
    }

    private static func string(_ payload: [String: Any], keys: [String]) -> String? {
        for key in keys {
            if let value = payload[key] as? String, !value.isEmpty {
                return value
            }
        }
        return nil
    }
}

private extension String {
    var nonEmptyOrNil: String? {
        isEmpty ? nil : self
    }
}
