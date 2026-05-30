import Foundation
import AGBenchRunActivityShared

public enum AGBenchRunActivityEffect: Sendable, Equatable {
    case start(
        attributes: AGBenchRunActivityAttributes,
        state: AGBenchRunActivityAttributes.ContentState
    )
    case update(
        runId: String,
        state: AGBenchRunActivityAttributes.ContentState
    )
    case end(
        runId: String,
        finalState: AGBenchRunActivityAttributes.ContentState,
        dismissalPolicy: AGBenchLiveActivityDismissalPolicy
    )
}

public struct AGBenchRunActivityEventReducer: Sendable {
    private struct RunSnapshot: Sendable {
        var attributes: AGBenchRunActivityAttributes
        var startedAt: Date
        var state: AGBenchRunActivityAttributes.ContentState
        var seenToolIds: Set<String> = []
        var pendingApprovalIds: Set<String> = []
    }

    private var runs: [String: RunSnapshot] = [:]

    public init() {}

    public mutating func apply(_ event: BridgeRunEvent) -> AGBenchRunActivityEffect? {
        let payload = event.payloadDictionary() ?? [:]
        let nested = Self.nestedPayloadDictionary(from: payload)
        guard let runId = Self.firstString(keys: ["appRunId", "runId", "runID", "id"], in: payload, nested),
              !runId.isEmpty
        else { return nil }

        let provider = Self.firstString(keys: ["provider"], in: payload, nested) ?? event.provider
        let workspaceName = Self.workspaceName(payload: payload, nested: nested)
        let threadTitle = Self.threadTitle(payload: payload, nested: nested, runId: runId)
        let summary = Self.summary(for: event, payload: payload, nested: nested)
        let startedAt = runs[runId]?.startedAt ?? event.publishedAt
        var snapshot = runs[runId] ?? RunSnapshot(
            attributes: AGBenchRunActivityAttributes(
                runId: runId,
                provider: provider,
                workspaceName: workspaceName,
                threadTitle: threadTitle
            ),
            startedAt: startedAt,
            state: AGBenchRunActivityAttributes.ContentState(
                status: .running,
                lastEventSummary: summary,
                durationS: Self.durationS(startedAt: startedAt, now: event.publishedAt)
            )
        )

        snapshot.attributes = AGBenchRunActivityAttributes(
            runId: runId,
            provider: provider,
            workspaceName: workspaceName,
            threadTitle: threadTitle
        )
        snapshot.state.durationS = Self.durationS(startedAt: snapshot.startedAt, now: event.publishedAt)
        snapshot.state.lastEventSummary = summary

        if Self.isToolEvent(event: event, payload: payload, nested: nested) {
            if let toolId = Self.firstString(
                keys: ["toolCallId", "tool_call_id", "callId", "id"],
                in: payload,
                nested
            ) {
                if snapshot.seenToolIds.insert(toolId).inserted {
                    snapshot.state.toolCallsCount += 1
                }
            } else {
                snapshot.state.toolCallsCount += 1
            }
        }

        Self.applyApprovalDelta(payload: payload, nested: nested, snapshot: &snapshot)

        if let terminal = Self.terminalStatus(for: event, payload: payload, nested: nested) {
            snapshot.state.status = terminal
            snapshot.state.pendingApprovalCount = max(0, snapshot.state.pendingApprovalCount)
            runs.removeValue(forKey: runId)
            return .end(
                runId: runId,
                finalState: snapshot.state,
                dismissalPolicy: Self.dismissalPolicy(for: terminal)
            )
        }

        snapshot.state.status = .running
        snapshot.state.pendingApprovalCount = snapshot.pendingApprovalIds.count
        let alreadyRunning = runs[runId] != nil
        runs[runId] = snapshot
        if alreadyRunning {
            return .update(runId: runId, state: snapshot.state)
        }
        return .start(attributes: snapshot.attributes, state: snapshot.state)
    }

    private static func terminalStatus(
        for event: BridgeRunEvent,
        payload: [String: Any],
        nested: [String: Any]?
    ) -> AGBenchRunActivityStatus? {
        switch event.channel {
        case .agentExit, .geminiExit:
            let code = firstInt(keys: ["code", "exitCode"], in: payload, nested)
            return code == 0 ? .completed : .failed
        case .agentError, .geminiError:
            return .failed
        case .agentOutput, .geminiOutput:
            break
        case .workspaceList, .workspaceUpdated, .threadList, .threadUpdated, .remoteProjection:
            // Sidebar-summary channels never reach the reducer in practice
            // (TranscriptViewModel filters them upstream). Kept here for
            // switch exhaustivity so future channel additions surface
            // explicit compile errors instead of silent fall-throughs.
            return nil
        }

        let marker = [
            firstString(keys: ["type", "kind", "status", "state"], in: payload, nested)
        ]
            .compactMap { $0?.lowercased() }
            .joined(separator: " ")
        guard marker.contains("run_finished")
                || marker.contains("finished")
                || marker.contains("completed")
                || marker.contains("cancelled")
                || marker.contains("canceled")
                || marker.contains("failed")
        else { return nil }
        if marker.contains("cancelled") || marker.contains("canceled") {
            return .cancelled
        }
        if marker.contains("failed") || marker.contains("error") {
            return .failed
        }
        return .completed
    }

    private static func dismissalPolicy(
        for status: AGBenchRunActivityStatus
    ) -> AGBenchLiveActivityDismissalPolicy {
        switch status {
        case .completed:
            return .after(120)
        case .cancelled:
            return .immediate
        case .failed:
            return .default
        case .running:
            return .default
        }
    }

    private static func isToolEvent(
        event: BridgeRunEvent,
        payload: [String: Any],
        nested: [String: Any]?
    ) -> Bool {
        let marker = [
            firstString(keys: ["type", "kind"], in: payload, nested),
            firstString(keys: ["toolName", "tool_name", "name"], in: payload, nested)
        ]
            .compactMap { $0?.lowercased() }
            .joined(separator: " ")
        return marker.contains("tool")
    }

    private static func applyApprovalDelta(
        payload: [String: Any],
        nested: [String: Any]?,
        snapshot: inout RunSnapshot
    ) {
        let marker = [
            firstString(keys: ["type", "kind", "status", "state"], in: payload, nested),
            firstString(keys: ["summary", "message", "title"], in: payload, nested)
        ]
            .compactMap { $0?.lowercased() }
            .joined(separator: " ")
        guard marker.contains("approval") else {
            snapshot.state.pendingApprovalCount = snapshot.pendingApprovalIds.count
            return
        }
        let explicitType = firstString(
            keys: ["type", "kind", "status", "state"],
            in: payload,
            nested
        )?.lowercased()
        let approvalId = firstString(
            keys: ["approvalId", "approvalID", "toolCallId", "tool_call_id", "id"],
            in: payload,
            nested
        ) ?? UUID().uuidString
        if explicitType == "approval_resolved"
            || marker.contains("resolved")
            || marker.contains("response")
            || marker.contains("approved")
            || marker.contains("denied")
            || marker.contains("timeout")
            || marker.contains("expired")
            || marker.contains("cancelled") {
            snapshot.pendingApprovalIds.remove(approvalId)
        } else {
            snapshot.pendingApprovalIds.insert(approvalId)
        }
        snapshot.state.pendingApprovalCount = snapshot.pendingApprovalIds.count
    }

    private static func summary(
        for event: BridgeRunEvent,
        payload: [String: Any],
        nested: [String: Any]?
    ) -> String {
        if let text = firstString(keys: ["summary", "text", "error", "message", "type"], in: payload, nested),
           !text.isEmpty {
            return text.count > 80 ? String(text.prefix(77)) + "..." : text
        }
        switch event.channel {
        case .agentOutput, .geminiOutput:
            return "Run update"
        case .agentError, .geminiError:
            return "Provider error"
        case .agentExit, .geminiExit:
            return "Provider exited"
        case .workspaceList, .workspaceUpdated, .threadList, .threadUpdated, .remoteProjection:
            // Unreachable — TranscriptViewModel filters summary events
            // before the reducer ever sees them. See terminalStatus(...)
            // above for the matching defensive default.
            return ""
        }
    }

    private static func workspaceName(payload: [String: Any], nested: [String: Any]?) -> String {
        if let value = firstString(keys: ["workspaceName", "workspaceId"], in: payload, nested), !value.isEmpty {
            return value
        }
        if let path = firstString(keys: ["workspacePath", "workspace", "cwd"], in: payload, nested),
           !path.isEmpty {
            let last = URL(fileURLWithPath: path).lastPathComponent
            return last.isEmpty ? path : last
        }
        return "AGBench"
    }

    private static func threadTitle(payload: [String: Any], nested: [String: Any]?, runId: String) -> String {
        if let value = firstString(keys: ["threadTitle", "title", "appChatId", "threadId"], in: payload, nested),
           !value.isEmpty {
            return value
        }
        return "Run \(runId)"
    }

    private static func durationS(startedAt: Date, now: Date) -> Int {
        max(0, Int(now.timeIntervalSince(startedAt).rounded(.down)))
    }

    private static func nestedPayloadDictionary(from payload: [String: Any]) -> [String: Any]? {
        if let data = payload["data"] as? String {
            let trimmed = data.trimmingCharacters(in: .whitespacesAndNewlines)
            if let decoded = try? JSONSerialization.jsonObject(with: Data(trimmed.utf8)) as? [String: Any] {
                return decoded
            }
        }
        if let nested = payload["payload"] as? [String: Any] {
            return nested
        }
        return nil
    }

    private static func firstString(
        keys: [String],
        in payload: [String: Any],
        _ nested: [String: Any]?
    ) -> String? {
        for key in keys {
            if let value = payload[key] as? String, !value.isEmpty {
                return value
            }
            if let value = nested?[key] as? String, !value.isEmpty {
                return value
            }
        }
        return nil
    }

    private static func firstInt(
        keys: [String],
        in payload: [String: Any],
        _ nested: [String: Any]?
    ) -> Int? {
        for key in keys {
            if let value = payload[key] as? Int {
                return value
            }
            if let value = payload[key] as? NSNumber {
                return value.intValue
            }
            if let value = nested?[key] as? Int {
                return value
            }
            if let value = nested?[key] as? NSNumber {
                return value.intValue
            }
        }
        return nil
    }
}
