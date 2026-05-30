import Foundation

/// BridgeRunEvent — iOS-side decoded shape for run events streamed
/// from the desktop bridge daemon.
///
/// Wire path:
///   Desktop agent emits an output event
///     → main process `publishRunEvent(...)` puts it on `runEventBus`
///     → `BridgeRunEventSink` forwards to daemon as `bridge.runEvent`
///       JSON-RPC notification
///     → Swift daemon's `bridge.runEvent` handler re-encodes the params
///       as JSON bytes and broadcasts via `LANBridgeServer.broadcast`
///       wrapped in `BridgeTransportPayload.eventRecord(Data)`
///     → iOS receives the eventRecord bytes off its QUIC connection
///     → this type decodes them
///
/// The wire payload mirrors the source RunEvent shape from the desktop:
///
///   {
///     "channel": "agent-output",
///     "provider": "gemini",
///     "payload": { ...routed agent event... },
///     "publishedAt": "2026-05-15T..."
///   }
///
/// `payload` is left as `Data` (raw JSON bytes) — UI code decodes the
/// inner shape lazily based on `channel`. This matches the desktop's
/// fan-out, which doesn't enforce a single typed payload schema across
/// providers / event kinds.
public struct BridgeRunEvent: Sendable, Equatable {
    public enum Channel: String, Sendable, Equatable {
        case agentOutput = "agent-output"
        case agentError = "agent-error"
        case agentExit = "agent-exit"
        case geminiOutput = "gemini-output"
        case geminiError = "gemini-error"
        case geminiExit = "gemini-exit"
        // Workspace + thread summary broadcasts emitted by the desktop's
        // BridgeBroadcaster when the AppStore mutates. iOS decodes these
        // via BridgeWorkspaceSummariesDecoder and routes them into
        // iPadSidebarStore.applyWorkspaceList(_:) etc.
        case workspaceList = "workspace-list"
        case workspaceUpdated = "workspace-updated"
        case threadList = "thread-list"
        case threadUpdated = "thread-updated"
        case remoteProjection = "remote-projection"
    }

    public let channel: Channel
    /// Provider id (e.g. `gemini`, `codex`, `claude`, `kimi`). Mirrors the
    /// desktop's ProviderId enum but kept loose here since iOS needs to
    /// tolerate new providers added desktop-side without rebuild.
    public let provider: String
    /// Raw payload JSON bytes. Decode with `BridgeRunEvent.decodePayload(...)`
    /// when you know the channel's expected shape, OR display as raw text
    /// via the convenience accessors below.
    public let payloadJSON: Data
    public let publishedAt: Date

    public init(channel: Channel, provider: String, payloadJSON: Data, publishedAt: Date) {
        self.channel = channel
        self.provider = provider
        self.payloadJSON = payloadJSON
        self.publishedAt = publishedAt
    }
}

public enum BridgeRunEventDecodeError: Error, Equatable, Sendable {
    case malformedJSON(String)
    case missingField(String)
    case unknownChannel(String)
    case invalidDate(String)
}

extension BridgeRunEvent {
    /// Decode a `BridgeTransportPayload.eventRecord(Data)`'s inner bytes
    /// (a JSON object with channel/provider/payload/publishedAt) into a
    /// typed `BridgeRunEvent`. Unknown channels surface as
    /// `unknownChannel` errors so UI can defensively skip-and-log
    /// without crashing.
    public static func decode(eventRecordBytes: Data) throws -> BridgeRunEvent {
        guard
            let object = try? JSONSerialization.jsonObject(with: eventRecordBytes),
            let dict = object as? [String: Any]
        else {
            throw BridgeRunEventDecodeError.malformedJSON("event record JSON is not a top-level object")
        }
        guard let channelString = dict["channel"] as? String else {
            throw BridgeRunEventDecodeError.missingField("channel")
        }
        guard let channel = Channel(rawValue: channelString) else {
            throw BridgeRunEventDecodeError.unknownChannel(channelString)
        }
        guard let provider = dict["provider"] as? String else {
            throw BridgeRunEventDecodeError.missingField("provider")
        }
        guard let publishedAtString = dict["publishedAt"] as? String else {
            throw BridgeRunEventDecodeError.missingField("publishedAt")
        }
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let publishedAt: Date
        if let date = isoFormatter.date(from: publishedAtString) {
            publishedAt = date
        } else {
            // Fall back to no-fractional-seconds variant.
            isoFormatter.formatOptions = [.withInternetDateTime]
            guard let date = isoFormatter.date(from: publishedAtString) else {
                throw BridgeRunEventDecodeError.invalidDate(publishedAtString)
            }
            publishedAt = date
        }
        // Re-encode the `payload` subtree as JSON bytes for opaque pass-through.
        let payloadJSON: Data
        if let payloadAny = dict["payload"] {
            do {
                payloadJSON = try JSONSerialization.data(
                    withJSONObject: payloadAny,
                    options: [.sortedKeys, .fragmentsAllowed]
                )
            } catch {
                throw BridgeRunEventDecodeError.malformedJSON("payload subtree non-serializable: \(error.localizedDescription)")
            }
        } else {
            // Missing payload → treat as null JSON.
            payloadJSON = Data("null".utf8)
        }
        return BridgeRunEvent(
            channel: channel,
            provider: provider,
            payloadJSON: payloadJSON,
            publishedAt: publishedAt
        )
    }

    /// Convenience: decode the payload as `[String: Any]` for UI rendering.
    /// Returns nil if the payload is null or non-object. Use sparingly —
    /// the UI should typically know its expected shape and decode to a
    /// typed struct via JSONDecoder.
    public func payloadDictionary() -> [String: Any]? {
        guard let object = try? JSONSerialization.jsonObject(with: payloadJSON) else { return nil }
        return object as? [String: Any]
    }
}
