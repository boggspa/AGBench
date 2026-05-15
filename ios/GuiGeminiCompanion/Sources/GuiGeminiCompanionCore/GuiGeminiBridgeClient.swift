import Foundation
import CryptoKit
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
    public struct Pair: Sendable {
        public let pairID: PairID
        public let controllerDeviceID: DeviceID
        public let macDeviceID: DeviceID
        public let macToControllerKey: SymmetricKey
        public let controllerToMacKey: SymmetricKey

        public init(
            pairID: PairID,
            controllerDeviceID: DeviceID,
            macDeviceID: DeviceID,
            derivedKeys: PairingDerivedKeys
        ) {
            self.pairID = pairID
            self.controllerDeviceID = controllerDeviceID
            self.macDeviceID = macDeviceID
            self.macToControllerKey = derivedKeys.macToControllerKey
            self.controllerToMacKey = derivedKeys.controllerToMacKey
        }
    }

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

    private let controller: LANBridgeController
    private let runEventsContinuation: AsyncStream<BridgeRunEvent>.Continuation
    private let otherInboundContinuation: AsyncStream<BridgeInboundEnvelope>.Continuation

    private var inboundForwarderTask: Task<Void, Never>?
    private var statusForwarderTask: Task<Void, Never>?
    private var didStart = false

    public init(
        pair: Pair,
        networkProtocol: DirectNetworkProtocol = .quic,
        quicSecurity: DirectQUICSecurity? = nil,
        tailscaleEndpoint: BridgeDirectEndpoint? = nil,
        transportPreference: BridgeDirectTransportPreference = .automatic
    ) {
        let serviceType: String
        switch networkProtocol {
        case .quic: serviceType = ServiceType.quic
        case .tcp: serviceType = ServiceType.tcp
        @unknown default: serviceType = ServiceType.quic
        }
        self.controller = LANBridgeController(
            configuration: LANBridgeController.Configuration(
                serviceType: serviceType,
                pairID: pair.pairID,
                controllerDeviceID: pair.controllerDeviceID,
                macDeviceID: pair.macDeviceID,
                macToControllerKey: pair.macToControllerKey,
                controllerToMacKey: pair.controllerToMacKey,
                tailscaleEndpoint: tailscaleEndpoint,
                transportPreference: transportPreference,
                networkProtocol: networkProtocol,
                quicSecurity: quicSecurity
            )
        )

        var runEventsCont: AsyncStream<BridgeRunEvent>.Continuation!
        self.runEvents = AsyncStream(bufferingPolicy: .bufferingNewest(1_024)) { runEventsCont = $0 }
        self.runEventsContinuation = runEventsCont

        var otherInboundCont: AsyncStream<BridgeInboundEnvelope>.Continuation!
        self.otherInbound = AsyncStream(bufferingPolicy: .bufferingNewest(256)) { otherInboundCont = $0 }
        self.otherInboundContinuation = otherInboundCont

        // The underlying controller's status stream is buffer-1; we
        // pass-through directly so consumers see the most recent state.
        self.status = controller.status
    }

    /// Begin browsing for the paired Mac, connect, and start forwarding
    /// inbound envelopes onto the typed streams. Idempotent.
    public func start() async {
        guard !didStart else { return }
        didStart = true
        // Kick off the inbound forwarder before starting the controller
        // so the buffer doesn't drop the hello envelope.
        let runEventsCont = self.runEventsContinuation
        let otherInboundCont = self.otherInboundContinuation
        let controllerInbound = controller.inbound
        inboundForwarderTask = Task { [weak self] in
            for await envelope in controllerInbound {
                await self?.handle(envelope: envelope,
                                   runEventsContinuation: runEventsCont,
                                   otherInboundContinuation: otherInboundCont)
            }
        }
        await controller.start()
    }

    /// Tear down all transport state and forwarder tasks. Idempotent.
    public func stop() async {
        await controller.stop()
        inboundForwarderTask?.cancel()
        inboundForwarderTask = nil
        statusForwarderTask?.cancel()
        statusForwarderTask = nil
        runEventsContinuation.finish()
        otherInboundContinuation.finish()
    }

    /// Encode a typed `BridgeActionPayload` and ship it via the
    /// controller's `sendActionRecord`. Returns the desktop's typed ack
    /// or nil if no response arrived within the controller's timeout.
    public func sendAction(_ action: BridgeActionPayload) async throws -> BridgeActionAck? {
        let bytes = try action.encode()
        return await controller.sendActionRecord(payloadData: bytes)
    }

    /// Convenience: send a `PrepareStartTurn` request and await the typed
    /// ack. Used during the iOS composer's pre-flight phase to validate
    /// the workspace/provider/approvalMode combination before sending the
    /// actual `composerPrompt` action.
    public func sendPrepareStartTurn(_ request: BridgePrepareStartTurnRequest) async -> BridgePrepareStartTurnAck? {
        await controller.sendPrepareStartTurn(request)
    }

    /// Tell the desktop which threads this device is currently watching
    /// so the desktop can scope event-broadcast filtering.
    public func sendWatchedThreads(threadIDs: [String]) async -> Bool {
        await controller.sendWatchedThreads(threadIDs: threadIDs)
    }

    // MARK: - Private

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
            if let event = try? BridgeRunEvent.decode(eventRecordBytes: payloadData) {
                runEventsContinuation.yield(event)
                return
            }
        }
        otherInboundContinuation.yield(envelope)
    }
}
