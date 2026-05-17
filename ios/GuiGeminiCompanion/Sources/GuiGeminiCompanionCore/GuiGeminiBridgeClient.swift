import Foundation
import CryptoKit
@preconcurrency import Network
import BridgeCore
import BridgeCryptoPairing
import BridgeLANTransport

/// GuiGeminiBridgeClient — iOS-side transport client wrapping
/// `LANBridgeTransport.LANBridgeController` with GuiGemini-flavored types.
///
/// What this adds on top of `LANBridgeController`:
///   - Filtered event stream: subscribes to the controller's raw
///     `inbound: AsyncStream<BridgeInboundEnvelope>`, decodes the
///     `eventRecord(Data)` envelopes into typed `BridgeRunEvent` and
///     surfaces them on its own `runEvents` stream. Non-event envelopes
///     (hello, ping, subscriptions, etc.) are forwarded to a generic
///     `otherInbound` stream for UI components that care about them.
///   - Typed action sender: `sendAction(_ action: BridgeActionPayload)`
///     encodes via the iOS-side `BridgeActionPayload.encode()` and calls
///     `LANBridgeController.sendActionRecord(payloadData:)`.
///   - Service-type defaults: pre-fills GUIGemini's Bonjour service type
///     (`_guigemini-quic._udp` for QUIC, `_guigemini._tcp` for TCP
///     fallback) so callers don't need to know the daemon's specific
///     identifiers.
///
/// What this does NOT do (deferred):
///   - Pair-secret persistence to iOS Keychain — caller passes in the
///     derived keys.
///   - Bonjour result UI / endpoint selection — handled by the underlying
///     `LANBridgeController.start()`'s auto-connect loop.
///   - Reconnect with exponential backoff — `LANBridgeController` handles
///     that internally; the wrapper just surfaces status changes.
///   - APNs token registration handoff — the action variant exists
///     (`BridgeActionPayload.registerApnsToken`) so a UI can compose and
///     `sendAction` it; the token-store integration is desktop-side.
public actor GuiGeminiBridgeClient {
    public enum ActiveRoute: String, Sendable, Equatable {
        case tailnet = "Tailnet"
        case lan = "LAN"
    }

    public struct Pair: Sendable {
        public let pairID: PairID
        public let controllerDeviceID: DeviceID
        public let macDeviceID: DeviceID
        public let macToControllerKey: SymmetricKey
        public let controllerToMacKey: SymmetricKey
        public let tailscaleEndpointHint: String?
        public let runEventCursors: [String: Int]

        public init(
            pairID: PairID,
            controllerDeviceID: DeviceID,
            macDeviceID: DeviceID,
            derivedKeys: PairingDerivedKeys,
            tailscaleEndpointHint: String? = nil,
            runEventCursors: [String: Int] = [:]
        ) {
            self.pairID = pairID
            self.controllerDeviceID = controllerDeviceID
            self.macDeviceID = macDeviceID
            self.macToControllerKey = derivedKeys.macToControllerKey
            self.controllerToMacKey = derivedKeys.controllerToMacKey
            self.tailscaleEndpointHint = tailscaleEndpointHint
            self.runEventCursors = runEventCursors
        }

        public init(record: KeychainPairStorage.PairRecord, derivedKeys: PairingDerivedKeys) {
            self.init(
                pairID: record.pairID,
                controllerDeviceID: record.controllerDeviceID,
                macDeviceID: record.macDeviceID,
                derivedKeys: derivedKeys,
                tailscaleEndpointHint: record.tailscaleEndpointHint,
                runEventCursors: record.cursors
            )
        }
    }

    public struct RunEventCursorUpdate: Sendable, Equatable {
        public let pairID: PairID
        public let runId: String
        public let sequence: Int
    }

    struct RouteSelection: Sendable, Equatable {
        let activeRoute: ActiveRoute
        let tailscaleEndpoint: BridgeDirectEndpoint?
        let transportPreference: BridgeDirectTransportPreference
    }

    typealias EndpointProbe = @Sendable (
        BridgeDirectEndpoint,
        TimeInterval,
        DirectNetworkProtocol,
        DirectQUICSecurity?
    ) async -> Bool

    /// GUIGemini Bonjour service types — keep in sync with
    /// `BridgeProductConfiguration.guiGemini` on the desktop daemon.
    public enum ServiceType {
        public static let quic = "_guigemini-quic._udp"
        public static let tcp = "_guigemini._tcp"
    }

    /// Typed run events streamed from the desktop. UI subscribes to this
    /// for the live transcript view.
    public nonisolated let runEvents: AsyncStream<BridgeRunEvent>
    /// Connection state changes (idle → connecting → authenticated → …).
    /// UI surfaces this in a status indicator.
    public nonisolated let status: AsyncStream<BridgeTransportStatus>
    /// Non-event inbound envelopes (hello, ping, subscription state, etc.).
    /// Most UI doesn't need these; exposed for diagnostics + future
    /// thread-watch / subscription state tracking.
    public nonisolated let otherInbound: AsyncStream<BridgeInboundEnvelope>
    public nonisolated let activeRoute: AsyncStream<ActiveRoute>
    public nonisolated let cursorUpdates: AsyncStream<RunEventCursorUpdate>

    private let pair: Pair
    private let networkProtocol: DirectNetworkProtocol
    private let quicSecurity: DirectQUICSecurity?
    private let requestedTransportPreference: BridgeDirectTransportPreference
    private let explicitTailscaleEndpoint: BridgeDirectEndpoint?
    private let endpointProbe: EndpointProbe
    private let tailnetProbeTimeout: TimeInterval
    private var controller: LANBridgeController?
    private let runEventsContinuation: AsyncStream<BridgeRunEvent>.Continuation
    private let statusContinuation: AsyncStream<BridgeTransportStatus>.Continuation
    private let otherInboundContinuation: AsyncStream<BridgeInboundEnvelope>.Continuation
    private let activeRouteContinuation: AsyncStream<ActiveRoute>.Continuation
    private let cursorUpdatesContinuation: AsyncStream<RunEventCursorUpdate>.Continuation

    private var inboundForwarderTask: Task<Void, Never>?
    private var statusForwarderTask: Task<Void, Never>?
    private var selectedRoute: RouteSelection?
    private var didStart = false
    private var cursorsByRunId: [String: Int]
    private var lastSubscribedCursorByRunId: [String: Int] = [:]

    static let defaultTailscalePort: UInt16 = 38_747

    public init(
        pair: Pair,
        networkProtocol: DirectNetworkProtocol = .quic,
        quicSecurity: DirectQUICSecurity? = nil,
        tailscaleEndpoint: BridgeDirectEndpoint? = nil,
        transportPreference: BridgeDirectTransportPreference = .automatic
    ) {
        self.init(
            pair: pair,
            networkProtocol: networkProtocol,
            quicSecurity: quicSecurity,
            tailscaleEndpoint: tailscaleEndpoint,
            transportPreference: transportPreference,
            tailnetProbeTimeout: 5,
            endpointProbe: Self.probeTailscaleEndpoint
        )
    }

    init(
        pair: Pair,
        networkProtocol: DirectNetworkProtocol = .quic,
        quicSecurity: DirectQUICSecurity? = nil,
        tailscaleEndpoint: BridgeDirectEndpoint? = nil,
        transportPreference: BridgeDirectTransportPreference = .automatic,
        tailnetProbeTimeout: TimeInterval,
        endpointProbe: @escaping EndpointProbe
    ) {
        self.pair = pair
        self.networkProtocol = networkProtocol
        self.quicSecurity = quicSecurity
        self.requestedTransportPreference = transportPreference
        self.explicitTailscaleEndpoint = tailscaleEndpoint
        self.endpointProbe = endpointProbe
        self.tailnetProbeTimeout = tailnetProbeTimeout
        self.cursorsByRunId = pair.runEventCursors

        var runEventsCont: AsyncStream<BridgeRunEvent>.Continuation!
        self.runEvents = AsyncStream(bufferingPolicy: .bufferingNewest(1_024)) { runEventsCont = $0 }
        self.runEventsContinuation = runEventsCont

        var statusCont: AsyncStream<BridgeTransportStatus>.Continuation!
        self.status = AsyncStream(bufferingPolicy: .bufferingNewest(1)) { statusCont = $0 }
        self.statusContinuation = statusCont

        var otherInboundCont: AsyncStream<BridgeInboundEnvelope>.Continuation!
        self.otherInbound = AsyncStream(bufferingPolicy: .bufferingNewest(256)) { otherInboundCont = $0 }
        self.otherInboundContinuation = otherInboundCont

        var activeRouteCont: AsyncStream<ActiveRoute>.Continuation!
        self.activeRoute = AsyncStream(bufferingPolicy: .bufferingNewest(1)) { activeRouteCont = $0 }
        self.activeRouteContinuation = activeRouteCont

        var cursorUpdatesCont: AsyncStream<RunEventCursorUpdate>.Continuation!
        self.cursorUpdates = AsyncStream(bufferingPolicy: .bufferingNewest(256)) { cursorUpdatesCont = $0 }
        self.cursorUpdatesContinuation = cursorUpdatesCont
    }

    /// Begin browsing for the paired Mac, connect, and start forwarding
    /// inbound envelopes onto the typed streams. Idempotent.
    public func start() async {
        guard !didStart else { return }
        didStart = true
        let route = await Self.selectRoute(
            tailscaleEndpoint: explicitTailscaleEndpoint ?? Self.tailscaleEndpoint(from: pair.tailscaleEndpointHint),
            requestedPreference: requestedTransportPreference,
            networkProtocol: networkProtocol,
            quicSecurity: quicSecurity,
            probeTimeout: tailnetProbeTimeout,
            probe: endpointProbe
        )
        selectedRoute = route
        activeRouteContinuation.yield(route.activeRoute)

        let controller = makeController(route: route)
        self.controller = controller

        // Kick off the inbound forwarder before starting the controller
        // so the buffer doesn't drop the hello envelope.
        let runEventsCont = self.runEventsContinuation
        let statusCont = self.statusContinuation
        let otherInboundCont = self.otherInboundContinuation
        let activeRouteCont = self.activeRouteContinuation
        let controllerInbound = controller.inbound
        let controllerStatus = controller.status
        inboundForwarderTask = Task { [weak self] in
            for await envelope in controllerInbound {
                await self?.handle(envelope: envelope,
                                   runEventsContinuation: runEventsCont,
                                   otherInboundContinuation: otherInboundCont)
            }
        }
        statusForwarderTask = Task { [weak self] in
            for await status in controllerStatus {
                statusCont.yield(status)
                guard status.reachable,
                      let route = Self.activeRoute(for: status.kind)
                else { continue }
                activeRouteCont.yield(route)
                await self?.resubscribeKnownRunEvents()
            }
        }
        await controller.start()
    }

    /// Tear down all transport state and forwarder tasks. Idempotent.
    public func stop() async {
        await controller?.stop()
        controller = nil
        inboundForwarderTask?.cancel()
        inboundForwarderTask = nil
        statusForwarderTask?.cancel()
        statusForwarderTask = nil
        runEventsContinuation.finish()
        statusContinuation.finish()
        otherInboundContinuation.finish()
        activeRouteContinuation.finish()
        cursorUpdatesContinuation.finish()
        selectedRoute = nil
        didStart = false
    }

    /// Encode a typed `BridgeActionPayload` and ship it via the
    /// controller's `sendActionRecord`. Returns the desktop's typed ack
    /// or nil if no response arrived within the controller's timeout.
    public func sendAction(_ action: BridgeActionPayload) async throws -> BridgeActionAck? {
        guard let controller else { return nil }
        let bytes = try action.encode()
        return await controller.sendActionRecord(payloadData: bytes)
    }

    /// Convenience: send a `PrepareStartTurn` request and await the typed
    /// ack. Used during the iOS composer's pre-flight phase to validate
    /// the workspace/provider/approvalMode combination before sending the
    /// actual `composerPrompt` action.
    public func sendPrepareStartTurn(_ request: BridgePrepareStartTurnRequest) async -> BridgePrepareStartTurnAck? {
        guard let controller else { return nil }
        return await controller.sendPrepareStartTurn(request)
    }

    /// Tell the desktop which threads this device is currently watching
    /// so the desktop can scope event-broadcast filtering.
    public func sendWatchedThreads(threadIDs: [String]) async -> Bool {
        guard let controller else { return false }
        return await controller.sendWatchedThreads(threadIDs: threadIDs)
    }

    public func subscribeRunEvents(runId: String, resumeFrom: Int? = nil) async throws -> BridgeActionAck? {
        let effectiveCursor = resumeFrom ?? cursorsByRunId[runId]
        let ack = try await sendAction(.subscribeRunEvents(runId: runId, resumeFrom: effectiveCursor))
        if ack?.accepted == true {
            lastSubscribedCursorByRunId[runId] = effectiveCursor ?? 0
        }
        return ack
    }

    // MARK: - Private

    private func makeController(route: RouteSelection) -> LANBridgeController {
        let serviceType: String
        switch networkProtocol {
        case .quic: serviceType = ServiceType.quic
        case .tcp: serviceType = ServiceType.tcp
        @unknown default: serviceType = ServiceType.quic
        }
        return LANBridgeController(
            configuration: LANBridgeController.Configuration(
                serviceType: serviceType,
                pairID: pair.pairID,
                controllerDeviceID: pair.controllerDeviceID,
                macDeviceID: pair.macDeviceID,
                macToControllerKey: pair.macToControllerKey,
                controllerToMacKey: pair.controllerToMacKey,
                tailscaleEndpoint: route.tailscaleEndpoint,
                transportPreference: route.transportPreference,
                networkProtocol: networkProtocol,
                quicSecurity: quicSecurity
            )
        )
    }

    static func tailscaleEndpoint(from hint: String?) -> BridgeDirectEndpoint? {
        guard let hint else { return nil }
        return BridgeDirectEndpoint(rawValue: hint, defaultPort: defaultTailscalePort)
    }

    static func selectRoute(
        tailscaleEndpoint: BridgeDirectEndpoint?,
        requestedPreference: BridgeDirectTransportPreference,
        networkProtocol: DirectNetworkProtocol,
        quicSecurity: DirectQUICSecurity?,
        probeTimeout: TimeInterval,
        probe: EndpointProbe
    ) async -> RouteSelection {
        guard requestedPreference.allowsTailscale,
              let tailscaleEndpoint
        else {
            return RouteSelection(
                activeRoute: .lan,
                tailscaleEndpoint: nil,
                transportPreference: .bonjour
            )
        }

        let isReachable = await probe(
            tailscaleEndpoint,
            probeTimeout,
            networkProtocol,
            quicSecurity
        )
        if isReachable {
            return RouteSelection(
                activeRoute: .tailnet,
                tailscaleEndpoint: tailscaleEndpoint,
                transportPreference: .tailscale
            )
        }

        return RouteSelection(
            activeRoute: .lan,
            tailscaleEndpoint: nil,
            transportPreference: .bonjour
        )
    }

    static func probeTailscaleEndpoint(
        _ endpoint: BridgeDirectEndpoint,
        timeout: TimeInterval,
        networkProtocol: DirectNetworkProtocol,
        quicSecurity: DirectQUICSecurity?
    ) async -> Bool {
        await withCheckedContinuation { continuation in
            let flag = OneShotFlag()
            let connection = NWConnection(
                to: endpoint.nwEndpoint,
                using: networkProtocol.parameters(quicSecurity: quicSecurity)
            )
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if flag.tryResolve() {
                        continuation.resume(returning: true)
                        connection.cancel()
                    }
                case .failed, .cancelled:
                    if flag.tryResolve() {
                        continuation.resume(returning: false)
                        connection.cancel()
                    }
                default:
                    break
                }
            }
            connection.start(queue: .global())
            Task {
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                guard flag.tryResolve() else { return }
                continuation.resume(returning: false)
                connection.cancel()
            }
        }
    }

    static func activeRoute(for kind: BridgeTransportKind) -> ActiveRoute? {
        switch kind {
        case .quicTailscale, .tailscale:
            return .tailnet
        case .quicBonjour, .lanBonjour:
            return .lan
        case .cloudKit:
            return nil
        }
    }

    /// Decide whether an inbound envelope is one of our typed run events
    /// (route to `runEvents`) or a different transport payload (route to
    /// `otherInbound`). Malformed event records are dropped silently —
    /// the controller's logger already records the bytes.
    private func handle(
        envelope: BridgeInboundEnvelope,
        runEventsContinuation: AsyncStream<BridgeRunEvent>.Continuation,
        otherInboundContinuation: AsyncStream<BridgeInboundEnvelope>.Continuation
    ) async {
        if case let .eventRecord(payloadData) = envelope.payload {
            // Try the GUIGemini-flavored decode. If it's not a run event
            // (could be a CodexBridge-flavored event record from a
            // misconfigured peer), fall through to otherInbound.
            do {
                let events = try BridgeRunEvent.decodeMany(eventRecordBytes: payloadData)
                for event in events {
                    observeCursor(event)
                    runEventsContinuation.yield(event)
                }
                return
            } catch {
                // Not a GUIGemini run-event frame.
            }
        }
        otherInboundContinuation.yield(envelope)
    }

    private func observeCursor(_ event: BridgeRunEvent) {
        guard let runId = event.runId,
              let sequence = event.sequence
        else { return }
        let current = cursorsByRunId[runId] ?? 0
        guard sequence > current else { return }
        cursorsByRunId[runId] = sequence
        cursorUpdatesContinuation.yield(
            RunEventCursorUpdate(pairID: pair.pairID, runId: runId, sequence: sequence)
        )
    }

    private func resubscribeKnownRunEvents() async {
        for (runId, cursor) in cursorsByRunId {
            guard lastSubscribedCursorByRunId[runId] != cursor else { continue }
            do {
                _ = try await subscribeRunEvents(runId: runId, resumeFrom: cursor)
            } catch {
                // Best-effort replay recovery. The live stream still resumes
                // even if the replay request is rejected or the ack times out.
            }
        }
    }
}

private final class OneShotFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var resolved = false

    func tryResolve() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if resolved { return false }
        resolved = true
        return true
    }
}
