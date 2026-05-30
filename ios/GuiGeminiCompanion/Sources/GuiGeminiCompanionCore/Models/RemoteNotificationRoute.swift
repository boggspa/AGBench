import Foundation

/// Privacy-safe routing identifiers carried in an APNs payload.
///
/// The push body may contain user-visible alert text under `aps`, but the
/// companion only reads ids needed to reconnect and ask the bridge for the
/// current projection truth. File paths, prompts, approval bodies, and other
/// descriptive text are intentionally not modeled here.
public struct RemoteNotificationRoute: Codable, Sendable, Equatable {
    public let kind: String?
    public let workspaceId: String?
    public let threadId: String?
    public let taskId: String?
    public let runId: String?
    public let approvalId: String?
    public let questionId: String?

    public init(
        kind: String? = nil,
        workspaceId: String? = nil,
        threadId: String? = nil,
        taskId: String? = nil,
        runId: String? = nil,
        approvalId: String? = nil,
        questionId: String? = nil
    ) {
        self.kind = Self.trimmed(kind)
        self.workspaceId = Self.trimmed(workspaceId)
        self.threadId = Self.trimmed(threadId)
        self.taskId = Self.trimmed(taskId)
        self.runId = Self.trimmed(runId)
        self.approvalId = Self.trimmed(approvalId)
        self.questionId = Self.trimmed(questionId)
    }

    public init?(userInfo: [AnyHashable: Any]) {
        let dictionaries = Self.routeDictionaries(in: userInfo)
        let route = RemoteNotificationRoute(
            kind: Self.firstString(in: dictionaries, keys: ["routeKind", "notificationKind", "kind", "type", "projectionKind"]),
            workspaceId: Self.firstString(in: dictionaries, keys: ["workspaceId", "workspaceID", "workspace_id"]),
            threadId: Self.firstString(in: dictionaries, keys: ["threadId", "threadID", "thread_id", "chatId", "appChatId"]),
            taskId: Self.firstString(in: dictionaries, keys: ["taskId", "taskID"]),
            runId: Self.firstString(in: dictionaries, keys: ["runId", "runID", "appRunId", "appRunID"]),
            approvalId: Self.firstString(in: dictionaries, keys: ["approvalId", "approvalID", "toolCallId", "callId"]),
            questionId: Self.firstString(in: dictionaries, keys: ["questionId", "questionID", "promptId"])
        )
        guard route.hasRoutingIdentifier else { return nil }
        self = route
    }

    public var hasRoutingIdentifier: Bool {
        workspaceId != nil
            || threadId != nil
            || taskId != nil
            || runId != nil
            || approvalId != nil
            || questionId != nil
    }

    public var watchedThreadIds: [String] {
        guard let threadId else { return [] }
        return [threadId]
    }

    private static func routeDictionaries(in userInfo: [AnyHashable: Any]) -> [[String: Any]] {
        let root = normalizeDictionary(userInfo) ?? [:]
        var dictionaries = [root]
        let containerKeys = [
            "route",
            "routing",
            "remoteRoute",
            "remoteRouting",
            "data",
            "payload",
            "projection",
            "remote"
        ]
        for key in containerKeys {
            if let nested = normalizeDictionary(root[key]) {
                dictionaries.append(nested)
            }
        }
        let firstLevelDictionaries = Array(dictionaries.dropFirst())
        for dictionary in firstLevelDictionaries {
            for key in ["route", "routing", "remoteRoute", "remoteRouting"] {
                if let nested = normalizeDictionary(dictionary[key]) {
                    dictionaries.append(nested)
                }
            }
        }
        return dictionaries
    }

    private static func firstString(in dictionaries: [[String: Any]], keys: [String]) -> String? {
        for dictionary in dictionaries {
            for key in keys {
                if let value = trimmed(stringValue(dictionary[key])) {
                    return value
                }
            }
        }
        return nil
    }

    private static func normalizeDictionary(_ value: Any?) -> [String: Any]? {
        if let dictionary = value as? [String: Any] {
            return dictionary
        }
        guard let dictionary = value as? [AnyHashable: Any] else {
            return nil
        }
        var normalized: [String: Any] = [:]
        for (key, value) in dictionary {
            normalized[String(describing: key)] = value
        }
        return normalized
    }

    private static func stringValue(_ value: Any?) -> String? {
        switch value {
        case let value as String:
            return value
        case let value as NSNumber where CFGetTypeID(value) != CFBooleanGetTypeID():
            return value.stringValue
        default:
            return nil
        }
    }

    private static func trimmed(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }
}
