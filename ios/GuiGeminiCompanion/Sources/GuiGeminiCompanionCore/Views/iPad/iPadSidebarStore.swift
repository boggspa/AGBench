import Foundation
import Observation

@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class iPadSidebarStore {
    public private(set) var workspaces: [iPadWorkspaceSummary]
    public private(set) var threads: [iPadThreadSummary]

    public init(
        workspaces: [iPadWorkspaceSummary] = [],
        threads: [iPadThreadSummary] = []
    ) {
        self.workspaces = Self.sortedWorkspaces(Self.deduplicate(workspaces))
        self.threads = Self.sortedThreads(Self.deduplicate(threads))
    }

    public func workspace(id: String) -> iPadWorkspaceSummary? {
        workspaces.first { $0.id == id }
    }

    public func thread(id: String) -> iPadThreadSummary? {
        threads.first { $0.id == id }
    }

    public func threads(in workspaceID: String) -> [iPadThreadSummary] {
        threads.filter { $0.workspaceID == workspaceID }
    }

    // MARK: - Bridge summary application
    //
    // The four `apply*` methods consume the typed payloads decoded by
    // `BridgeWorkspaceSummariesDecoder` and merge them into the store's
    // observable arrays. Semantics:
    //
    //   * applyWorkspaceList — replace the full list (authoritative
    //     snapshot from the desktop). Sort order is recomputed.
    //   * applyWorkspaceUpdate — upsert a single workspace (replace if id
    //     exists, append if new). Other workspaces are untouched.
    //   * applyThreadList / applyThreadUpdate — same semantics, threads.
    //
    // The mapping between the bridge payloads and the iPad view-model
    // types is intentionally lossy: bridge payloads carry the durable
    // workspace/chat shape, while the iPad summaries carry view-model
    // hints (subtitle text, isActive marker, etc.) derived from the
    // payload values. Future fields stay backwards compatible because
    // both sides are additive.

    public func applyWorkspaceList(_ payloads: [WorkspaceSummaryPayload]) {
        let mapped = payloads.map { Self.workspaceSummary(from: $0) }
        let next = Self.sortedWorkspaces(Self.deduplicate(mapped))
        if next != workspaces {
            workspaces = next
        }
    }

    public func applyWorkspaceUpdate(_ payload: WorkspaceSummaryPayload) {
        let summary = Self.workspaceSummary(from: payload)
        var byID = Dictionary(uniqueKeysWithValues: workspaces.map { ($0.id, $0) })
        byID[summary.id] = summary
        let next = Self.sortedWorkspaces(Array(byID.values))
        if next != workspaces {
            workspaces = next
        }
    }

    public func applyThreadList(_ payloads: [ThreadSummaryPayload]) {
        let mapped = payloads.map { Self.threadSummary(from: $0) }
        let next = Self.sortedThreads(Self.deduplicate(mapped))
        if next != threads {
            threads = next
        }
    }

    public func applyThreadUpdate(_ payload: ThreadSummaryPayload) {
        let summary = Self.threadSummary(from: payload)
        var byID = Dictionary(uniqueKeysWithValues: threads.map { ($0.id, $0) })
        byID[summary.id] = summary
        let next = Self.sortedThreads(Array(byID.values))
        if next != threads {
            threads = next
        }
    }

    private static func workspaceSummary(
        from payload: WorkspaceSummaryPayload
    ) -> iPadWorkspaceSummary {
        let trimmedID = payload.workspaceId.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedDisplayName = payload.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        let pathHint = payload.path.trimmingCharacters(in: .whitespacesAndNewlines)
        return iPadWorkspaceSummary(
            id: trimmedID,
            displayName: resolvedDisplayName,
            pathDisplayHint: pathHint.isEmpty ? nil : pathHint,
            isActive: payload.runningChatCount > 0
        )
    }

    private static func threadSummary(
        from payload: ThreadSummaryPayload
    ) -> iPadThreadSummary {
        let trimmedID = payload.chatId.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedTitle = payload.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let workspaceID = payload.workspaceId.flatMap { value -> String? in
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        let statusLowered = payload.status.lowercased()
        let isActive = statusLowered == "running"
        let provider = payload.provider.trimmingCharacters(in: .whitespacesAndNewlines)
        return iPadThreadSummary(
            id: trimmedID,
            workspaceID: workspaceID,
            title: trimmedTitle.isEmpty ? trimmedID : trimmedTitle,
            subtitle: payload.status,
            provider: provider.isEmpty ? nil : provider,
            runID: nil,
            lastActivityAt: payload.lastMessageAt ?? Date(),
            isActive: isActive
        )
    }

    public func refresh(
        seedWorkspaces: [iPadWorkspaceSummary] = [],
        seedThreads: [iPadThreadSummary] = [],
        transcriptViewModel: TranscriptViewModel? = nil,
        approvalViewModel: ApprovalViewModel? = nil,
        composerViewModel: ComposerViewModel? = nil
    ) {
        var workspaceByID = Dictionary(uniqueKeysWithValues: seedWorkspaces.map { ($0.id, $0) })
        var threadByID = Dictionary(uniqueKeysWithValues: seedThreads.map { ($0.id, $0) })

        if let composerViewModel {
            mergeWorkspace(
                Self.workspace(
                    id: composerViewModel.workspaceId,
                    displayName: nil,
                    pathDisplayHint: composerViewModel.workspaceId,
                    isActive: true
                ),
                into: &workspaceByID
            )
            mergeThread(
                Self.thread(
                    id: composerViewModel.threadId,
                    workspaceID: composerViewModel.workspaceId,
                    title: composerViewModel.threadId,
                    subtitle: "Composer draft",
                    provider: composerViewModel.provider,
                    isActive: false
                ),
                into: &threadByID
            )
        }

        if let approvalViewModel {
            for approval in approvalViewModel.pending {
                mergeWorkspace(
                    Self.workspace(
                        id: approval.workspaceId,
                        displayName: nil,
                        pathDisplayHint: approval.workspaceId,
                        isActive: true
                    ),
                    into: &workspaceByID
                )
                mergeThread(
                    iPadThreadSummary(
                        id: approval.threadId,
                        workspaceID: approval.workspaceId,
                        title: "Approval needed",
                        subtitle: approval.summary,
                        provider: nil,
                        runID: nil,
                        lastActivityAt: approval.receivedAt,
                        isActive: true
                    ),
                    into: &threadByID
                )
            }
        }

        if let transcriptViewModel {
            for event in transcriptViewModel.events {
                guard let payload = event.payloadDictionary() else { continue }
                let workspaceSummary = Self.workspaceSummary(from: payload, event: event)
                mergeWorkspace(workspaceSummary, into: &workspaceByID)
                mergeThread(Self.threadSummary(from: payload, event: event), into: &threadByID)
            }
        }

        let nextWorkspaces = Self.sortedWorkspaces(Array(workspaceByID.values))
        let nextThreads = Self.sortedThreads(Array(threadByID.values))
        if nextWorkspaces != workspaces {
            workspaces = nextWorkspaces
        }
        if nextThreads != threads {
            threads = nextThreads
        }
    }

    private func mergeWorkspace(
        _ workspace: iPadWorkspaceSummary?,
        into workspaceByID: inout [String: iPadWorkspaceSummary]
    ) {
        guard let workspace else { return }
        if let existing = workspaceByID[workspace.id] {
            workspaceByID[workspace.id] = Self.preferredWorkspace(existing, workspace)
        } else {
            workspaceByID[workspace.id] = workspace
        }
    }

    private func mergeThread(
        _ thread: iPadThreadSummary?,
        into threadByID: inout [String: iPadThreadSummary]
    ) {
        guard let thread else { return }
        if let existing = threadByID[thread.id] {
            threadByID[thread.id] = Self.preferredThread(existing, thread)
        } else {
            threadByID[thread.id] = thread
        }
    }

    private static func workspaceSummary(
        from payload: [String: Any],
        event: BridgeRunEvent
    ) -> iPadWorkspaceSummary? {
        let nestedWorkspace = dictionary(payload, keys: ["workspace"])
        let id = string(payload, keys: ["workspaceId", "workspaceID", "workspace_id", "workspaceIDRaw", "workspace"])
            ?? string(nestedWorkspace, keys: ["id", "workspaceId", "workspaceID"])
            ?? string(payload, keys: ["cwd", "workspacePath", "path"])
        guard let id = trimmed(id), !id.isEmpty else { return nil }

        let path = string(payload, keys: ["workspacePath", "cwd", "pathDisplayHint", "path"])
            ?? string(nestedWorkspace, keys: ["pathDisplayHint", "path", "cwd"])
        let payloadDisplayName = string(payload, keys: ["workspaceName", "workspaceDisplayName"])
        let nestedDisplayName = string(nestedWorkspace, keys: ["displayName", "name", "title"])
        let pathDisplayName = path?.split(separator: "/").last.map(String.init)
        let idDisplayName = id.split(separator: "/").last.map(String.init)
        let displayName = payloadDisplayName
            ?? nestedDisplayName
            ?? pathDisplayName
            ?? idDisplayName
            ?? id
        let branch = string(payload, keys: ["branchName", "branch"])
            ?? string(nestedWorkspace, keys: ["branchName", "branch"])
        let permissionMode = string(payload, keys: ["permissionMode", "approvalMode"])
            ?? string(nestedWorkspace, keys: ["permissionMode", "approvalMode"])
        let dirtyCount = int(payload, keys: ["dirtyFileCount", "changedFiles"])
            ?? int(nestedWorkspace, keys: ["dirtyFileCount", "changedFiles"])
            ?? 0

        return iPadWorkspaceSummary(
            id: id,
            displayName: displayName,
            pathDisplayHint: path,
            branchName: branch,
            permissionMode: permissionMode,
            dirtyFileCount: dirtyCount,
            isActive: isActive(payload: payload, event: event)
        )
    }

    private static func threadSummary(
        from payload: [String: Any],
        event: BridgeRunEvent
    ) -> iPadThreadSummary? {
        let threadID = string(payload, keys: [
            "threadId", "threadID", "thread_id", "conversationId", "conversationID", "runId", "runID", "appRunId"
        ])
        guard let id = trimmed(threadID), !id.isEmpty else { return nil }

        let workspaceID = string(payload, keys: ["workspaceId", "workspaceID", "workspace_id", "workspace"])
            ?? string(dictionary(payload, keys: ["workspace"]), keys: ["id", "workspaceId", "workspaceID"])
        let runID = string(payload, keys: ["runId", "runID", "appRunId"])
        let title = string(payload, keys: ["title", "threadTitle", "summary"])
            ?? textPreview(from: payload)
            ?? id
        let status = string(payload, keys: ["status", "state", "phase", "kind", "type"])
        let workspaceLabel = workspaceID.map { Self.displayName(from: $0) }
        let eventTime = event.publishedAt.formatted(date: .omitted, time: .shortened)
        let subtitleCandidates: [String?] = [
            status,
            workspaceLabel,
            eventTime
        ]
        let subtitleParts = subtitleCandidates.compactMap { value -> String? in
            guard let value = trimmed(value), !value.isEmpty else { return nil }
            return value
        }
        return iPadThreadSummary(
            id: id,
            workspaceID: trimmed(workspaceID),
            title: title,
            subtitle: subtitleParts.joined(separator: " · "),
            provider: event.provider,
            runID: runID,
            lastActivityAt: event.publishedAt,
            isActive: isActive(payload: payload, event: event)
        )
    }

    private static func workspace(
        id: String,
        displayName: String?,
        pathDisplayHint: String?,
        isActive: Bool
    ) -> iPadWorkspaceSummary? {
        guard let id = trimmed(id), !id.isEmpty else { return nil }
        return iPadWorkspaceSummary(
            id: id,
            displayName: displayName ?? Self.displayName(from: id),
            pathDisplayHint: trimmed(pathDisplayHint),
            isActive: isActive
        )
    }

    private static func thread(
        id: String,
        workspaceID: String?,
        title: String,
        subtitle: String,
        provider: String?,
        isActive: Bool
    ) -> iPadThreadSummary? {
        guard let id = trimmed(id), !id.isEmpty else { return nil }
        return iPadThreadSummary(
            id: id,
            workspaceID: trimmed(workspaceID),
            title: title.isEmpty ? id : title,
            subtitle: subtitle,
            provider: provider,
            lastActivityAt: Date(),
            isActive: isActive
        )
    }

    private static func deduplicate(_ workspaces: [iPadWorkspaceSummary]) -> [iPadWorkspaceSummary] {
        var byID: [String: iPadWorkspaceSummary] = [:]
        for workspace in workspaces {
            byID[workspace.id] = byID[workspace.id].map { preferredWorkspace($0, workspace) } ?? workspace
        }
        return Array(byID.values)
    }

    private static func deduplicate(_ threads: [iPadThreadSummary]) -> [iPadThreadSummary] {
        var byID: [String: iPadThreadSummary] = [:]
        for thread in threads {
            byID[thread.id] = byID[thread.id].map { preferredThread($0, thread) } ?? thread
        }
        return Array(byID.values)
    }

    private static func preferredWorkspace(
        _ lhs: iPadWorkspaceSummary,
        _ rhs: iPadWorkspaceSummary
    ) -> iPadWorkspaceSummary {
        iPadWorkspaceSummary(
            id: lhs.id,
            displayName: better(lhs.displayName, rhs.displayName, fallback: lhs.id),
            pathDisplayHint: betterOptional(lhs.pathDisplayHint, rhs.pathDisplayHint),
            branchName: betterOptional(lhs.branchName, rhs.branchName),
            permissionMode: betterOptional(lhs.permissionMode, rhs.permissionMode),
            dirtyFileCount: max(lhs.dirtyFileCount, rhs.dirtyFileCount),
            isActive: lhs.isActive || rhs.isActive
        )
    }

    private static func preferredThread(
        _ lhs: iPadThreadSummary,
        _ rhs: iPadThreadSummary
    ) -> iPadThreadSummary {
        rhs.lastActivityAt >= lhs.lastActivityAt ? rhs : lhs
    }

    private static func sortedWorkspaces(_ workspaces: [iPadWorkspaceSummary]) -> [iPadWorkspaceSummary] {
        workspaces.sorted { lhs, rhs in
            if lhs.isActive != rhs.isActive {
                return lhs.isActive && !rhs.isActive
            }
            return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
        }
    }

    private static func sortedThreads(_ threads: [iPadThreadSummary]) -> [iPadThreadSummary] {
        threads.sorted { lhs, rhs in
            if lhs.isActive != rhs.isActive {
                return lhs.isActive && !rhs.isActive
            }
            return lhs.lastActivityAt > rhs.lastActivityAt
        }
    }

    private static func isActive(payload: [String: Any], event: BridgeRunEvent) -> Bool {
        if event.channel == .agentExit || event.channel == .geminiExit {
            return false
        }
        let marker = string(payload, keys: ["status", "state", "phase", "kind", "type"])?.lowercased() ?? ""
        if marker.contains("complete") || marker.contains("failed") || marker.contains("exit") || marker.contains("done") {
            return false
        }
        return marker.contains("active")
            || marker.contains("running")
            || marker.contains("started")
            || marker.contains("approval")
            || event.channel == .agentOutput
            || event.channel == .geminiOutput
    }

    private static func textPreview(from payload: [String: Any]) -> String? {
        guard let text = string(payload, keys: ["text", "message", "prompt", "description", "error"]) else {
            return nil
        }
        let compact = text
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !compact.isEmpty else { return nil }
        if compact.count > 54 {
            return String(compact.prefix(54)) + "..."
        }
        return compact
    }

    private static func dictionary(
        _ payload: [String: Any]?,
        keys: [String]
    ) -> [String: Any]? {
        guard let payload else { return nil }
        for key in keys {
            if let value = payload[key] as? [String: Any] {
                return value
            }
        }
        return nil
    }

    private static func string(
        _ payload: [String: Any]?,
        keys: [String]
    ) -> String? {
        guard let payload else { return nil }
        for key in keys {
            if let value = payload[key] as? String {
                return value
            }
            if let value = payload[key] as? CustomStringConvertible {
                return value.description
            }
        }
        return nil
    }

    private static func int(
        _ payload: [String: Any]?,
        keys: [String]
    ) -> Int? {
        guard let payload else { return nil }
        for key in keys {
            if let value = payload[key] as? Int {
                return value
            }
            if let value = payload[key] as? Double {
                return Int(value)
            }
            if let value = payload[key] as? String,
               let parsed = Int(value) {
                return parsed
            }
        }
        return nil
    }

    private static func better(_ lhs: String, _ rhs: String, fallback: String) -> String {
        let lhsTrimmed = lhs.trimmingCharacters(in: .whitespacesAndNewlines)
        let rhsTrimmed = rhs.trimmingCharacters(in: .whitespacesAndNewlines)
        if lhsTrimmed.isEmpty || lhsTrimmed == fallback {
            return rhsTrimmed.isEmpty ? lhs : rhs
        }
        return lhs
    }

    private static func betterOptional(_ lhs: String?, _ rhs: String?) -> String? {
        if let lhs = trimmed(lhs), !lhs.isEmpty {
            return lhs
        }
        return trimmed(rhs)
    }

    private static func trimmed(_ value: String?) -> String? {
        value?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func displayName(from id: String) -> String {
        let trimmedID = id.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedID.split(separator: "/").last.map(String.init) ?? trimmedID
    }
}
