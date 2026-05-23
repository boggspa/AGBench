import Foundation
import Network
import BridgeCore
import BridgeCryptoPrimitives
import BridgeCryptoPairing
import BridgeLANTransport

/// QUIC listener scoped to one explicit local host address.
///
/// CodexBridge's shared `QUICBridgeServer` intentionally publishes a Bonjour
/// listener and does not expose a local-address bind option. GUIGemini needs a
/// second, non-Bonjour Tailnet route, so the daemon owns this small adapter and
/// keeps it protocol-compatible with the shared LAN session/envelope stack.
actor EndpointBoundQUICBridgeServer {
    typealias TrustedController = LANBridgeServer.TrustedController
    typealias Handlers = LANBridgeServer.Handlers

    private let bindHost: String
    private let port: UInt16
    private let macDeviceID: DeviceID
    private let handlers: Handlers

    private var trustedControllers: [TrustedController]
    private var listener: EndpointBoundQUICListener?
    private var sessions: [LANSession] = []
    private var capabilitiesBySessionID: [ObjectIdentifier: Set<String>] = [:]
    private var quicStreamRoleBySessionID: [ObjectIdentifier: BridgeQUICStreamRole] = [:]

    init(
        bindHost: String,
        port: UInt16,
        macDeviceID: DeviceID,
        trustedControllers: [TrustedController],
        handlers: Handlers
    ) {
        self.bindHost = bindHost
        self.port = port
        self.macDeviceID = macDeviceID
        self.trustedControllers = trustedControllers
        self.handlers = handlers
    }

    func start() throws {
        guard listener == nil else { return }
        let listener = EndpointBoundQUICListener(
            bindHost: bindHost,
            port: port,
            macDeviceID: macDeviceID,
            keyResolver: { [weak self] header in
                await self?.keyMaterial(for: header)
            },
            onAcceptedSession: { [weak self] session in
                await self?.adopt(session: session)
            }
        )
        try listener.start()
        self.listener = listener
    }

    func stop() async {
        listener?.stop()
        listener = nil
        for session in sessions {
            await session.stop()
        }
        sessions.removeAll()
        capabilitiesBySessionID.removeAll()
        quicStreamRoleBySessionID.removeAll()
    }

    func updateTrustedControllers(_ controllers: [TrustedController]) {
        trustedControllers = controllers
    }

    func broadcast(_ envelope: BridgeInboundEnvelope, toPairIDs: Set<PairID>? = nil) async {
        var failedSessions: [LANSession] = []
        for session in sessions {
            if !quicBroadcastRoleMatches(payload: envelope.payload, session: session) {
                continue
            }
            if let toPairIDs {
                guard let pairID = await session.pairID, toPairIDs.contains(pairID) else {
                    continue
                }
            }
            do {
                try await session.sendInbound(envelope)
            } catch {
                failedSessions.append(session)
            }
        }
        for session in failedSessions {
            await removeSession(session)
        }
    }

    private func adopt(session: LANSession) async {
        sessions.append(session)
        Task { [weak self] in
            guard let self else { return }
            for await envelope in await session.outboundFromPeer {
                guard let pairID = await session.pairID else { continue }
                await self.dispatch(envelope: envelope, pairID: pairID, session: session)
            }
            await self.removeSession(session)
        }
    }

    private func dispatch(envelope: BridgeOutboundEnvelope, pairID: PairID, session: LANSession) async {
        switch envelope.payload {
        case .hello(let payload):
            quicStreamRoleBySessionID[ObjectIdentifier(session)] = .control
            if payload.protocolVersion < 1 || payload.protocolVersion > 2 {
                await sendStructuredError(
                    code: "unsupportedProtocolVersion",
                    message: "Direct LAN protocol version \(payload.protocolVersion) is not supported.",
                    unsupportedPayloadTag: "hello",
                    correlationID: envelope.envelopeID,
                    session: session
                )
                return
            }
            capabilitiesBySessionID[ObjectIdentifier(session)] = Set(payload.capabilities)
            let response = BridgeInboundEnvelope(
                correlationID: envelope.envelopeID,
                payload: .hello(BridgeDirectHelloPayload(
                    protocolVersion: 2,
                    deviceID: macDeviceID,
                    pairID: pairID,
                    role: .mac,
                    capabilities: serverCapabilities()
                ))
            )
            try? await session.sendInbound(response)

        case .quicStreamOpen(let payload):
            quicStreamRoleBySessionID[ObjectIdentifier(session)] = payload.role
            let response = BridgeInboundEnvelope(
                correlationID: envelope.envelopeID,
                payload: .quicStreamOpenAck(BridgeQUICStreamOpenAckPayload(
                    sessionID: payload.sessionID,
                    role: payload.role,
                    accepted: true,
                    message: nil
                ))
            )
            try? await session.sendInbound(response)

        case .subscribe(let payload):
            await handlers.onWatchedThreads(payload.threadIDs.map(\.rawValue), pairID)

        case .subscribeV2(let payload):
            await handlers.onWatchedThreads(
                Array(Set(payload.scopes.compactMap(\.threadID).map(\.rawValue))).sorted(),
                pairID
            )

        case .watchedThreads(let threadIDs):
            await handlers.onWatchedThreads(threadIDs, pairID)

        case .actionRecord(let payloadData):
            // CodexBridge dep-drift fix: `onActionRecord` now takes a
            // `controllerDeviceID` third argument (the device that sent
            // the action — distinct from the pair so the Mac can route
            // back to the right device on a multi-controller pair). At
            // this dispatch site we don't have a per-message device id
            // — every envelope on this QUIC stream comes from the same
            // attached device. Synthesize a stable device id from the
            // pair id so the handler has SOMETHING to key on; a future
            // refactor can plumb the real device id through the QUIC
            // session metadata if/when we need per-controller routing.
            let controllerDeviceID = DeviceID("device-\(pairID.rawValue)")
            let semanticAck = await handlers.onActionRecord(payloadData, pairID, controllerDeviceID)
            try? await session.sendInbound(BridgeInboundEnvelope(
                correlationID: envelope.envelopeID,
                payload: .actionAck(semanticAck)
            ))

        case .actionWake(let recordName):
            await handlers.onActionWake(recordName, pairID)

        case .prepareStartTurn(let request):
            let semanticAck = await handlers.onPrepareStartTurn(request, pairID)
            try? await session.sendInbound(BridgeInboundEnvelope(
                correlationID: envelope.envelopeID,
                payload: .prepareStartTurnAck(semanticAck)
            ))

        case .ping(let nonce, let sentAt):
            try? await session.sendInbound(BridgeInboundEnvelope(
                correlationID: envelope.envelopeID,
                payload: .pong(nonce: nonce, originSentAt: sentAt, repliedAt: Date())
            ))

        case .replay:
            await sendStructuredError(
                code: "unsupportedReplay",
                message: "Direct replay is not supported on the AGBench Tailnet listener yet.",
                unsupportedPayloadTag: envelope.payload.protocolTag,
                correlationID: envelope.envelopeID,
                session: session
            )

        case .resumeStream:
            await sendStructuredError(
                code: "unsupportedStreamReplay",
                message: "Direct stream replay is not supported on the AGBench Tailnet listener yet.",
                unsupportedPayloadTag: envelope.payload.protocolTag,
                correlationID: envelope.envelopeID,
                session: session
            )

        case .mediaRequest(let request):
            guard let onMediaRequest = handlers.onMediaRequest else {
                await sendStructuredError(
                    code: "unsupportedDirectMedia",
                    message: "Direct media range requests are not supported by this server.",
                    unsupportedPayloadTag: "mediaRequest",
                    correlationID: envelope.envelopeID,
                    session: session
                )
                return
            }
            // CodexBridge `MediaRequestHandler` added a `controllerDeviceID`
            // third argument (mirrors the same drift already fixed for
            // `onActionRecord` higher up in this file at commit c2e22ef).
            // AGBench's QUIC session does not yet propagate iOS-side device
            // identities through to media handlers, so synthesise a stable
            // placeholder from the pairID — matches the convention used by
            // `onActionRecord` and keeps logs round-trippable per pair.
            let mediaControllerDeviceID = DeviceID("device-\(pairID.rawValue)")
            let chunk = await onMediaRequest(request, pairID, mediaControllerDeviceID)
            try? await session.sendInbound(BridgeInboundEnvelope(
                correlationID: envelope.envelopeID,
                payload: .mediaChunk(chunk)
            ))

        case .quicStreamOpenAck, .recordBatch, .durabilityCommit, .structuredError,
             .streamBatch, .streamCommit, .mediaChunk, .eventRecord, .stateSnapshot, .pong,
             .directRecord, .actionAck, .prepareStartTurnAck:
            break

        // CodexBridge dependency added these payloads for its Mac → iOS
        // preview-streaming feature. AGBench doesn't surface live previews
        // today, so we explicitly reject with a structured error rather
        // than silently dropping. The CodexBridge `LANBridgeServer` uses
        // the same `unsupportedPayloadTag` pattern.
        case .previewFrame:
            await sendStructuredError(
                code: "unsupportedDirectPreview",
                message: "Live preview frames are not supported by this server.",
                unsupportedPayloadTag: "previewFrame",
                correlationID: envelope.envelopeID,
                session: session
            )
        case .previewInputEvent:
            await sendStructuredError(
                code: "unsupportedDirectPreview",
                message: "Live preview input events are not supported by this server.",
                unsupportedPayloadTag: "previewInputEvent",
                correlationID: envelope.envelopeID,
                session: session
            )
        case .previewSessionControl:
            await sendStructuredError(
                code: "unsupportedDirectPreview",
                message: "Live preview session control is not supported by this server.",
                unsupportedPayloadTag: "previewSessionControl",
                correlationID: envelope.envelopeID,
                session: session
            )
        // CodexBridge dependency added these payloads for its Mac → iOS
        // attachment-upload feature. AGBench doesn't accept inbound
        // attachment uploads on the direct LAN listener today, so we
        // explicitly reject with a structured error rather than silently
        // dropping (matches the `previewFrame` pattern above).
        case .attachmentUploadChunk:
            await sendStructuredError(
                code: "unsupportedDirectAttachment",
                message: "Direct attachment upload chunks are not supported by this server.",
                unsupportedPayloadTag: "attachmentUploadChunk",
                correlationID: envelope.envelopeID,
                session: session
            )
        case .attachmentUploadAck:
            await sendStructuredError(
                code: "unsupportedDirectAttachment",
                message: "Direct attachment upload acks are not supported by this server.",
                unsupportedPayloadTag: "attachmentUploadAck",
                correlationID: envelope.envelopeID,
                session: session
            )
        }
    }

    private func keyMaterial(for header: BridgeEnvelopeHeader) -> LANSession.PeerKeyMaterial? {
        guard header.direction == .controllerToMac else { return nil }
        guard header.recipientDeviceID == macDeviceID else { return nil }
        guard let trusted = trustedControllers.first(where: {
            $0.pairID == header.pairID && $0.controllerDeviceID == header.senderDeviceID
        }) else {
            return nil
        }
        return LANSession.PeerKeyMaterial(
            pairID: trusted.pairID,
            remoteDeviceID: trusted.controllerDeviceID,
            outboundKey: trusted.macToControllerKey,
            inboundKey: trusted.controllerToMacKey
        )
    }

    private func sendStructuredError(
        code: String,
        message: String,
        unsupportedPayloadTag: String,
        correlationID: String,
        session: LANSession
    ) async {
        try? await session.sendInbound(BridgeInboundEnvelope(
            correlationID: correlationID,
            payload: .structuredError(BridgeDirectStructuredErrorPayload(
                code: code,
                message: message,
                retryable: false,
                unsupportedPayloadTag: unsupportedPayloadTag,
                details: [:]
            ))
        ))
    }

    private func serverCapabilities() -> [String] {
        var values = [
            BridgeDirectProtocolCapability.subscribe,
            BridgeDirectProtocolCapability.recordBatch,
            BridgeDirectProtocolCapability.directStreamV2,
            BridgeDirectProtocolCapability.directJournalV1,
            BridgeDirectProtocolCapability.liveLedgerAckV1,
            BridgeDirectProtocolCapability.prepareStartTurn,
            BridgeDirectProtocolCapability.directPluginsV1,
            BridgeDirectProtocolCapability.directQUICV1,
            BridgeDirectProtocolCapability.directQUICMultiStreamV1
        ]
        if handlers.onMediaRequest != nil {
            values.append(BridgeDirectProtocolCapability.directMediaV1)
        }
        return values
    }

    private func quicBroadcastRoleMatches(payload: BridgeTransportPayload, session: LANSession) -> Bool {
        let sessionID = ObjectIdentifier(session)
        if let capabilities = capabilitiesBySessionID[sessionID],
           !capabilities.contains(BridgeDirectProtocolCapability.directQUICMultiStreamV1) {
            return true
        }
        guard let role = quicStreamRoleBySessionID[sessionID] else {
            return true
        }
        return role == Self.quicStreamRole(for: payload)
    }

    private func removeSession(_ session: LANSession) async {
        await session.stop()
        sessions.removeAll { $0 === session }
        let sessionID = ObjectIdentifier(session)
        capabilitiesBySessionID.removeValue(forKey: sessionID)
        quicStreamRoleBySessionID.removeValue(forKey: sessionID)
    }

    private static func quicStreamRole(for payload: BridgeTransportPayload) -> BridgeQUICStreamRole {
        switch payload {
        case .actionRecord, .actionWake, .prepareStartTurn, .actionAck, .prepareStartTurnAck:
            return .actions
        case .streamBatch, .recordBatch, .directRecord, .streamCommit, .durabilityCommit,
             .eventRecord, .stateSnapshot:
            return .events
        case .resumeStream, .replay:
            return .replay
        case .mediaRequest, .mediaChunk:
            return .replay
        case .hello, .quicStreamOpen, .quicStreamOpenAck, .subscribe, .subscribeV2,
             .structuredError, .ping, .pong, .watchedThreads:
            return .control
        // Preview payloads from CodexBridge: AGBench doesn't surface
        // previews so any inbound preview payload gets routed to the
        // closest semantic stream and then rejected by `dispatch()`.
        // (Mapping rationale: frame data is bulk like events; input
        // events are like actions; session control is like .control.)
        case .previewFrame:
            return .events
        case .previewInputEvent:
            return .actions
        case .previewSessionControl:
            return .control
        // Attachment-upload payloads — bulk file data is closest to
        // .events on the multi-stream split; acks are control-shaped.
        // `dispatch()` rejects both as unsupported.
        case .attachmentUploadChunk:
            return .events
        case .attachmentUploadAck:
            return .control
        }
    }
}

private final class EndpointBoundQUICListener: @unchecked Sendable {
    typealias KeyResolver = @Sendable (BridgeEnvelopeHeader) async -> LANSession.PeerKeyMaterial?
    typealias SessionHandler = @Sendable (LANSession) async -> Void

    private let bindHost: String
    private let port: UInt16
    private let macDeviceID: DeviceID
    private let keyResolver: KeyResolver
    private let sessionHandler: SessionHandler
    private let queue = DispatchQueue(label: "guigemini.bridge.tailscale.quic.listener")

    private var listener: NWListener?
    private var connectionGroups: [NWConnectionGroup] = []

    init(
        bindHost: String,
        port: UInt16,
        macDeviceID: DeviceID,
        keyResolver: @escaping KeyResolver,
        onAcceptedSession sessionHandler: @escaping SessionHandler
    ) {
        self.bindHost = bindHost
        self.port = port
        self.macDeviceID = macDeviceID
        self.keyResolver = keyResolver
        self.sessionHandler = sessionHandler
    }

    func start() throws {
        guard listener == nil else { return }
        guard let endpointPort = NWEndpoint.Port(rawValue: port) else {
            throw EndpointBoundQUICListenerError.invalidPort(port)
        }

        let security = DirectQUICSecurity.localServer()
        let parameters = DirectNetworkProtocol.quic.parameters(quicSecurity: security)
        parameters.requiredLocalEndpoint = .hostPort(
            host: NWEndpoint.Host(bindHost),
            port: endpointPort
        )
        parameters.allowLocalEndpointReuse = true

        let listener = try NWListener(using: parameters, on: endpointPort)
        listener.newConnectionGroupHandler = { [weak self] group in
            guard let self else {
                group.cancel()
                return
            }
            self.connectionGroups.append(group)
            group.newConnectionHandler = { [weak self] connection in
                guard let self else {
                    connection.cancel()
                    return
                }
                Task { await self.accept(connection: connection) }
            }
            group.start(queue: self.queue)
        }
        listener.start(queue: queue)
        self.listener = listener
    }

    func stop() {
        for group in connectionGroups {
            group.cancel()
        }
        connectionGroups.removeAll()
        listener?.cancel()
        listener = nil
    }

    private func accept(connection: NWConnection) async {
        let session = LANSession(
            connection: connection,
            configuration: LANSession.Configuration(
                role: .mac,
                localDeviceID: macDeviceID,
                transportKind: .quicTailscale,
                peerKeyResolver: keyResolver
            )
        )
        await session.start()
        await sessionHandler(session)
    }
}

private enum EndpointBoundQUICListenerError: Error, LocalizedError {
    case invalidPort(UInt16)

    var errorDescription: String? {
        switch self {
        case .invalidPort(let port):
            return "Invalid QUIC listener port: \(port)"
        }
    }
}
