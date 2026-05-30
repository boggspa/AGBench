import Foundation

enum SummaryBroadcastKind: Sendable, CaseIterable {
    case workspaceList
    case threadList
    case workspaceUpdated
    case threadUpdated

    var projectionKind: String {
        switch self {
        case .workspaceList: return "workspaceList"
        case .threadList: return "threadList"
        case .workspaceUpdated: return "workspaceUpdated"
        case .threadUpdated: return "threadUpdated"
        }
    }

    var channel: String {
        switch self {
        case .workspaceList: return "workspace-list"
        case .threadList: return "thread-list"
        case .workspaceUpdated: return "workspace-updated"
        case .threadUpdated: return "thread-updated"
        }
    }

    var rootKey: String {
        switch self {
        case .workspaceList: return "workspaces"
        case .threadList: return "threads"
        case .workspaceUpdated: return "workspace"
        case .threadUpdated: return "thread"
        }
    }
}

struct RemoteProjectionEvent: Sendable {
    let data: Data
    let threadID: String?
}

enum RemoteProjectionEnvelope {
    static let channel = "remote-projection"
}

enum SummaryBroadcasterError: Error, Equatable, CustomStringConvertible {
    case invalidParams(String)
    case encodingFailed(String)

    var description: String {
        switch self {
        case .invalidParams(let message): return message
        case .encodingFailed(let message): return message
        }
    }
}

actor SummaryBroadcaster {
    private let transportListener: TransportListener
    private let now: @Sendable () -> Date

    init(
        transportListener: TransportListener,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.transportListener = transportListener
        self.now = now
    }

    func broadcast(_ eventJSON: Data, threadID: String? = nil) async {
        await transportListener.broadcastRunEvent(eventJSON, threadID: threadID)
    }

    func makeEventJSON(kind: SummaryBroadcastKind, params: Any) throws -> Data {
        try Self.makeEventJSON(kind: kind, params: params, publishedAt: now())
    }

    static func makeEventJSON(
        kind: SummaryBroadcastKind,
        params: Any,
        publishedAt: Date
    ) throws -> Data {
        guard let payload = params as? [String: Any] else {
            throw SummaryBroadcasterError.invalidParams("Summary broadcast params must be a JSON object")
        }
        guard payload[kind.rootKey] != nil else {
            throw SummaryBroadcasterError.invalidParams("Summary broadcast params missing root key \"\(kind.rootKey)\"")
        }
        var event: [String: Any] = [
            "channel": RemoteProjectionEnvelope.channel,
            "kind": kind.projectionKind,
            "legacyChannel": kind.channel,
            "provider": "system",
            "payload": payload,
            "publishedAt": iso8601String(from: publishedAt)
        ]
        if let threadID = Self.threadID(kind: kind, params: params) {
            event["threadId"] = threadID
        }
        do {
            return try JSONSerialization.data(withJSONObject: event, options: [.sortedKeys])
        } catch {
            throw SummaryBroadcasterError.encodingFailed("Failed to encode summary broadcast: \(error.localizedDescription)")
        }
    }

    static func makeRemoteProjectionEventJSON(
        params: Any,
        publishedAt: Date
    ) throws -> RemoteProjectionEvent {
        guard let dict = params as? [String: Any] else {
            throw SummaryBroadcasterError.invalidParams("Remote projection params must be a JSON object")
        }
        if let envelope = dict["envelope"] {
            return try makeRemoteProjectionEnvelopeEventJSON(
                envelope: envelope,
                provider: dict["provider"] as? String,
                publishedAt: publishedAt
            )
        }
        guard let kind = dict["kind"] as? String, !kind.isEmpty else {
            throw SummaryBroadcasterError.invalidParams("Remote projection params missing kind")
        }
        guard let payload = (
            dict["payload"] as? [String: Any]
                ?? dict["snapshot"] as? [String: Any]
                ?? dict["projection"] as? [String: Any]
        ) else {
            throw SummaryBroadcasterError.invalidParams("Remote projection params missing payload object")
        }

        var event: [String: Any] = [
            "channel": RemoteProjectionEnvelope.channel,
            "kind": kind,
            "provider": (dict["provider"] as? String) ?? "system",
            "payload": payload,
            "publishedAt": (dict["publishedAt"] as? String) ?? iso8601String(from: publishedAt)
        ]
        let threadID = dict["threadId"] as? String
        if let threadID {
            event["threadId"] = threadID
        }
        do {
            return RemoteProjectionEvent(
                data: try JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]),
                threadID: threadID
            )
        } catch {
            throw SummaryBroadcasterError.encodingFailed("Failed to encode remote projection broadcast: \(error.localizedDescription)")
        }
    }

    static func makeRemoteProjectionEnvelopeEventJSON(
        envelope: Any,
        provider: String? = nil,
        publishedAt: Date
    ) throws -> RemoteProjectionEvent {
        guard let envelopeDict = envelope as? [String: Any] else {
            throw SummaryBroadcasterError.invalidParams("Remote projection envelope must be a JSON object")
        }
        guard let kind = envelopeDict["kind"] as? String, !kind.isEmpty else {
            throw SummaryBroadcasterError.invalidParams("Remote projection envelope missing kind")
        }
        var event: [String: Any] = [
            "channel": RemoteProjectionEnvelope.channel,
            "kind": kind,
            "provider": provider ?? "system",
            "payload": envelopeDict,
            "publishedAt": (envelopeDict["publishedAt"] as? String)
                ?? (envelopeDict["generatedAt"] as? String)
                ?? iso8601String(from: publishedAt)
        ]
        let threadID = threadID(inRemoteProjectionEnvelope: envelopeDict)
        if let threadID {
            event["threadId"] = threadID
        }
        do {
            return RemoteProjectionEvent(
                data: try JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]),
                threadID: threadID
            )
        } catch {
            throw SummaryBroadcasterError.encodingFailed("Failed to encode remote projection envelope: \(error.localizedDescription)")
        }
    }

    static func makeRemoteProjectionSnapshotEvents(
        params: Any,
        publishedAt: Date
    ) throws -> [RemoteProjectionEvent] {
        guard let dict = params as? [String: Any] else {
            throw SummaryBroadcasterError.invalidParams("Remote projection snapshot params must be a JSON object")
        }
        guard let projections = dict["projections"] as? [Any] else {
            throw SummaryBroadcasterError.invalidParams("Remote projection snapshot params missing projections array")
        }
        let provider = dict["provider"] as? String
        return try projections.map { projection in
            try makeRemoteProjectionEnvelopeEventJSON(
                envelope: projection,
                provider: provider,
                publishedAt: publishedAt
            )
        }
    }

    static func threadID(kind: SummaryBroadcastKind, params: Any) -> String? {
        guard kind == .threadUpdated,
              let payload = params as? [String: Any],
              let thread = payload["thread"] as? [String: Any] else {
            return nil
        }
        return thread["chatId"] as? String ?? thread["threadId"] as? String
    }

    private static func threadID(inRemoteProjectionEnvelope envelope: [String: Any]) -> String? {
        if let threadID = envelope["threadId"] as? String {
            return threadID
        }
        if let threadID = envelope["threadID"] as? String {
            return threadID
        }
        if let threadID = envelope["chatId"] as? String {
            return threadID
        }
        guard let payload = envelope["payload"] as? [String: Any] else {
            return nil
        }
        return payload["threadId"] as? String
            ?? payload["threadID"] as? String
            ?? payload["chatId"] as? String
            ?? payload["appChatId"] as? String
    }

    private static func iso8601String(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
