import Foundation
import BridgeCore
import BridgeCryptoPrimitives
import BridgeCryptoPairing
import BridgeLANTransport

/// Lifecycle wrapper for the QUIC + Bonjour listener that accepts paired iOS
/// clients.
///
/// Phase C3 v1 stops here:
///   - Reads active `TrustedDeviceRecord`s from `TrustedDeviceStore`.
///   - For each, loads the persisted `PairingDerivedKeys` via `PairSecretsStore`.
///   - Builds the `[LANBridgeServer.TrustedController]` list expected by
///     `QUICBridgeServer.init`.
///   - Starts the server (`start()` binds the QUIC port + publishes Bonjour).
///   - Wires placeholder handlers (logging only) so accepted connections
///     don't crash, but no actual bridge work happens yet.
///
/// Phase C3-late wires the handlers to GUIGemini's RunService via JSON-RPC
/// notifications back to Electron (`bridge.actionWake`, `bridge.actionRecord`,
/// etc. as server-pushed notifications).
public actor TransportListener {
    public struct Status: Sendable, Encodable {
        public let running: Bool
        public let bonjourServiceType: String
        public let port: UInt16?
        public let tailnetIPv4: String?
        public let tailnetEndpoint: String?
        public let tailnetListenerRunning: Bool
        public let activeRouteCount: Int
        public let routeHints: [String]
        public let tailnetSessionCount: Int
        public let trustedControllerCount: Int
        public let watchedPairCount: Int
        public let watchedSeenPairCount: Int
        public let watchedThreadSubscriptionCount: Int
        public let lastWatchedThreadSeenAt: Date?
        public let lastSnapshotRequestedAt: Date?
        public let snapshotRequestCount: Int
        public let lastRunEventBroadcastAt: Date?
        public let runEventBroadcastCount: Int
        public let lastRunEventThreadID: String?
        public let lastActionAckLatencyMs: Double?
        public let lastActionAckAccepted: Bool?
        public let lastPrepareAckLatencyMs: Double?
        public let lastPrepareAckAccepted: Bool?
        public let lastError: String?
    }

    public enum TransportListenerError: Error, CustomStringConvertible {
        case alreadyRunning
        case notRunning
        case noTrustedDevices
        case underlying(Error)

        public var description: String {
            switch self {
            case .alreadyRunning: return "Transport listener is already running"
            case .notRunning: return "Transport listener is not running"
            case .noTrustedDevices: return "No trusted devices — pair an iOS device before starting the listener"
            case .underlying(let err): return "Underlying transport error: \(err.localizedDescription)"
            }
        }
    }

    private let deviceStore: TrustedDeviceStore
    private let secretStore: SecretStore
    private let macDeviceID: DeviceID
    private let notifier: BridgeNotifier
    private let requester: BridgeRequester
    private let watchedThreadsStore: WatchedThreadsStore
    private let ackTimeoutSeconds: TimeInterval
    private let watchedThreadStaleInterval: TimeInterval
    private let tailscaleEndpointProvider: @Sendable () -> TailscaleEndpoint

    private var server: QUICBridgeServer?
    private var tailnetServer: EndpointBoundQUICBridgeServer?
    private var activeTailnetEndpoint: TailscaleEndpoint?
    private var lastErrorMessage: String?
    private var trustedControllerCount: Int = 0
    private var lastSnapshotRequestedAt: Date?
    private var snapshotRequestCount: Int = 0
    private var lastRunEventBroadcastAt: Date?
    private var runEventBroadcastCount: Int = 0
    private var lastRunEventThreadID: String?
    private var lastActionAckLatencyMs: Double?
    private var lastActionAckAccepted: Bool?
    private var lastPrepareAckLatencyMs: Double?
    private var lastPrepareAckAccepted: Bool?

    public init(
        deviceStore: TrustedDeviceStore,
        secretStore: SecretStore,
        macDeviceID: DeviceID,
        notifier: BridgeNotifier,
        requester: BridgeRequester,
        watchedThreadsStore: WatchedThreadsStore = WatchedThreadsStore(),
        tailscaleEndpointProvider: @escaping @Sendable () -> TailscaleEndpoint = { TailscaleEndpoint() },
        ackTimeoutSeconds: TimeInterval = 10.0,
        watchedThreadStaleInterval: TimeInterval = 6 * 60 * 60
    ) {
        self.deviceStore = deviceStore
        self.secretStore = secretStore
        self.macDeviceID = macDeviceID
        self.notifier = notifier
        self.requester = requester
        self.watchedThreadsStore = watchedThreadsStore
        self.tailscaleEndpointProvider = tailscaleEndpointProvider
        self.ackTimeoutSeconds = ackTimeoutSeconds
        self.watchedThreadStaleInterval = watchedThreadStaleInterval
    }

    public func start() async throws {
        if server != nil {
            throw TransportListenerError.alreadyRunning
        }

        let controllers = try await loadTrustedControllers()
        logQUICPipeline("start requested trustedControllers=\(controllers.count)")
        if controllers.isEmpty {
            // Surface this as a structured error so the UI can show "pair first"
            // instead of letting the listener bind to a port no one can connect to.
            logQUICPipeline("start refused reason=no-trusted-devices")
            throw TransportListenerError.noTrustedDevices
        }

        let cfg = BridgeProductConfiguration.current

        // Capture collaborators locally so the @Sendable handler closures can
        // call them without hopping back through the actor. All three are
        // Sendable + internally serialized, so concurrent calls from
        // different connections are safe.
        let notifier = self.notifier
        let requester = self.requester
        let watchedThreadsStore = self.watchedThreadsStore
        let ackTimeout = self.ackTimeoutSeconds

        let handlers = LANBridgeServer.Handlers(
            onActionWake: { [self] recordName, pairID in
                await self.logHandler(
                    "onActionWake recordName=\(recordName) pairID=\(pairID.rawValue)"
                )
                notifier.publish(method: "bridge.didReceiveActionWake", params: [
                    "recordName": recordName,
                    "pairID": pairID.rawValue
                ])
            },
            onActionRecord: { [self] payloadData, pairID, controllerDeviceID in
                // CodexBridge dep-drift fix: `controllerDeviceID` is
                // a new (third) closure parameter from the upstream
                // `LANBridgeServer.Handlers.onActionRecord` signature
                // — the device id that sent this RemoteAction over the
                // direct path (distinct from the pair id when a single
                // pair has multiple controllers). We log it for the
                // notification fan-out but otherwise treat it as
                // opaque; the rest of the action handling pipeline
                // continues to key on pair id.
                await self.logHandler(
                    "onActionRecord pairID=\(pairID.rawValue) controllerDeviceID=\(controllerDeviceID.rawValue) payloadBytes=\(payloadData.count)"
                )
                // Always notify (informational). The notification fires
                // regardless of whether the round-trip request below succeeds.
                let payloadBase64 = payloadData.base64EncodedString()
                let payloadBytes = payloadData.count
                let pairIDString = pairID.rawValue
                notifier.publish(method: "bridge.didReceiveActionRecord", params: [
                    "pairID": pairIDString,
                    "payloadBytes": payloadBytes,
                    "payloadBase64": payloadBase64
                ])
                // Ask Electron via JSON-RPC request for a real semantic ack.
                // Preserve BridgeCore-backed fields when Electron sends them
                // (`actionID`, `state`, `executed`, `scope`, `data`, etc.)
                // instead of collapsing the response to accepted/message.
                let ackRequestedAt = Date()
                let ackParams: [String: Any] = [
                    "pairID": pairIDString,
                    "payloadBytes": payloadBytes,
                    "payloadBase64": payloadBase64
                ]
                guard let ackParamsJSON = try? JSONSerialization.data(
                    withJSONObject: ackParams,
                    options: [.sortedKeys]
                ) else {
                    return await self.actionAckFallback(
                        message: "Phase C3.5 fallback — failed to encode ack request",
                        requestedAt: ackRequestedAt
                    )
                }
                do {
                    let resultData = try await requester.request(
                        method: "bridge.requestActionAck",
                        paramsJSON: ackParamsJSON,
                        timeoutSeconds: ackTimeout
                    )
                    let decodedAt = Date()
                    let ack = try BridgeAckDecoding.actionAck(
                        from: resultData,
                        payloadData: payloadData,
                        pairID: pairIDString,
                        receivedAt: decodedAt
                    )
                    await self.recordActionAckStatus(
                        accepted: ack.accepted,
                        latencySeconds: decodedAt.timeIntervalSince(ackRequestedAt)
                    )
                    let unknown = BridgeAckDecoding.unknownActionAckFields(in: resultData)
                    if !unknown.isEmpty {
                        FileHandle.standardError.write(Data(
                            "[TransportListener] WARN: action ack carried unknown fields: \(unknown.sorted().joined(separator: ","))\n".utf8
                        ))
                    }
                    return ack
                } catch let err as BridgeAckDecoding.AckDecodeError {
                    FileHandle.standardError.write(Data(
                        "[TransportListener] WARN: onActionRecord ack decode failed: \(err.description) — denying\n".utf8
                    ))
                } catch let err as BridgeRequester.RequesterError {
                    // -32601 methodNotFound (no Electron handler yet) is the
                    // expected case during the C3.5 rollout — log once and
                    // fall back. Timeout / encoding errors are rarer and log
                    // their own description.
                    FileHandle.standardError.write(Data(
                        "[TransportListener] onActionRecord ack request not answered: \(err.description)\n".utf8
                    ))
                } catch {
                    FileHandle.standardError.write(Data(
                        "[TransportListener] onActionRecord ack request error: \(error.localizedDescription)\n".utf8
                    ))
                }
                return await self.actionAckFallback(
                    message: "Phase C3.5 fallback — Electron handler not yet wired",
                    requestedAt: ackRequestedAt
                )
            },
            onPrepareStartTurn: { [self] request, pairID in
                await self.logHandler(
                    "onPrepareStartTurn workspaceID=\(request.workspaceID.rawValue) pairID=\(pairID.rawValue)"
                )
                // Build params conditionally so an absent threadID becomes
                // an omitted key on the wire (Foundation can't bridge a Swift
                // optional into a JSON object cleanly).
                var prepareParams: [String: Any] = [
                    "pairID": pairID.rawValue,
                    "prepareID": request.prepareID,
                    "workspaceID": request.workspaceID.rawValue
                ]
                if let threadID = request.threadID {
                    prepareParams["threadID"] = threadID.rawValue
                }
                notifier.publish(method: "bridge.didReceivePrepareStartTurn", params: prepareParams)
                // Ask Electron via JSON-RPC request for a real ack. The route
                // identifiers stay anchored to the request, but BridgeCore's
                // typed timing/error fields are preserved when Electron sends
                // them.
                let ackRequestedAt = Date()
                guard let prepareParamsJSON = try? JSONSerialization.data(
                    withJSONObject: prepareParams,
                    options: [.sortedKeys]
                ) else {
                    return await self.prepareStartTurnAckFallback(
                        request: request,
                        message: "Phase C3.5 fallback — failed to encode ack request",
                        requestedAt: ackRequestedAt
                    )
                }
                do {
                    let resultData = try await requester.request(
                        method: "bridge.requestPrepareStartTurnAck",
                        paramsJSON: prepareParamsJSON,
                        timeoutSeconds: ackTimeout
                    )
                    let decodedAt = Date()
                    let ack = try BridgeAckDecoding.prepareStartTurnAck(
                        from: resultData,
                        request: request,
                        receivedAt: decodedAt
                    )
                    await self.recordPrepareAckStatus(
                        accepted: ack.accepted,
                        latencySeconds: decodedAt.timeIntervalSince(ackRequestedAt)
                    )
                    return ack
                } catch let err as BridgeAckDecoding.AckDecodeError {
                    FileHandle.standardError.write(Data(
                        "[TransportListener] WARN: onPrepareStartTurn ack decode failed: \(err.description) — denying\n".utf8
                    ))
                } catch let err as BridgeRequester.RequesterError {
                    FileHandle.standardError.write(Data(
                        "[TransportListener] onPrepareStartTurn ack request not answered: \(err.description)\n".utf8
                    ))
                } catch {
                    FileHandle.standardError.write(Data(
                        "[TransportListener] onPrepareStartTurn ack request error: \(error.localizedDescription)\n".utf8
                    ))
                }
                return await self.prepareStartTurnAckFallback(
                    request: request,
                    message: "Phase C3.5 fallback — Electron handler not yet wired",
                    requestedAt: ackRequestedAt
                )
            },
            onWatchedThreads: { [self] threadIDs, pairID in
                await self.logHandler(
                    "onWatchedThreads count=\(threadIDs.count) pairID=\(pairID.rawValue)"
                )
                await self.logQUICPipeline("client subscribed pairID=\(pairID.rawValue) watchedThreads=\(threadIDs.count)")
                // Update the daemon-side per-pair subscription store so
                // future `broadcastRunEvent(payloadJSON:threadID:)` calls
                // can filter delivery via toPairIDs.
                let update = await watchedThreadsStore.update(pairID: pairID, threadIDs: threadIDs)
                await self.recordSnapshotRequest(at: update.lastSeenAt)
                let snapshotReason: String
                if update.isFirstSeen {
                    snapshotReason = "subscribe"
                } else if update.changed {
                    snapshotReason = "resubscribe"
                } else {
                    snapshotReason = "resume"
                }
                notifier.publish(method: "bridge.didReceiveWatchedThreads", params: [
                    "pairID": pairID.rawValue,
                    "threadIDs": update.threadIDs,
                    "previousThreadIDs": update.previousThreadIDs,
                    "changed": update.changed,
                    "lastSeenAt": Self.iso8601String(from: update.lastSeenAt),
                    "subscriptionRevision": Int(update.revision)
                ])
                notifier.publish(method: "bridge.iosClientSubscribed", params: [
                    "pairID": pairID.rawValue,
                    "threadIDs": update.threadIDs,
                    "snapshotReason": snapshotReason,
                    "snapshotOnSubscribe": true,
                    "resetThrottle": true,
                    "lastSeenAt": Self.iso8601String(from: update.lastSeenAt),
                    "subscriptionRevision": Int(update.revision),
                    "watchedPairCount": update.pairsWithSubscriptions,
                    "watchedSeenPairCount": update.seenPairCount,
                    "watchedThreadSubscriptionCount": update.totalSubscriptions
                ])
            },
            onReplay: nil,
            onStreamReplay: nil
        )

        let server = QUICBridgeServer(
            serviceType: cfg.bonjourQUICServiceType,
            macDeviceID: macDeviceID,
            port: cfg.directQUICPort,
            trustedControllers: controllers,
            handlers: handlers
        )

        do {
            logQUICPipeline("starting Bonjour QUIC listener service=\(cfg.bonjourQUICServiceType) port=\(cfg.directQUICPort)")
            try await server.start()
        } catch {
            lastErrorMessage = error.localizedDescription
            logQUICPipeline("start failed service=\(cfg.bonjourQUICServiceType) port=\(cfg.directQUICPort) error=\(error.localizedDescription)")
            throw TransportListenerError.underlying(error)
        }

        let tailscaleEndpoint = tailscaleEndpointProvider()
        var tailnetServer: EndpointBoundQUICBridgeServer?
        if let tailnetIPv4 = tailscaleEndpoint.ipv4 {
            let scopedServer = EndpointBoundQUICBridgeServer(
                bindHost: tailnetIPv4,
                port: cfg.directQUICPort,
                macDeviceID: macDeviceID,
                trustedControllers: controllers,
                handlers: handlers
            )
            do {
                try await scopedServer.start()
                tailnetServer = scopedServer
                logQUICPipeline("tailnet QUIC listener started endpoint=\(tailnetIPv4):\(cfg.directQUICPort)")
            } catch {
                logQUICPipeline("WARN: tailnet QUIC listener failed endpoint=\(tailnetIPv4):\(cfg.directQUICPort) error=\(error.localizedDescription)")
            }
        }

        self.server = server
        self.tailnetServer = tailnetServer
        self.activeTailnetEndpoint = tailscaleEndpoint
        self.trustedControllerCount = controllers.count
        self.lastErrorMessage = nil
        logQUICPipeline("listener running service=\(cfg.bonjourQUICServiceType) port=\(cfg.directQUICPort) trustedControllers=\(controllers.count) tailnet=\(tailnetServer != nil)")
    }

    public func stop() async throws {
        guard let server else {
            throw TransportListenerError.notRunning
        }
        await server.stop()
        if let tailnetServer {
            await tailnetServer.stop()
        }
        self.server = nil
        self.tailnetServer = nil
        self.activeTailnetEndpoint = nil
        self.trustedControllerCount = 0
        logQUICPipeline("listener stopped")
    }

    public func status() async -> Status {
        let cfg = BridgeProductConfiguration.current
        let tailnetEndpointHint = activeTailnetEndpoint?.quicEndpointHint(port: cfg.directQUICPort)
        let watchedSnapshot = await watchedThreadsStore.snapshot()
        let tailnetSessionCount: Int
        if let tailnetServer {
            tailnetSessionCount = await tailnetServer.activeSessionCount()
        } else {
            tailnetSessionCount = 0
        }
        var routeHints: [String] = []
        if server != nil {
            routeHints.append("bonjour")
        }
        if tailnetServer != nil {
            routeHints.append("tailnet")
        }
        return Status(
            running: server != nil,
            bonjourServiceType: cfg.bonjourQUICServiceType,
            port: server != nil ? cfg.directQUICPort : nil,
            tailnetIPv4: activeTailnetEndpoint?.ipv4,
            tailnetEndpoint: tailnetEndpointHint,
            tailnetListenerRunning: tailnetServer != nil,
            activeRouteCount: routeHints.count,
            routeHints: routeHints,
            tailnetSessionCount: tailnetSessionCount,
            trustedControllerCount: trustedControllerCount,
            watchedPairCount: watchedSnapshot.pairsWithSubscriptions,
            watchedSeenPairCount: watchedSnapshot.seenPairCount,
            watchedThreadSubscriptionCount: watchedSnapshot.totalSubscriptions,
            lastWatchedThreadSeenAt: watchedSnapshot.lastSeenAt,
            lastSnapshotRequestedAt: lastSnapshotRequestedAt,
            snapshotRequestCount: snapshotRequestCount,
            lastRunEventBroadcastAt: lastRunEventBroadcastAt,
            runEventBroadcastCount: runEventBroadcastCount,
            lastRunEventThreadID: lastRunEventThreadID,
            lastActionAckLatencyMs: lastActionAckLatencyMs,
            lastActionAckAccepted: lastActionAckAccepted,
            lastPrepareAckLatencyMs: lastPrepareAckLatencyMs,
            lastPrepareAckAccepted: lastPrepareAckAccepted,
            lastError: lastErrorMessage
        )
    }

    public func isRunning() -> Bool {
        server != nil
    }

    /// Push the updated trusted-controller list into a running server. Used
    /// when a new pairing completes while the listener is up. Phase C3-late
    /// hooks this from the PairingCoordinator finalize path.
    public func refreshTrustedControllers() async throws {
        guard let server else {
            logQUICPipeline("refresh skipped reason=listener-not-running")
            return
        }
        let controllers = try await loadTrustedControllers()
        logQUICPipeline("refresh trusted controllers count=\(controllers.count)")
        await server.updateTrustedControllers(controllers)
        await tailnetServer?.updateTrustedControllers(controllers)
        trustedControllerCount = controllers.count
    }

    /// Ensure the post-pair live transport is ready. If the listener is already
    /// bound, refresh its trusted-device snapshot so a newly accepted pair can
    /// authenticate immediately. If it has not been started yet, start it now.
    public func ensureRunningWithCurrentTrustedControllers() async throws {
        if server == nil {
            logQUICPipeline("ensure running: listener not running, starting")
            try await start()
        } else {
            logQUICPipeline("ensure running: listener already running, refreshing trust")
            try await refreshTrustedControllers()
        }
    }

    /// Phase C-late slice "stream events to iOS": broadcast a run-event JSON
    /// payload (originating from Electron's `RunEventBus` via
    /// `BridgeRunEventSink` → daemon `bridge.runEvent` notification) to every
    /// connected iOS peer.
    ///
    /// Wrapped as `BridgeTransportPayload.eventRecord(Data)` — a generic
    /// server → controller event channel in the existing BridgeCore
    /// protocol. iOS-side decoding will interpret the bytes as our run-event
    /// JSON (`{channel, provider, payload, publishedAt}`).
    ///
    /// `threadID` (optional) enables per-pair filtering: when present and
    /// at least one paired device has explicitly declared a non-empty
    /// watched-threads set via `sendWatchedThreads`, the event is
    /// delivered ONLY to pairs that opted in to that thread. When
    /// threadID is nil or no pair has declared any subscription, the
    /// event broadcasts to all (backward-compat behavior).
    ///
    /// Best-effort: when the server isn't running OR no peers are
    /// connected, the call is a no-op. Sessions that fail a write are
    /// pruned automatically by `LANBridgeServer.broadcast`.
    public func broadcastRunEvent(_ payloadJSON: Data, threadID: String? = nil) async {
        guard let server else {
            logQUICPipeline("broadcast skipped reason=listener-not-running bytes=\(payloadJSON.count) threadID=\(threadID ?? "nil")")
            return
        }
        let now = Date()
        lastRunEventBroadcastAt = now
        runEventBroadcastCount += 1
        lastRunEventThreadID = threadID
        let staleCutoff = now.addingTimeInterval(-watchedThreadStaleInterval)
        let removedStalePairs = await watchedThreadsStore.removeStalePairs(lastSeenBefore: staleCutoff)
        if removedStalePairs > 0 {
            logQUICPipeline("watched-thread cleanup removedPairs=\(removedStalePairs)")
        }
        let envelope = BridgeInboundEnvelope(payload: .eventRecord(payloadJSON))
        // Per-pair filtering: consult the subscription store. nil result
        // means "no subscriber has spoken" → broadcast to all (preserves
        // existing behavior). Non-nil set (including empty) means at
        // least one pair has subscriptions; deliver only to that set.
        if let threadID,
           let watchingPairs = await watchedThreadsStore.pairsWatching(threadID: threadID) {
            logQUICPipeline("broadcast event bytes=\(payloadJSON.count) threadID=\(threadID) scopedPairs=\(watchingPairs.count)")
            await server.broadcast(envelope, toPairIDs: watchingPairs)
            await tailnetServer?.broadcast(envelope, toPairIDs: watchingPairs)
        } else {
            logQUICPipeline("broadcast event bytes=\(payloadJSON.count) threadID=\(threadID ?? "nil") scopedPairs=all")
            await server.broadcast(envelope)
            await tailnetServer?.broadcast(envelope)
        }
    }

    // MARK: - Helpers

    private func loadTrustedControllers() async throws -> [LANBridgeServer.TrustedController] {
        let records: [TrustedDeviceRecord]
        if let fileStore = deviceStore as? FileTrustedDeviceStore {
            records = await fileStore.snapshot()
        } else {
            records = []
        }

        var controllers: [LANBridgeServer.TrustedController] = []
        for record in records where record.pairingState == .active {
            do {
                guard let keys = try await PairSecretsStore.load(
                    secretStore: secretStore,
                    pairID: record.pairID
                ) else {
                    // Record exists but secrets are missing — likely paired
                    // before C3.0 persistence shipped. Skip; user can re-pair.
                    FileHandle.standardError.write(Data(
                        "[TransportListener] WARN: active device \(record.deviceID.rawValue) has no persisted pair secrets — skipping\n".utf8
                    ))
                    continue
                }
                controllers.append(LANBridgeServer.TrustedController(
                    pairID: record.pairID,
                    controllerDeviceID: record.deviceID,
                    macToControllerKey: keys.macToControllerKey,
                    controllerToMacKey: keys.controllerToMacKey
                ))
            } catch {
                FileHandle.standardError.write(Data(
                    "[TransportListener] WARN: failed to load secrets for \(record.deviceID.rawValue): \(error.localizedDescription)\n".utf8
                ))
            }
        }
        return controllers
    }

    private func actionAckFallback(
        message: String,
        requestedAt: Date
    ) -> BridgeActionAck {
        let deliveredAt = Date()
        recordActionAckStatus(
            accepted: false,
            latencySeconds: deliveredAt.timeIntervalSince(requestedAt)
        )
        return BridgeActionAck(
            schemaVersion: 1,
            state: .rejected,
            deliveredAt: deliveredAt,
            accepted: false,
            executed: false,
            reasonCode: "daemonFallback",
            message: message,
            error: BridgeErrorReport(
                code: "daemonFallback",
                message: message,
                severity: .warning,
                occurredAt: deliveredAt
            )
        )
    }

    private func prepareStartTurnAckFallback(
        request: BridgePrepareStartTurnRequest,
        message: String,
        requestedAt: Date
    ) -> BridgePrepareStartTurnAck {
        let readyAt = Date()
        recordPrepareAckStatus(
            accepted: false,
            latencySeconds: readyAt.timeIntervalSince(requestedAt)
        )
        return BridgePrepareStartTurnAck(
            prepareID: request.prepareID,
            workspaceID: request.workspaceID,
            threadID: request.threadID,
            readyAt: readyAt,
            accepted: false,
            message: message,
            error: BridgeErrorReport(
                code: "daemonFallback",
                message: message,
                severity: .warning,
                occurredAt: readyAt
            )
        )
    }

    private func recordActionAckStatus(accepted: Bool, latencySeconds: TimeInterval) {
        lastActionAckAccepted = accepted
        lastActionAckLatencyMs = max(0, latencySeconds * 1000.0)
    }

    private func recordPrepareAckStatus(accepted: Bool, latencySeconds: TimeInterval) {
        lastPrepareAckAccepted = accepted
        lastPrepareAckLatencyMs = max(0, latencySeconds * 1000.0)
    }

    private func recordSnapshotRequest(at date: Date) {
        lastSnapshotRequestedAt = date
        snapshotRequestCount += 1
    }

    private static func iso8601String(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private func logHandler(_ message: String) async {
        FileHandle.standardError.write(Data("[TransportListener handler] \(message)\n".utf8))
    }

    private func logQUICPipeline(_ message: String) {
        FileHandle.standardError.write(Data("[QUIC pipeline] \(message)\n".utf8))
    }
}
