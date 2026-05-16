import Foundation

#if os(iOS) && canImport(ActivityKit)
import ActivityKit
#endif

public enum AGBenchRunActivityStatus: String, Codable, Hashable, Sendable {
    case running
    case completed
    case failed
    case cancelled

    public var isFinal: Bool {
        switch self {
        case .running:
            return false
        case .completed, .failed, .cancelled:
            return true
        }
    }
}

public struct AGBenchRunActivityAttributes: Codable, Hashable, Sendable {
    public struct ContentState: Codable, Hashable, Sendable {
        public var status: AGBenchRunActivityStatus
        public var lastEventSummary: String?
        public var toolCallsCount: Int
        public var durationS: Int
        public var pendingApprovalCount: Int

        public init(
            status: AGBenchRunActivityStatus,
            lastEventSummary: String? = nil,
            toolCallsCount: Int = 0,
            durationS: Int = 0,
            pendingApprovalCount: Int = 0
        ) {
            self.status = status
            self.lastEventSummary = lastEventSummary
            self.toolCallsCount = max(0, toolCallsCount)
            self.durationS = max(0, durationS)
            self.pendingApprovalCount = max(0, pendingApprovalCount)
        }
    }

    public var runId: String
    public var provider: String
    public var workspaceName: String
    public var threadTitle: String

    public init(
        runId: String,
        provider: String,
        workspaceName: String,
        threadTitle: String
    ) {
        self.runId = runId
        self.provider = provider
        self.workspaceName = workspaceName
        self.threadTitle = threadTitle
    }
}

#if os(iOS) && canImport(ActivityKit)
extension AGBenchRunActivityAttributes: ActivityAttributes {}
#endif
