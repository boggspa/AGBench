import Foundation
import BridgeCore
import BridgeCryptoPairing
import BridgeLANTransport

/// GuiGeminiBridgeDaemon — Phase C0 proof-of-life entry point.
///
/// At this stage the daemon does nothing beyond:
///   1. Configure `BridgeProductConfiguration.current` with GUIGemini's
///      product identifiers (so the BridgeCore transport stack uses the
///      right ALPN / Keychain entries / Bonjour service name when we wire
///      it up in Phase C2).
///   2. Print a single JSON line on stdout so the Electron parent can
///      confirm the daemon spawned successfully and read its protocol
///      capabilities.
///   3. Stay alive on stdin (blocks until stdin closes — i.e. parent dies).
///
/// Phase C1 will replace the print-and-block loop with a real JSON-RPC
/// dispatch over stdio. For now, this is enough to prove:
///   - The package compiles cleanly against BridgeCore.
///   - `BridgeProductConfiguration` accepts a GUIGemini preset and the
///     transport identifiers swap correctly.
///   - Electron can spawn + monitor the daemon process.

// MARK: - GUIGemini product preset

/// Identifiers the GUIGemini iOS bridge will use. Mirrors the shape of
/// `BridgeProductConfiguration.codex` but with GUIGemini-specific values.
/// Bundle IDs / app group / Bonjour service names / Keychain scopes all
/// distinct so a single iPhone can pair with both companions without
/// identifier collisions.
private let guiGeminiConfiguration = BridgeProductConfiguration(
    displayName: "GUIGemini",
    macBundleIdentifier: "com.example.AGBench.mac",
    iosBundleIdentifier: "com.example.AGBench.ios",
    appGroupIdentifier: "group.com.example.AGBench",
    cloudKitContainerIdentifier: "iCloud.com.example.AGBench",
    keychainServiceIdentifier: "com.example.AGBench",
    bonjourServiceType: "_guigemini._tcp",
    bonjourQUICServiceType: "_guigemini-quic._udp",
    directTCPPort: 38747,
    directQUICPort: 38747,
    quicTransport: QUICTransportIdentifiers(
        alpn: "guigemini-live-v1",
        p12Password: "guigemini-local-quic",
        keychainLabel: "GUIGemini QUIC Transport Identity",
        keychainDescription: "GUIGemini local QUIC transport identity",
        keychainServiceIdentifier: "com.example.AGBench.quicTransportIdentity",
        identityFileBasename: "GUIGeminiQUICIdentity",
        certificateCommonName: "GUIGemini QUIC",
        supportDirectoryName: "GUIGemini"
    )
)

// Install the GUIGemini preset BEFORE any BridgeCore consumer reads
// `.current`. Subsequent transport spin-up (Phase C2) will pick this up.
BridgeProductConfiguration.current = guiGeminiConfiguration

// MARK: - Lifetime + helpers

let startupTime = Date()
let protocolVersion = "0.0.11-phase-d1-pair"

/// Single serialized stdout sink shared by hello, the dispatcher's responses,
/// `BridgeNotifier`, and `BridgeRequester`. Constructed early because the
/// daemon-hello announcement should go through it too — once the hello is on
/// the wire, any background-thread writes will already be properly serialized.
let stdoutWriter = BridgeStdoutWriter()

func writeLine(_ line: String) {
    stdoutWriter.writeLine(line)
}

// MARK: - Proof-of-life announcement

let tailscaleEndpointResolver = TailscaleEndpointResolver()
let startupTailscaleEndpoint = tailscaleEndpointResolver.current()

struct DaemonDirectEndpoint: Encodable {
    let kind: String
    let transport: String
    let host: String?
    let port: UInt16
    let serviceName: String?
}

func advertisedDirectEndpoints(tailscaleEndpoint: TailscaleEndpoint) -> [DaemonDirectEndpoint] {
    var endpoints = [
        DaemonDirectEndpoint(
            kind: "quicBonjour",
            transport: "quic",
            host: nil,
            port: BridgeProductConfiguration.current.directQUICPort,
            serviceName: BridgeProductConfiguration.current.bonjourQUICServiceType
        )
    ]
    if let ipv4 = tailscaleEndpoint.ipv4 {
        endpoints.append(DaemonDirectEndpoint(
            kind: "quicTailscale",
            transport: "quic",
            host: ipv4,
            port: BridgeProductConfiguration.current.directQUICPort,
            serviceName: nil
        ))
    }
    return endpoints
}

struct DaemonHello: Encodable {
    let kind: String
    let daemon: String
    let protocolVersion: String
    let displayName: String
    let bonjourServiceType: String
    let bonjourQUICServiceType: String
    let quicALPN: String
    let directEndpoints: [DaemonDirectEndpoint]
    let tailscaleEndpoint: TailscaleEndpoint
    let pid: Int32
    let timestamp: String
}

let hello = DaemonHello(
    kind: "daemon-hello",
    daemon: "GuiGeminiBridgeDaemon",
    protocolVersion: protocolVersion,
    displayName: guiGeminiConfiguration.displayName,
    bonjourServiceType: guiGeminiConfiguration.bonjourServiceType,
    bonjourQUICServiceType: guiGeminiConfiguration.bonjourQUICServiceType,
    quicALPN: BridgeProductConfiguration.current.quicTransport.alpn,
    directEndpoints: advertisedDirectEndpoints(tailscaleEndpoint: startupTailscaleEndpoint),
    tailscaleEndpoint: startupTailscaleEndpoint,
    pid: ProcessInfo.processInfo.processIdentifier,
    timestamp: ISO8601DateFormatter().string(from: Date())
)

let encoder = JSONEncoder()
encoder.outputFormatting = .sortedKeys
if let helloData = try? encoder.encode(hello),
   let helloLine = String(data: helloData, encoding: .utf8) {
    // One line, newline-terminated — matches the JSON-RPC framing pattern
    // CodexAppServerClient already uses, so the Electron-side reader can
    // be a straight line-reader (no custom framing).
    writeLine(helloLine)
}

// MARK: - Pairing coordinator

// Persistent device store rooted at
// ~/Library/Application Support/<supportDirectoryName>/trusted-devices.json
let trustedDeviceStore: TrustedDeviceStore
do {
    trustedDeviceStore = try FileTrustedDeviceStore()
} catch {
    // Fall back to an in-memory store so the daemon still starts; the user
    // will see "0 trusted devices" but pairing operations still work for
    // this session. A real diagnostic event lands here in Phase C-late.
    FileHandle.standardError.write(Data("[GuiGeminiBridgeDaemon] WARN: file-backed device store unavailable: \(error.localizedDescription)\n".utf8))
    trustedDeviceStore = InMemoryTrustedDeviceStore()
}

// Mac identity signing key — generated fresh per daemon process for Phase C2.
// Persistence (Keychain) lands in Phase C-late. The identityKeyID derived
// from this key gets baked into each `TrustedDeviceRecord`, so today's
// regeneration on every restart means existing records lose the link to the
// signing key. Acceptable for v1 since we don't verify response signatures
// yet; the contract changes when signature verification is added.
let macIdentitySigningKey = DeviceIdentitySigningKey()
let macDeviceID = DeviceID(UUID().uuidString.lowercased())

// SecretStore — Keychain in production, in-memory fallback for tests / when
// Keychain is unavailable. `KeychainSecretStore` lives in BridgeCryptoPairing
// and uses the configured service identifier so a second host (the future
// GuiGemini companion shipping outside the daemon) can share the namespace.
// `allowsAuthenticationUI: false` so the daemon never prompts — items are
// stored with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (the
// KeychainSecretStore default), accessible after first unlock per boot.
let secretStore: SecretStore = KeychainSecretStore(
    service: BridgeProductConfiguration.current.keychainServiceIdentifier,
    accessGroup: nil,
    allowsAuthenticationUI: false
)

let pairingCoordinator = PairingCoordinator(
    deviceStore: trustedDeviceStore,
    secretStore: secretStore,
    macDeviceID: macDeviceID,
    macIdentitySigningKey: macIdentitySigningKey,
    tailscaleEndpointHintProvider: { @Sendable () -> String? in
        tailscaleEndpointResolver.current().quicEndpointHint(
            port: BridgeProductConfiguration.current.directQUICPort
        )
    }
)

// Notifier for daemon → Electron JSON-RPC notifications. Used by the
// transport listener's @Sendable handlers (which can fire from arbitrary
// threads) to publish `bridge.didReceive*` events. Owning it here keeps
// the daemon's notification surface in one place — future inbound paths
// (RunService events, approval prompts) reuse the same notifier.
let bridgeNotifier = BridgeNotifier(writer: stdoutWriter)

// Requester for daemon → Electron JSON-RPC requests (Phase C3.5). Pairs an
// outbound request with an awaitable response so transport handlers can
// actually consult Electron before building an ack (instead of returning the
// Phase C3 placeholder). Shares the stdout writer with the notifier so a
// request line can never split a notification line (or vice versa) at the
// byte level.
let bridgeRequester = BridgeRequester(writer: stdoutWriter)

let transportListener = TransportListener(
    deviceStore: trustedDeviceStore,
    secretStore: secretStore,
    macDeviceID: macDeviceID,
    notifier: bridgeNotifier,
    requester: bridgeRequester,
    tailscaleEndpointProvider: { @Sendable () -> TailscaleEndpoint in
        tailscaleEndpointResolver.current()
    }
)
let summaryBroadcaster = SummaryBroadcaster(transportListener: transportListener)

// Phase D1-pair: TCP pairing listener for the iOS pairing handshake.
// Advertised via Bonjour at the GUIGemini TCP service type so the
// iPhone's PairingChannelClient can NWBrowser-discover us. The listener
// itself is unauthenticated by design (pair-derived keys don't exist
// until pairing completes); security relies on the session-id being
// unguessable + the 6-digit transcript code matching on both ends.
let pairingChannelListener = PairingChannelListener(
    bonjourServiceType: BridgeProductConfiguration.current.bonjourServiceType,
    port: 0 // ephemeral; Bonjour publishes the resolved port
)

/// Re-encode a `Codable` Swift value as a Foundation tree (Dictionary / Array
/// / scalars) so it's compatible with `JSONSerialization` and therefore with
/// the JSON-RPC response builder. The dispatcher accepts `Any`-typed
/// JSONSerialization-shaped values; this bridges Codable types into that
/// shape without hand-writing serialization for every result struct.
func encodeAsJSONObject<T: Encodable>(_ value: T) throws -> Any {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.dataEncodingStrategy = .base64
    let data = try encoder.encode(value)
    return try JSONSerialization.jsonObject(with: data)
}

/// Decode a JSON-RPC params blob (a Foundation tree) into a typed Decodable.
func decodeParams<T: Decodable>(_ params: Any, as type: T.Type) throws -> T {
    let data = try JSONSerialization.data(withJSONObject: params)
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    decoder.dataDecodingStrategy = .base64
    return try decoder.decode(type, from: data)
}

/// Block until an async value resolves. The dispatcher's handler signature is
/// synchronous (`(Any) throws -> Any`), but PairingCoordinator is an actor —
/// every call into it is async. Bridge via DispatchSemaphore: only one
/// request is in flight at a time (single-threaded readLine loop) so there's
/// no contention risk.
func runBlocking<T: Sendable>(_ operation: @Sendable @escaping () async throws -> T) throws -> T {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<T, Error>!
    Task.detached {
        do {
            let value = try await operation()
            result = .success(value)
        } catch {
            result = .failure(error)
        }
        semaphore.signal()
    }
    semaphore.wait()
    return try result.get()
}

// Map `PairingCoordinator.PairingError` cases to JSON-RPC error codes.
func rpcError(from pairingError: PairingCoordinator.PairingError) -> JSONRPCError {
    switch pairingError {
    case .sessionNotFound(let sid):
        return JSONRPCError(code: JSONRPCErrorCode.bridgeUnavailable, message: "Pairing session not found: \(sid)")
    case .sessionAlreadyConfirmed(let sid):
        return JSONRPCError(code: JSONRPCErrorCode.invalidRequest, message: "Pairing session already confirmed: \(sid)")
    case .sessionExpired(let sid):
        return JSONRPCError(code: JSONRPCErrorCode.bridgeUnavailable, message: "Pairing session expired: \(sid)")
    case .malformedPublicKey:
        return JSONRPCError(code: JSONRPCErrorCode.invalidParams, message: "Malformed public key in pairing response")
    case .missingResponseForFinalize(let sid):
        return JSONRPCError(code: JSONRPCErrorCode.invalidRequest, message: "Cannot finalize pairing before confirmPairing: \(sid)")
    }
}

// MARK: - JSON-RPC dispatcher

let dispatcher = JSONRPCDispatcher()

func registerSummaryBroadcast(_ method: String, kind: SummaryBroadcastKind) {
    dispatcher.register(method) { rawParams in
        do {
            let eventJSON = try SummaryBroadcaster.makeEventJSON(
                kind: kind,
                params: rawParams,
                publishedAt: Date()
            )
            Task.detached { @Sendable [summaryBroadcaster, eventJSON] in
                await summaryBroadcaster.broadcast(eventJSON)
            }
            FileHandle.standardError.write(Data(
                "[\(method)] broadcast channel=\(kind.channel) bytes=\(eventJSON.count)\n".utf8
            ))
        } catch {
            FileHandle.standardError.write(Data(
                "[\(method)] WARN: \(String(describing: error))\n".utf8
            ))
        }
        return [String: Any]()
    }
}

/// `bridge.ping` — keep-alive heartbeat. Returns `{ "pong": true }`. Useful
/// for end-to-end round-trip tests and for the Electron client to verify the
/// daemon is responsive after a long idle period.
dispatcher.register("bridge.ping") { _ in
    return ["pong": true]
}

/// `bridge.status` — diagnostic snapshot of the daemon process state.
/// Mirrors what the Electron-side `BridgeDaemonClient.status()` returns plus
/// daemon-internal details (uptime, protocol version, paired devices, pending
/// pairing sessions).
dispatcher.register("bridge.status") { _ in
    let uptimeSeconds = Int(Date().timeIntervalSince(startupTime))
    let (pairedDeviceCount, pendingSessionCount, transportRunning) = try runBlocking { @Sendable [pairingCoordinator, trustedDeviceStore, transportListener] in
        let pending = await pairingCoordinator.pendingSessionCount()
        let paired: Int
        if let fileStore = trustedDeviceStore as? FileTrustedDeviceStore {
            paired = await fileStore.snapshot().filter { $0.pairingState == .active }.count
        } else {
            paired = 0
        }
        let running = await transportListener.isRunning()
        return (paired, pending, running)
    }
    return [
        "daemon": "GuiGeminiBridgeDaemon",
        "protocolVersion": protocolVersion,
        "pid": Int(ProcessInfo.processInfo.processIdentifier),
        "uptimeSeconds": uptimeSeconds,
        "startupTime": ISO8601DateFormatter().string(from: startupTime),
        "transportRunning": transportRunning,
        "pairedDeviceCount": pairedDeviceCount,
        "pendingPairingSessions": pendingSessionCount
    ]
}

// MARK: - Pairing RPCs (Phase C2)

struct BeginPairingParams: Decodable {
    let controllerDisplayName: String?
}

/// `bridge.beginPairing` — generates an ephemeral keypair + nonce, returns
/// a `PairingBootstrapPayload` the caller renders as a QR code. The session
/// id ties the subsequent `confirmPairing` and `finalizePairing` calls.
dispatcher.register("bridge.beginPairing") { params in
    let parsed: BeginPairingParams = (try? decodeParams(params, as: BeginPairingParams.self)) ?? BeginPairingParams(controllerDisplayName: nil)
    let displayName = parsed.controllerDisplayName ?? "iOS device"
    let result = try runBlocking { @Sendable [pairingCoordinator] in
        await pairingCoordinator.beginPairing(controllerDisplayName: displayName)
    }
    return try encodeAsJSONObject(result)
}

struct ConfirmPairingParams: Decodable {
    let response: PairingResponsePayload
}

/// `bridge.confirmPairing` — receives the iPhone's response, derives shared
/// keys, computes the 6-digit confirmation code. Returns the code for the
/// user to verify on both ends.
dispatcher.register("bridge.confirmPairing") { params in
    let parsed: ConfirmPairingParams
    do {
        parsed = try decodeParams(params, as: ConfirmPairingParams.self)
    } catch {
        throw JSONRPCError(code: JSONRPCErrorCode.invalidParams, message: "Invalid confirmPairing params: \(error.localizedDescription)")
    }
    let result: PairingCoordinator.ConfirmPairingResult
    do {
        result = try runBlocking { @Sendable [pairingCoordinator] in
            try await pairingCoordinator.confirmPairing(response: parsed.response)
        }
    } catch let pairingError as PairingCoordinator.PairingError {
        throw rpcError(from: pairingError)
    }
    return try encodeAsJSONObject(result)
}

struct FinalizePairingParams: Decodable {
    let pairingSessionID: String
    let userConfirmed: Bool
}

/// `bridge.finalizePairing` — if the user reports the codes matched on both
/// ends, persists a `TrustedDeviceRecord`. Otherwise discards the session.
/// Phase D1-pair: also signals the iOS pairing channel listener to ship
/// the final decision frame back over the still-open TCP connection so
/// the iPhone learns whether pairing succeeded.
dispatcher.register("bridge.finalizePairing") { params in
    let parsed: FinalizePairingParams
    do {
        parsed = try decodeParams(params, as: FinalizePairingParams.self)
    } catch {
        throw JSONRPCError(code: JSONRPCErrorCode.invalidParams, message: "Invalid finalizePairing params: \(error.localizedDescription)")
    }
    let result: PairingCoordinator.FinalizePairingResult
    do {
        result = try runBlocking { @Sendable [pairingCoordinator] in
            try await pairingCoordinator.finalizePairing(
                pairingSessionID: parsed.pairingSessionID,
                userConfirmed: parsed.userConfirmed
            )
        }
    } catch let pairingError as PairingCoordinator.PairingError {
        throw rpcError(from: pairingError)
    }
    // Phase D1-pair: relay the user's accept/reject back to the iPhone
    // via the still-open TCP pairing connection. Fire-and-forget — no
    // listener-connection is a no-op (e.g. iPhone disconnected).
    let sessionID = parsed.pairingSessionID
    let accepted = parsed.userConfirmed
    Task.detached { @Sendable [pairingChannelListener] in
        await pairingChannelListener.sendFinalDecision(
            sessionID: sessionID,
            accepted: accepted,
            message: accepted ? nil : "User did not confirm matching codes"
        )
    }
    return try encodeAsJSONObject(result)
}

/// `bridge.listTrustedDevices` — full snapshot of the persisted device store.
dispatcher.register("bridge.listTrustedDevices") { _ in
    let records = try runBlocking { @Sendable [trustedDeviceStore] in
        if let fileStore = trustedDeviceStore as? FileTrustedDeviceStore {
            return await fileStore.snapshot()
        }
        // InMemory fallback — no public snapshot, so we synthesize via a
        // lookup of the empty set (records start at zero and persistence
        // wouldn't survive a restart anyway). Phase C-late will add a
        // protocol-level snapshot method to TrustedDeviceStore.
        return [TrustedDeviceRecord]()
    }
    return try encodeAsJSONObject(records)
}

struct RevokeDeviceParams: Decodable {
    let deviceID: String
}

/// `bridge.revokeDevice` — marks a device record as revoked. The next
/// connection attempt from that pairID will be rejected by the transport
/// layer (Phase C3).
dispatcher.register("bridge.revokeDevice") { params in
    let parsed: RevokeDeviceParams
    do {
        parsed = try decodeParams(params, as: RevokeDeviceParams.self)
    } catch {
        throw JSONRPCError(code: JSONRPCErrorCode.invalidParams, message: "Invalid revokeDevice params: \(error.localizedDescription)")
    }
    let deviceID = DeviceID(parsed.deviceID)
    let revokedRecord: TrustedDeviceRecord? = try runBlocking { @Sendable [trustedDeviceStore] in
        await trustedDeviceStore.revoke(deviceID: deviceID, at: Date())
        return await trustedDeviceStore.record(for: deviceID)
    }
    return [
        "deviceID": parsed.deviceID,
        "revoked": revokedRecord?.pairingState == .revoked
    ]
}

// MARK: - Transport RPCs (Phase C3)

/// `bridge.startListening` — bind the QUIC port, publish via Bonjour, accept
/// paired controllers. Rejects with `bridgeUnavailable` when no devices are
/// paired yet (a server with zero trusted controllers can't authenticate
/// anyone, so the bind would be useless).
dispatcher.register("bridge.startListening") { _ in
    do {
        try runBlocking { @Sendable [transportListener] in
            try await transportListener.start()
        }
    } catch let err as TransportListener.TransportListenerError {
        switch err {
        case .alreadyRunning:
            throw JSONRPCError(code: JSONRPCErrorCode.invalidRequest, message: err.description)
        case .notRunning:
            throw JSONRPCError(code: JSONRPCErrorCode.invalidRequest, message: err.description)
        case .noTrustedDevices:
            throw JSONRPCError(code: JSONRPCErrorCode.bridgeUnavailable, message: err.description)
        case .underlying:
            throw JSONRPCError(code: JSONRPCErrorCode.internalError, message: err.description)
        }
    }
    let status = try runBlocking { @Sendable [transportListener] in
        await transportListener.status()
    }
    return try encodeAsJSONObject(status)
}

/// `bridge.stopListening` — tear down the QUIC server + un-publish Bonjour.
/// In-flight sessions are torn down by the underlying `LANBridgeServer.stop()`.
dispatcher.register("bridge.stopListening") { _ in
    do {
        try runBlocking { @Sendable [transportListener] in
            try await transportListener.stop()
        }
    } catch let err as TransportListener.TransportListenerError {
        switch err {
        case .notRunning:
            throw JSONRPCError(code: JSONRPCErrorCode.invalidRequest, message: err.description)
        default:
            throw JSONRPCError(code: JSONRPCErrorCode.internalError, message: err.description)
        }
    }
    let status = try runBlocking { @Sendable [transportListener] in
        await transportListener.status()
    }
    return try encodeAsJSONObject(status)
}

/// `bridge.listenerStatus` — read-only snapshot of the listener state.
/// Useful for the Electron settings UI to poll without trying to start.
dispatcher.register("bridge.listenerStatus") { _ in
    let status = try runBlocking { @Sendable [transportListener] in
        await transportListener.status()
    }
    return try encodeAsJSONObject(status)
}

// MARK: - Pairing channel diagnostic RPC (Phase D1-pair)

/// `bridge.pairingListenerStatus` — read-only snapshot for diagnostics
/// and the Electron-side pairing UI ("waiting for iPhone…" indicator).
dispatcher.register("bridge.pairingListenerStatus") { _ in
    let port = try runBlocking { @Sendable [pairingChannelListener] in
        await pairingChannelListener.boundPort()
    }
    return [
        "bonjourServiceType": BridgeProductConfiguration.current.bonjourServiceType,
        "running": port != nil,
        "port": port as Any
    ]
}

// MARK: - Diagnostic RPCs (Phase C1, extended for C2)

/// `bridge.getProductConfiguration` — full snapshot of the active
/// `BridgeProductConfiguration`. Used by the Electron-side settings UI to
/// display "what identifiers will iOS clients pair against", and by tests
/// to confirm the GUIGemini preset is in effect (vs accidentally falling
/// back to the Codex `.default`).
dispatcher.register("bridge.getProductConfiguration") { _ in
    let cfg = BridgeProductConfiguration.current
    return [
        "displayName": cfg.displayName,
        "macBundleIdentifier": cfg.macBundleIdentifier,
        "iosBundleIdentifier": cfg.iosBundleIdentifier,
        "appGroupIdentifier": cfg.appGroupIdentifier,
        "cloudKitContainerIdentifier": cfg.cloudKitContainerIdentifier,
        "keychainServiceIdentifier": cfg.keychainServiceIdentifier,
        "bonjourServiceType": cfg.bonjourServiceType,
        "bonjourQUICServiceType": cfg.bonjourQUICServiceType,
        "directTCPPort": Int(cfg.directTCPPort),
        "directQUICPort": Int(cfg.directQUICPort),
        "quicTransport": [
            "alpn": cfg.quicTransport.alpn,
            "keychainLabel": cfg.quicTransport.keychainLabel,
            "keychainServiceIdentifier": cfg.quicTransport.keychainServiceIdentifier,
            "certificateCommonName": cfg.quicTransport.certificateCommonName,
            "supportDirectoryName": cfg.quicTransport.supportDirectoryName
            // Note: p12Password and keychainDescription deliberately omitted
            // from the snapshot — the password is a secret and the description
            // is implementation-internal. Add if a real consumer needs them.
        ]
    ]
}

// MARK: - Notification RPCs (Phase C3-late)

/// `bridge.testNotify` — synthesize a daemon→Electron notification on demand.
/// Phase C3-late.3 smoke test: lets a Node-side client verify the notifier
/// path works end-to-end without needing a real iOS connection. The Electron
/// `BridgeDaemonClient.onNotification` callback should observe the message
/// with the given (or default) method + params.
///
/// We read params as a raw Foundation tree (`[String: Any]`) rather than via
/// a `Codable` intermediate so we don't need a custom JSON-tree decoder.
/// Earlier `AnyCodable` attempts tripped a Swift runtime trap (silent SIGTRAP
/// with no stderr) when scalar values came in via JSONDecoder's single-value
/// container probing — passing the dispatcher's already-decoded tree through
/// directly avoids the whole class of issue.
dispatcher.register("bridge.testNotify") { rawParams in
    let dict = (rawParams as? [String: Any]) ?? [:]
    let method = (dict["method"] as? String) ?? "bridge.testNotification"
    let payload: [String: Any] = (dict["payload"] as? [String: Any]) ?? [
        "ok": true,
        "source": "bridge.testNotify"
    ]
    bridgeNotifier.publish(method: method, params: payload)
    return [
        "published": true,
        "method": method
    ]
}

/// `bridge.testFireRequest` — synthesize a daemon→Electron REQUEST (not a
/// notification) on demand and await the response. Phase C3.5.4 smoke test:
/// proves the full round-trip works (stdout request → Electron handles →
/// stdin response → daemon awaiter resumed → final result returned).
///
/// Used by the round-trip smoke. Returns
///   `{ outboundMethod, daemonReceivedFromElectron: <whatever Electron replied with> }`
/// so the smoke can inspect both halves of the trip with one RPC call.
dispatcher.register("bridge.testFireRequest") { rawParams in
    // Read raw Foundation tree (same approach as bridge.testNotify) so we
    // don't need an AnyCodable-style intermediary for the loose JSON value.
    guard let dict = rawParams as? [String: Any],
          let outboundMethod = dict["outboundMethod"] as? String else {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "Invalid testFireRequest params: missing outboundMethod"
        )
    }
    let outboundParams = (dict["outboundParams"] as? [String: Any]) ?? [:]
    let outboundParamsJSON: Data
    do {
        outboundParamsJSON = try JSONSerialization.data(
            withJSONObject: outboundParams,
            options: [.sortedKeys]
        )
    } catch {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "Failed to encode outboundParams: \(error.localizedDescription)"
        )
    }
    let method = outboundMethod
    let timeout = (dict["timeoutSeconds"] as? NSNumber)?.doubleValue
    let resultData: Data
    do {
        resultData = try runBlocking { @Sendable [bridgeRequester, outboundParamsJSON, method, timeout] in
            try await bridgeRequester.request(
                method: method,
                paramsJSON: outboundParamsJSON,
                timeoutSeconds: timeout
            )
        }
    } catch let err as BridgeRequester.RequesterError {
        switch err {
        case .timeout:
            throw JSONRPCError(
                code: JSONRPCErrorCode.bridgeUnavailable,
                message: err.description
            )
        case .remote(let code, let message, _):
            throw JSONRPCError(code: code, message: message)
        case .encodingFailed:
            throw JSONRPCError(code: JSONRPCErrorCode.internalError, message: err.description)
        case .daemonShuttingDown:
            throw JSONRPCError(code: JSONRPCErrorCode.bridgeUnavailable, message: err.description)
        }
    }
    // Decode the Sendable Data back to a Foundation tree for the outer
    // dispatcher response. `.fragmentsAllowed` because the result might be
    // a scalar (e.g. `true`) rather than an object.
    let receivedFromElectron: Any
    if let decoded = try? JSONSerialization.jsonObject(with: resultData, options: [.fragmentsAllowed]) {
        receivedFromElectron = decoded
    } else {
        receivedFromElectron = NSNull()
    }
    return [
        "outboundMethod": outboundMethod,
        "daemonReceivedFromElectron": receivedFromElectron
    ]
}

// MARK: - Run-event forwarding (Phase C-late slice "stream events to iOS")

// Summary broadcasts (workspace/thread sidebar data) ride the same
// BridgeRunEvent stream as live run events. Electron sends these as
// fire-and-forget JSON-RPC notifications whenever desktop state changes.
registerSummaryBroadcast("bridge.broadcastWorkspaceList", kind: .workspaceList)
registerSummaryBroadcast("bridge.broadcastThreadList", kind: .threadList)
registerSummaryBroadcast("bridge.broadcastWorkspaceUpdated", kind: .workspaceUpdated)
registerSummaryBroadcast("bridge.broadcastThreadUpdated", kind: .threadUpdated)

/// `bridge.runEvent` — inbound notification (no id). Electron forwards every
/// run-bus event here via `BridgeRunEventSink`. For each event the daemon
/// re-encodes the params dict to JSON bytes and broadcasts via
/// `TransportListener.broadcastRunEvent`, which wraps in a
/// `BridgeTransportPayload.eventRecord(Data)` envelope and writes to every
/// connected iOS peer's QUIC connection. When no peers are connected
/// (typical until the iOS companion app exists), broadcast is a no-op.
///
/// Params shape: `{channel, provider, payload, publishedAt}`.
///
/// Dispatcher returns are discarded for notifications (no id); the empty
/// dict here is a no-op write.
dispatcher.register("bridge.runEvent") { rawParams in
    let dict = (rawParams as? [String: Any]) ?? [:]
    let channel = (dict["channel"] as? String) ?? "?"
    let provider = (dict["provider"] as? String) ?? "?"
    // `threadId` is a top-level hint the Electron-side sink extracts
    // from the payload's `appChatId`. When present, the daemon scopes
    // the QUIC broadcast to iOS pairs that have explicitly opted in to
    // events for that thread via sendWatchedThreads. When nil, the
    // daemon broadcasts to all connected pairs (backward-compat for
    // pre-subscription clients).
    let threadID = dict["threadId"] as? String
    // Re-encode the whole params dict to JSON bytes for the wire payload.
    // Sorted keys to make on-the-wire bytes stable for debugging / hashing.
    guard let payloadJSON = try? JSONSerialization.data(
        withJSONObject: dict,
        options: [.sortedKeys]
    ) else {
        FileHandle.standardError.write(Data(
            "[bridge.runEvent] WARN: failed to re-encode params for channel=\(channel) — dropping\n".utf8
        ))
        return [String: Any]()
    }
    // Off-thread broadcast — the dispatch loop must not block on async
    // actor calls (same dispatch-queue pattern the handler loop uses).
    Task.detached { @Sendable [transportListener, payloadJSON, threadID] in
        await transportListener.broadcastRunEvent(payloadJSON, threadID: threadID)
    }
    FileHandle.standardError.write(Data(
        "[bridge.runEvent] broadcast channel=\(channel) provider=\(provider) bytes=\(payloadJSON.count) threadID=\(threadID ?? "nil")\n".utf8
    ))
    return [String: Any]()
}

// MARK: - Pairing channel listener bootstrap (Phase D1-pair)

// Start the iOS pairing channel listener early so iPhones can pair
// from app launch. The listener binds an ephemeral TCP port + Bonjour-
// advertises at the GUIGemini service type; iOS-side
// `PairingChannelClient` discovers via the same name.
Task.detached { @Sendable [pairingChannelListener] in
    do {
        try await pairingChannelListener.start()
        if let port = await pairingChannelListener.boundPort() {
            FileHandle.standardError.write(Data(
                "[PairingChannelListener] started on port \(port) (Bonjour: \(BridgeProductConfiguration.current.bonjourServiceType))\n".utf8
            ))
        }
    } catch {
        FileHandle.standardError.write(Data(
            "[PairingChannelListener] WARN: failed to start: \(error.localizedDescription)\n".utf8
        ))
    }
}

// Drive the listener's incomingResponses stream through PairingCoordinator
// for code derivation, ship the code back to iOS, and notify Electron so
// the desktop UI surfaces the code for user verification. On any error,
// reject the pairing back to iOS with a structured message.
Task.detached { @Sendable [pairingChannelListener, pairingCoordinator, bridgeNotifier] in
    for await incoming in pairingChannelListener.incomingResponses {
        do {
            let result = try await pairingCoordinator.confirmPairing(response: incoming.response)
            await pairingChannelListener.sendConfirmationCode(
                sessionID: incoming.sessionID,
                code: result.confirmationCode
            )
            bridgeNotifier.publish(method: "bridge.didReceivePairingResponse", params: [
                "pairingSessionID": result.pairingSessionID,
                "controllerDeviceID": result.controllerDeviceID,
                "controllerDisplayName": result.controllerDisplayName,
                "confirmationCode": result.confirmationCode
            ])
        } catch let pairingError as PairingCoordinator.PairingError {
            // Tell the iPhone why and close the connection.
            let reason: String
            switch pairingError {
            case .sessionNotFound(let s): reason = "Unknown pairing session: \(s)"
            case .sessionAlreadyConfirmed(let s): reason = "Pairing session already confirmed: \(s)"
            case .sessionExpired(let s): reason = "Pairing session expired: \(s)"
            case .malformedPublicKey: reason = "Malformed public key"
            case .missingResponseForFinalize: reason = "Internal: missing response for finalize"
            }
            await pairingChannelListener.sendFinalDecision(
                sessionID: incoming.sessionID,
                accepted: false,
                message: reason
            )
            FileHandle.standardError.write(Data(
                "[PairingChannelListener] rejected session \(incoming.sessionID): \(reason)\n".utf8
            ))
        } catch {
            await pairingChannelListener.sendFinalDecision(
                sessionID: incoming.sessionID,
                accepted: false,
                message: "Mac-side coordinator error: \(error.localizedDescription)"
            )
            FileHandle.standardError.write(Data(
                "[PairingChannelListener] rejected session \(incoming.sessionID): \(error.localizedDescription)\n".utf8
            ))
        }
    }
}

// MARK: - Dispatch loop

// Read JSON-RPC traffic one-line-per-message from stdin. Three kinds of
// inbound lines:
//   1. Response to one of our OUTBOUND requests (id-correlated by
//      `BridgeRequester`). Handled there, dispatcher never sees it.
//   2. Inbound request (`{id, method, params}`) — `JSONRPCDispatcher`
//      handles it and we write the response back.
//   3. Inbound notification (`{method, params}` with no id) — dispatched
//      and the dispatcher returns nil.
//
// CRITICAL: handler dispatch MUST happen off this thread. Some handlers
// (e.g. `bridge.testFireRequest`) call `runBlocking` to await a
// `BridgeRequester.request(...)` — but the response that unblocks them
// arrives on stdin, which is THIS thread's job to read. Running the handler
// inline would deadlock the daemon. Fan out to a concurrent dispatch queue
// so the read loop stays free to deliver responses to `handleResponseLine`.
//
// Concurrency model:
//   - Read loop (this thread): one stdin line at a time, classify, dispatch.
//   - Handler queue (concurrent): N handlers in flight; each safe because
//     they own their state (actors / @unchecked Sendable wrappers).
//   - Stdout writer: serial queue inside `BridgeStdoutWriter` keeps line
//     framing intact across all writers.
//
// Outstanding outbound requests are canceled in shutdown so awaiting tasks
// see a structured error instead of hanging on their timeout.
let handlerQueue = DispatchQueue(
    label: "com.example.AGBench.daemon.handler",
    attributes: .concurrent
)

while let line = readLine(strippingNewline: false) {
    if bridgeRequester.handleResponseLine(line) {
        continue
    }
    handlerQueue.async {
        if let response = dispatcher.handleLine(line) {
            stdoutWriter.writeLine(response)
        }
    }
}

// stdin closed → parent terminated → exit cleanly. Before we go:
//   1. Drain the handler queue so any in-flight handlers finish.
//   2. Cancel pending outbound requests so awaiters see a structured error.
//   3. Flush the stdout writer so the last batch of responses /
//      notifications actually reaches the parent before the pipe closes.
// Without (1) a ping issued right before EOF would be silently dropped.
// Without (3) the response from such a ping can race process tear-down,
// which both loses output and occasionally trips a DispatchQueue runtime
// trap when work is queued during process exit.
handlerQueue.sync(flags: .barrier) {}
bridgeRequester.shutdown()
stdoutWriter.flush()
