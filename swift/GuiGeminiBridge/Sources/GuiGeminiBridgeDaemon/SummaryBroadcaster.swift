import Foundation

enum SummaryBroadcastKind: Sendable, CaseIterable {
    case workspaceList
    case threadList
    case workspaceUpdated
    case threadUpdated

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

    func broadcast(_ eventJSON: Data) async {
        await transportListener.broadcastRunEvent(eventJSON)
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
        let event: [String: Any] = [
            "channel": kind.channel,
            "provider": "system",
            "payload": payload,
            "publishedAt": iso8601String(from: publishedAt)
        ]
        do {
            return try JSONSerialization.data(withJSONObject: event, options: [.sortedKeys])
        } catch {
            throw SummaryBroadcasterError.encodingFailed("Failed to encode summary broadcast: \(error.localizedDescription)")
        }
    }

    private static func iso8601String(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
