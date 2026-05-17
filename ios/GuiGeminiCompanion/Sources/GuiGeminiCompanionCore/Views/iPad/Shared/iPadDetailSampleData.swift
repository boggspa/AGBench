import Foundation

/// MOCK: Deterministic sample-data factory for `iPadDetailHost` previews
/// and the mocked variants used when the desktop bridge hasn't yet
/// fanned a workspace summary down to the iPad. Every value is fixed so
/// SwiftUI previews stay diff-stable.
///
/// TODO: Replace these placeholders once the bridge starts broadcasting
/// real workspace / commit / event payloads. Each call site should fall
/// back to the real (empty) state when `mocked == false`.
@available(iOS 17.0, macOS 14.0, *)
public enum iPadDetailSampleData {

    // MARK: - Stable reference clock

    /// Anchor moment used by every mocked timestamp so previews are
    /// repeatable. Picked to match the cutoff date used elsewhere in the
    /// codebase — May 16, 2026 12:34 local.
    public static let referenceDate: Date = {
        var components = DateComponents()
        components.calendar = Calendar(identifier: .gregorian)
        components.timeZone = TimeZone(identifier: "UTC")
        components.year = 2026
        components.month = 5
        components.day = 16
        components.hour = 12
        components.minute = 34
        components.second = 0
        return components.date ?? Date(timeIntervalSince1970: 1_747_399_200)
    }()

    // MARK: - Workspace pane

    public struct WorkspaceMock: Sendable, Equatable {
        public let summary: iPadWorkspaceSummary
        public let recentThreads: [iPadThreadSummary]
        public let runningCount: Int
        public let chatCount: Int
        public let pairedMacName: String
        public let lastCommit: CommitMock?
        public let lastDiff: DiffMock?

        public init(
            summary: iPadWorkspaceSummary,
            recentThreads: [iPadThreadSummary],
            runningCount: Int,
            chatCount: Int,
            pairedMacName: String,
            lastCommit: CommitMock?,
            lastDiff: DiffMock?
        ) {
            self.summary = summary
            self.recentThreads = recentThreads
            self.runningCount = runningCount
            self.chatCount = chatCount
            self.pairedMacName = pairedMacName
            self.lastCommit = lastCommit
            self.lastDiff = lastDiff
        }
    }

    public struct CommitMock: Sendable, Equatable {
        public let shortHash: String
        public let summary: String
        public let author: String
        public let relativeTimeText: String

        public init(shortHash: String, summary: String, author: String, relativeTimeText: String) {
            self.shortHash = shortHash
            self.summary = summary
            self.author = author
            self.relativeTimeText = relativeTimeText
        }
    }

    public struct DiffMock: Sendable, Equatable {
        public let path: String
        public let plusLines: Int
        public let minusLines: Int
        public let relativeTimeText: String

        public init(path: String, plusLines: Int, minusLines: Int, relativeTimeText: String) {
            self.path = path
            self.plusLines = plusLines
            self.minusLines = minusLines
            self.relativeTimeText = relativeTimeText
        }
    }

    public static func workspace(id: String = "workspace-sample") -> WorkspaceMock {
        let summary = iPadWorkspaceSummary(
            id: id,
            displayName: "AGBench",
            pathDisplayHint: "~/Developer/AGBench",
            branchName: "main",
            permissionMode: "approval-mode: review",
            dirtyFileCount: 3,
            isActive: true
        )
        return WorkspaceMock(
            summary: summary,
            recentThreads: sampleThreads(workspaceID: id),
            runningCount: 2,
            chatCount: 7,
            pairedMacName: "Chris' MacBook Pro",
            lastCommit: CommitMock(
                shortHash: "f08c52d",
                summary: "Align branch bar with composer themes",
                author: "Chris Izatt",
                relativeTimeText: "12 min ago"
            ),
            lastDiff: DiffMock(
                path: "src/renderer/components/RunInspector.tsx",
                plusLines: 24,
                minusLines: 8,
                relativeTimeText: "4 min ago"
            )
        )
    }

    public static func sampleThreads(workspaceID: String) -> [iPadThreadSummary] {
        let calendar = Calendar(identifier: .gregorian)
        func offsetSeconds(_ seconds: TimeInterval) -> Date {
            calendar.date(byAdding: .second, value: Int(-seconds), to: referenceDate) ?? referenceDate
        }
        return [
            iPadThreadSummary(
                id: "thread-mock-1",
                workspaceID: workspaceID,
                title: "Polish iPad shell",
                subtitle: "running · file_edit · iPadDetailHost.swift",
                provider: "claude",
                runID: "run-mock-1",
                lastActivityAt: offsetSeconds(35),
                isActive: true
            ),
            iPadThreadSummary(
                id: "thread-mock-2",
                workspaceID: workspaceID,
                title: "Wire workspace summaries through bridge",
                subtitle: "approval needed · bridge/runEventBus.ts",
                provider: "codex",
                runID: "run-mock-2",
                lastActivityAt: offsetSeconds(180),
                isActive: true
            ),
            iPadThreadSummary(
                id: "thread-mock-3",
                workspaceID: workspaceID,
                title: "Live activity glance fixtures",
                subtitle: "complete · 14 events",
                provider: "gemini",
                runID: "run-mock-3",
                lastActivityAt: offsetSeconds(1_220),
                isActive: false
            ),
            iPadThreadSummary(
                id: "thread-mock-4",
                workspaceID: workspaceID,
                title: "Reorder approval queue",
                subtitle: "complete · 6 events",
                provider: "claude",
                runID: "run-mock-4",
                lastActivityAt: offsetSeconds(4_870),
                isActive: false
            ),
            iPadThreadSummary(
                id: "thread-mock-5",
                workspaceID: workspaceID,
                title: "Restore-checkpoint scratchpad",
                subtitle: "complete · 21 events",
                provider: "kimi",
                runID: "run-mock-5",
                lastActivityAt: offsetSeconds(36_300),
                isActive: false
            )
        ]
    }

    // MARK: - Thread pane (K1 RunInspector mirror)

    public enum EventKind: String, Sendable {
        case lifecycle
        case tool
        case reply
        case approvalRequest
        case approvalResponse
        case fileEdit
        case diff
        case subThread
        case providerError
        case providerExit
    }

    public struct EventRowMock: Identifiable, Sendable, Equatable {
        public let id: String
        public let publishedAt: Date
        public let kind: EventKind
        public let label: String
        public let summary: String
        public let path: String?
        public let provider: String?

        public init(
            id: String,
            publishedAt: Date,
            kind: EventKind,
            label: String,
            summary: String,
            path: String? = nil,
            provider: String? = nil
        ) {
            self.id = id
            self.publishedAt = publishedAt
            self.kind = kind
            self.label = label
            self.summary = summary
            self.path = path
            self.provider = provider
        }
    }

    public static let sampleEventRows: [EventRowMock] = {
        let calendar = Calendar(identifier: .gregorian)
        func offsetSeconds(_ seconds: TimeInterval) -> Date {
            calendar.date(byAdding: .second, value: Int(-seconds), to: referenceDate) ?? referenceDate
        }
        return [
            EventRowMock(
                id: "ev-1",
                publishedAt: offsetSeconds(220),
                kind: .lifecycle,
                label: "Started",
                summary: "Run dispatched · provider claude",
                provider: "claude"
            ),
            EventRowMock(
                id: "ev-2",
                publishedAt: offsetSeconds(208),
                kind: .reply,
                label: "Reply",
                summary: "Planning the iPad detail host pass…",
                provider: "claude"
            ),
            EventRowMock(
                id: "ev-3",
                publishedAt: offsetSeconds(186),
                kind: .tool,
                label: "Tool",
                summary: "read · iPadDetailHost.swift",
                path: "Views/iPad/iPadDetailHost.swift",
                provider: "claude"
            ),
            EventRowMock(
                id: "ev-4",
                publishedAt: offsetSeconds(164),
                kind: .approvalRequest,
                label: "Approval",
                summary: "Approve write to Detail/WorkspaceSummaryCard.swift",
                path: "Views/iPad/Detail/WorkspaceSummaryCard.swift",
                provider: "claude"
            ),
            EventRowMock(
                id: "ev-5",
                publishedAt: offsetSeconds(160),
                kind: .approvalResponse,
                label: "Decision",
                summary: "accepted (workspace)",
                provider: "claude"
            ),
            EventRowMock(
                id: "ev-6",
                publishedAt: offsetSeconds(132),
                kind: .fileEdit,
                label: "Edit",
                summary: "iPadDetailHost.swift · +84 / -18",
                path: "Views/iPad/iPadDetailHost.swift",
                provider: "claude"
            ),
            EventRowMock(
                id: "ev-7",
                publishedAt: offsetSeconds(96),
                kind: .diff,
                label: "Diff",
                summary: "iPadDetailHost.swift",
                path: "Views/iPad/iPadDetailHost.swift",
                provider: "claude"
            ),
            EventRowMock(
                id: "ev-8",
                publishedAt: offsetSeconds(48),
                kind: .subThread,
                label: "Sub-thread",
                summary: "→ codex: extract sample-data helper",
                provider: "codex"
            ),
            EventRowMock(
                id: "ev-9",
                publishedAt: offsetSeconds(12),
                kind: .reply,
                label: "Reply",
                summary: "All workspace + thread panes wired against MOCK data.",
                provider: "claude"
            )
        ]
    }()

    public static func sampleEventPreviewRow() -> EventRowMock {
        sampleEventRows.first ?? EventRowMock(
            id: "ev-fallback",
            publishedAt: referenceDate,
            kind: .lifecycle,
            label: "Started",
            summary: "Sample preview row",
            provider: "claude"
        )
    }

    // MARK: - Empty-pane teaching cards

    public struct TeachingCard: Sendable, Equatable, Identifiable {
        public var id: String { systemImage }
        public let systemImage: String
        public let title: String
        public let body: String

        public init(systemImage: String, title: String, body: String) {
            self.systemImage = systemImage
            self.title = title
            self.body = body
        }
    }

    public static let emptyPaneTeachingCards: [TeachingCard] = [
        TeachingCard(
            systemImage: "folder.fill.badge.gearshape",
            title: "Tap a workspace",
            body: "See recent threads, the latest commit, and uncommitted file counts mirrored from the Mac."
        ),
        TeachingCard(
            systemImage: "waveform.path.ecg.rectangle",
            title: "Tap a thread",
            body: "Live tool activity, approvals, replies and diffs stream as a dense timeline."
        ),
        TeachingCard(
            systemImage: "checkmark.shield.fill",
            title: "Watch the approval queue",
            body: "The right-hand inspector raises pending tool approvals and read-only diffs as runs progress."
        )
    ]

    // MARK: - Helpers

    public static func sampleThread(workspaceID: String = "workspace-sample") -> iPadThreadSummary {
        sampleThreads(workspaceID: workspaceID).first ?? iPadThreadSummary(
            id: "thread-mock-1",
            workspaceID: workspaceID,
            title: "Sample thread",
            subtitle: "running",
            provider: "claude",
            lastActivityAt: referenceDate,
            isActive: true
        )
    }
}
