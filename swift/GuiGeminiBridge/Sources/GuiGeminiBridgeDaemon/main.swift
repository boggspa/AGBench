import Foundation
import AppKit
// ScreenCaptureKit predates Swift 6 strict concurrency — `SCContentFilter`
// isn't `Sendable` in the SDK, but the filter we pass between the picker
// and the capture pipeline is only ever used in a fire-once, single-task
// flow (no cross-thread mutation), so `@preconcurrency` downgrades the
// strict-mode complaints to warnings without papering over real races.
@preconcurrency import ScreenCaptureKit
import BridgeCore
import BridgeCryptoPrimitives
import BridgeCryptoPairing
import BridgeLANTransport

/// GuiGeminiBridgeDaemon — Phase C0 proof-of-life entry point.
///
/// At this stage the daemon does nothing beyond:
///   1. Configure `BridgeProductConfiguration.current` with AGBench's
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
///   - `BridgeProductConfiguration` accepts an AGBench preset and the
///     transport identifiers swap correctly.
///   - Electron can spawn + monitor the daemon process.

// MARK: - AGBench product preset

/// Identifiers the AGBench iOS bridge will use. Mirrors the shape of
/// `BridgeProductConfiguration.codex` but with AGBench-specific values.
/// Bundle IDs / app group / Bonjour service names / Keychain scopes all
/// distinct so a single iPhone can pair with both companions without
/// identifier collisions.
private let guiGeminiConfiguration = BridgeProductConfiguration(
    displayName: "AGBench",
    macBundleIdentifier: "com.example.AGBench.mac",
    iosBundleIdentifier: "com.example.AGBench.ios",
    appGroupIdentifier: "group.com.example.AGBench",
    // Upstream BridgeProductConfiguration dropped `cloudKitContainerIdentifier`
    // in the BridgeCore drift before Phase M; keeping the GUIGemini-specific
    // identifier here would re-introduce the build break. CloudKit is not
    // used by AGBench's daemon path.
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

// Install the AGBench preset BEFORE any BridgeCore consumer reads
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

// Boot-time activation: if any trusted devices already exist from prior
// pairings (the common case after Electron restarts), bind the QUIC
// listener immediately so the iPad's reconnect attempts find a live
// peer without the user having to re-pair. When no trusted devices
// exist, this is a no-op — the listener stays cold until the first
// pair completes and `ensurePostPairTransportReady` activates it via
// the pairing-finalize path.
Task.detached { [transportListener] in
    do {
        try await transportListener.ensureRunningWithCurrentTrustedControllers()
        let status = await transportListener.status()
        FileHandle.standardError.write(Data(
            "[QUIC pipeline] boot activation OK running=\(status.running) trustedControllers=\(status.trustedControllerCount) service=\(status.bonjourServiceType) port=\(status.port.map(String.init) ?? "nil")\n".utf8
        ))
    } catch TransportListener.TransportListenerError.noTrustedDevices {
        FileHandle.standardError.write(Data(
            "[QUIC pipeline] boot activation skipped reason=no-trusted-devices (listener will start on first pair)\n".utf8
        ))
    } catch {
        FileHandle.standardError.write(Data(
            "[QUIC pipeline] WARN: boot activation failed error=\(error.localizedDescription)\n".utf8
        ))
    }
}

func localMacDisplayName() -> String {
    // Optional-typed array so Swift can infer the closure parameter as
    // `String?` and resolve `.whitespacesAndNewlines` against the
    // `CharacterSet` namespace cleanly. Prior version relied on implicit
    // contextual lookup that broke when the array's element type became
    // ambiguous after a BridgeCore drift.
    let candidates: [String?] = [
        Host.current().localizedName,
        ProcessInfo.processInfo.hostName,
        guiGeminiConfiguration.displayName
    ]
    return candidates
        .compactMap { (value: String?) in value?.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines) }
        .first { !$0.isEmpty } ?? guiGeminiConfiguration.displayName
}

func logQUICPipeline(_ message: String) {
    FileHandle.standardError.write(Data("[QUIC pipeline] \(message)\n".utf8))
}

func ensurePostPairTransportReady(
    result: PairingCoordinator.FinalizePairingResult,
    transportListener: TransportListener,
    source: String
) async {
    guard let decision = result.finalDecision, decision.accepted else { return }
    let pairID = decision.pairID ?? "nil"
    logQUICPipeline("post-pair activation requested source=\(source) pairID=\(pairID)")
    do {
        try await transportListener.ensureRunningWithCurrentTrustedControllers()
        let status = await transportListener.status()
        logQUICPipeline(
            "post-pair transport ready source=\(source) pairID=\(pairID) running=\(status.running) trustedControllers=\(status.trustedControllerCount) service=\(status.bonjourServiceType) port=\(status.port.map(String.init) ?? "nil")"
        )
    } catch {
        logQUICPipeline("WARN: post-pair transport activation failed source=\(source) pairID=\(pairID) error=\(error.localizedDescription)")
    }
}

// Phase D1-pair: TCP pairing listener for the iOS pairing handshake.
// Advertised via Bonjour at the GUIGemini TCP service type so the
// iPhone's PairingChannelClient can NWBrowser-discover us. The listener
// itself is unauthenticated by design (pair-derived keys don't exist
// until pairing completes); security relies on the session-id being
// unguessable + the 6-digit transcript code matching on both ends.
let pairingChannelListener = PairingChannelListener(
    bonjourServiceType: BridgeProductConfiguration.current.bonjourServiceType,
    port: 0, // ephemeral; Bonjour publishes the resolved port
    iosFinalDecisionHandler: { @Sendable sessionID, accepted, message in
        let result = try await pairingCoordinator.recordIOSFinalDecision(
            pairingSessionID: sessionID,
            accepted: accepted,
            message: message
        )
        guard let decision = result.finalDecision else { return nil }
        if decision.accepted {
            await ensurePostPairTransportReady(
                result: result,
                transportListener: transportListener,
                source: "ios-final-decision"
            )
        }
        return PairingChannelListener.PairingFinalDecisionFrame(
            accepted: decision.accepted,
            message: decision.message,
            pairID: decision.pairID
        )
    }
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

/// Variant of `runBlocking` for work that must run on the main actor — used
/// by the `attachedWindow.requestPick` handler because `SCContentSharingPicker`
/// must be presented from the main thread. The handler runs on the daemon's
/// concurrent handler queue (off main), so we hop onto the main actor via a
/// Task isolated to it; the main runloop (`NSApp.run()`) services it.
func runBlockingOnMain<T: Sendable>(
    _ operation: @MainActor @Sendable @escaping () async throws -> T
) throws -> T {
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
            let threadID = SummaryBroadcaster.threadID(kind: kind, params: rawParams)
            Task.detached { @Sendable [summaryBroadcaster, eventJSON, threadID] in
                await summaryBroadcaster.broadcast(eventJSON, threadID: threadID)
            }
            FileHandle.standardError.write(Data(
                "[\(method)] broadcast channel=\(RemoteProjectionEnvelope.channel) kind=\(kind.projectionKind) bytes=\(eventJSON.count) threadID=\(threadID ?? "nil")\n".utf8
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
    var object = try encodeAsJSONObject(result) as? [String: Any]
    if var bootstrap = object?["bootstrapPayload"] as? [String: Any] {
        bootstrap["macDisplayName"] = localMacDisplayName()
        object?["bootstrapPayload"] = bootstrap
    }
    if let object {
        return object
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
    // Phase D1-pair: record the desktop-side decision. If this completes
    // finalisation (either because both sides accepted, or because the Mac
    // rejected), relay the final frame to iOS. Otherwise keep the TCP
    // connection open until iOS sends its own final-decision frame.
    let sessionID = parsed.pairingSessionID
    let pairID = result.finalDecision?.pairID
    logPairingPipeline("finalizePairing session=\(sessionID) accepted=\(parsed.userConfirmed) pairID=\(pairID ?? "nil") waitingFor=\(result.waitingFor ?? "none")")
    if let decision = result.finalDecision {
        // Run post-pair transport activation + final-decision delivery off the
        // IPC's hot path. Two reasons:
        //   1. The renderer's `BridgeDaemonClient.request` has a 10s timeout.
        //      QUIC listener startup can exceed that when Tailscale binding
        //      flakes (NWError 22), and the Mac UI then shows a stuck modal
        //      while the daemon actually succeeded. Returning immediately lets
        //      the renderer dismiss the modal.
        //   2. Final-decision frame still has to wait for the listener so iOS
        //      finds a bound port to connect to — so the activation + frame
        //      send live in the same detached task in order.
        Task.detached { @Sendable [transportListener, result, pairingChannelListener, sessionID, decision] in
            if decision.accepted {
                await ensurePostPairTransportReady(
                    result: result,
                    transportListener: transportListener,
                    source: "mac-finalize"
                )
            }
            await pairingChannelListener.sendFinalDecision(
                sessionID: sessionID,
                accepted: decision.accepted,
                message: decision.message,
                pairID: decision.pairID
            )
        }
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
        // 1.0.6 — `Array<…>()` long form: Swift 6.2+ parses the `[T]()` short
        // form as a call on `[T.Type]` (an array literal of metatypes) and
        // fails "cannot call value of non-function type." Same fix already
        // applied at FileTrustedDeviceStore.swift:135.
        return Array<TrustedDeviceRecord>()
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
        // `cloudKitContainerIdentifier` was dropped from upstream
        // BridgeProductConfiguration during BridgeCore drift; the renderer
        // settings panel no longer reads it.
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

// MARK: - Attached window RPCs (Appshots-equivalent)

// In-memory handle table for windows the user has attached via the macOS
// system picker. Never persisted — dropped on daemon exit so a stale handle
// can never be used after restart. The AI side only ever sees the opaque
// handle string returned by `attachedWindow.requestPick`; window enumeration
// is contained within this daemon process.
let attachedWindowStore = AttachedWindowStore()

/// `attachedWindow.requestPick` — presents the macOS `SCContentSharingPicker`
/// on the main actor and waits for the user to either pick a single window or
/// cancel. Returns `{ handleID, windowMeta }` on success or
/// `{ cancelled: true }` if the user dismissed the picker. The picker IS the
/// security boundary: Apple's UI decides which windows the user can see and
/// pick, and the resulting filter is the implicit grant.
///
/// Picker delivers `(meta, filter)`; we store the filter in the handle table
/// so subsequent captures can call `SCScreenshotManager` directly without
/// re-enumerating windows. The meta returned to the caller is for the
/// renderer pill — pixels themselves require a separate `attachedWindow.capture`.
dispatcher.register("attachedWindow.requestPick") { _ in
    let picked: (meta: AttachedWindowMeta, filter: SCContentFilter)
    do {
        picked = try runBlockingOnMain { @MainActor @Sendable in
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<(meta: AttachedWindowMeta, filter: SCContentFilter), Error>) in
                let picker = AttachedWindowPicker()
                // Hold the picker alive until the observer callback fires.
                // Captured in the closure; the closure clears the reference
                // exactly once, in `finish()`, before the continuation fires.
                var strongPicker: AttachedWindowPicker? = picker
                picker.pick { result in
                    switch result {
                    case .success(let value):
                        continuation.resume(returning: value)
                    case .failure(let error):
                        continuation.resume(throwing: error)
                    }
                    strongPicker = nil
                    _ = strongPicker
                }
            }
        }
    } catch let err as AttachedWindowError {
        if case .cancelled = err {
            return ["cancelled": true]
        }
        throw JSONRPCError(code: JSONRPCErrorCode.internalError, message: err.localizedDescription)
    } catch {
        throw JSONRPCError(code: JSONRPCErrorCode.internalError, message: error.localizedDescription)
    }
    let entry = try runBlocking { @Sendable [attachedWindowStore, picked] in
        await attachedWindowStore.attach(meta: picked.meta, filter: picked.filter)
    }
    return [
        "ok": true,
        "handleID": entry.handleID,
        "windowMeta": entry.meta.toJSONObject()
    ]
}

struct AttachedWindowCaptureParams: Decodable {
    let handleID: String
    let includeOCR: Bool?
    let maxDimensionPx: Int?
}

/// `attachedWindow.capture` — captures one frame of the previously attached
/// window via `SCScreenshotManager`, optionally runs local Vision OCR, and
/// returns base64 PNG bytes plus structured OCR. No streaming; one call =
/// one frame. The Electron side gates each call through its existing
/// approval flow before forwarding here.
dispatcher.register("attachedWindow.capture") { params in
    let parsed: AttachedWindowCaptureParams
    do {
        parsed = try decodeParams(params, as: AttachedWindowCaptureParams.self)
    } catch {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "Invalid capture params: \(error.localizedDescription)"
        )
    }
    let entry = try runBlocking { @Sendable [attachedWindowStore, handleID = parsed.handleID] in
        await attachedWindowStore.entry(handleID: handleID)
    }
    guard let entry else {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidRequest,
            message: "Attached window handle not found (already detached or never attached)."
        )
    }
    let maxDim = parsed.maxDimensionPx ?? 1600
    let frame: CapturedWindowFrame
    do {
        frame = try runBlocking { @Sendable [filter = entry.filter, maxDim] in
            try await AttachedWindowCapture.captureWindow(
                filter: filter,
                maxDimensionPx: maxDim
            )
        }
    } catch let err as AttachedWindowError {
        if case .windowGone = err {
            // Self-heal: drop the dead handle so the renderer's status pill
            // clears on its next poll. The error code lets the Electron side
            // surface a clean "window closed, please re-attach" message.
            _ = try? runBlocking { @Sendable [attachedWindowStore, handleID = entry.handleID] in
                await attachedWindowStore.detach(handleID: handleID)
            }
            throw JSONRPCError(
                code: JSONRPCErrorCode.bridgeUnavailable,
                message: err.localizedDescription
            )
        }
        throw JSONRPCError(code: JSONRPCErrorCode.internalError, message: err.localizedDescription)
    } catch {
        throw JSONRPCError(code: JSONRPCErrorCode.internalError, message: error.localizedDescription)
    }

    var response: [String: Any] = [
        "ok": true,
        "pngBase64": frame.pngData.base64EncodedString(),
        "byteLength": frame.pngData.count,
        "width": frame.width,
        "height": frame.height,
        "windowMeta": entry.meta.toJSONObject(),
        "capturedAt": ISO8601DateFormatter().string(from: Date())
    ]
    if parsed.includeOCR ?? true {
        do {
            let ocr = try runBlocking { @Sendable [pngData = frame.pngData] in
                try await AttachedWindowOCR.recognize(pngData: pngData)
            }
            response["ocr"] = ocr.toJSONObject()
        } catch {
            // OCR failure isn't fatal — return the image without text. Surfaces
            // the underlying error inline so the user can spot why text is
            // missing from a capture without losing the frame entirely.
            response["ocrError"] = error.localizedDescription
        }
    }
    return response
}

struct AttachedWindowDetachParams: Decodable {
    let handleID: String
}

/// `attachedWindow.detach` — releases the picker grant for a handle.
/// Subsequent capture calls against that handle return a not-found error.
/// Safe to call for unknown handles (returns `{ detached: false }`).
dispatcher.register("attachedWindow.detach") { params in
    let parsed: AttachedWindowDetachParams
    do {
        parsed = try decodeParams(params, as: AttachedWindowDetachParams.self)
    } catch {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "Invalid detach params: \(error.localizedDescription)"
        )
    }
    let detached = try runBlocking { @Sendable [attachedWindowStore, handleID = parsed.handleID] in
        await attachedWindowStore.detach(handleID: handleID)
    }
    return ["ok": true, "detached": detached]
}

/// `attachedWindow.status` — lightweight status check. Returns whether any
/// window is currently attached and, if so, just the title/bundle metadata
/// the user already sees in the renderer pill. Used by the `attached_window_status`
/// MCP tool, which is auto-allowed (no approval) precisely because this
/// payload contains no enumeration and no pixel data.
dispatcher.register("attachedWindow.status") { _ in
    let current = try runBlocking { @Sendable [attachedWindowStore] in
        await attachedWindowStore.current()
    }
    guard let current else {
        return ["attached": false] as [String: Any]
    }
    return [
        "attached": true,
        "handleID": current.handleID,
        "windowMeta": current.meta.toJSONObject(),
        "attachedAt": ISO8601DateFormatter().string(from: current.createdAt)
    ]
}

// MARK: - Appwatch RPCs (Phase M1)
//
// `appwatch.*` extends the single-shot `attachedWindow.capture` (Appshots)
// flow with a low-fps SCStream into a small ring buffer. The agent gets
// "the last frame" or "frames since T" without per-frame ScreenCaptureKit
// overhead. M1 surface is the latest-frame pull only; M2 adds since/count
// batch retrieval and per-frame OCR.
//
// Lifecycle:
//   - `appwatch.start` requires a previously-attached handle (no auto-pick).
//     Idempotent: a second start with the same handle returns the existing
//     config without restarting the stream.
//   - `appwatch.stop` tears the stream down and clears the ring.
//   - 60s without a `appwatch.latestFrame` call auto-stops (idle timeout).
//   - Stream is also stopped on `attachedWindow.detach` (handled inside the
//     store) and on daemon exit.

struct AppwatchStartParams: Decodable {
    let handleID: String
    let fps: Int?
    let bufferSeconds: Int?
    let maxDimensionPx: Int?
}

struct AppwatchFramesParams: Decodable {
    let handleID: String
    let since: String?
    let count: Int?
    let format: String?
    let includeOCR: Bool?

    enum CodingKeys: String, CodingKey {
        case handleID
        case since
        case count
        case format
        case includeOCR
        case includeOCRSnake = "include_ocr"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        handleID = try container.decode(String.self, forKey: .handleID)
        since = try container.decodeIfPresent(String.self, forKey: .since)
        count = try container.decodeIfPresent(Int.self, forKey: .count)
        format = try container.decodeIfPresent(String.self, forKey: .format)
        includeOCR =
            try container.decodeIfPresent(Bool.self, forKey: .includeOCR)
            ?? container.decodeIfPresent(Bool.self, forKey: .includeOCRSnake)
    }
}

@Sendable func appwatchISO8601(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

@Sendable func parseAppwatchISO8601(_ value: String?) -> Date? {
    guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        return nil
    }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: value) {
        return date
    }
    return ISO8601DateFormatter().date(from: value)
}

/// Build the `streaming` object the renderer pill (and the main-side snapshot)
/// renders. Shared by `appwatch.start` and `appwatch.status` so both surfaces
/// stay structurally identical — saves a renderer-side type fork.
@Sendable func makeStreamingPayload(
    config: AppwatchStreamConfig,
    frameCount: Int
) -> [String: Any] {
    return [
        "fps": config.fps,
        "bufferSeconds": config.bufferSeconds,
        "frameCount": frameCount,
        "frameCapacity": config.frameCapacity,
        "estimatedMemoryMB": config.estimatedMemoryMB,
        "memoryBudgetMB": AttachedWindowStream.memoryBudgetMB,
        "startedAt": appwatchISO8601(config.startedAt)
    ]
}

/// Look up an attached entry by handle, normalising the "no such handle"
/// case into a structured JSON-RPC error so every appwatch handler returns
/// the same shape. Used as the first line in each handler below.
@Sendable func resolveAttachedEntry(
    store: AttachedWindowStore,
    handleID: String
) throws -> AttachedWindowEntry {
    let entry = try runBlocking { @Sendable [store, handleID] in
        await store.entry(handleID: handleID)
    }
    guard let entry else {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidRequest,
            message: "Attached window handle not found (already detached or never attached)."
        )
    }
    return entry
}

/// `appwatch.start` — spin up the SCStream for an already-attached window.
/// Requires a valid handleID. Idempotent: a second start returns the existing
/// config without restarting the stream. Refuses if the configured buffer
/// would exceed the 350 MB memory cap (memoryBudgetExceeded → -32001).
dispatcher.register("appwatch.start") { params in
    let parsed: AppwatchStartParams
    do {
        parsed = try decodeParams(params, as: AppwatchStartParams.self)
    } catch {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "Invalid appwatch.start params: \(error.localizedDescription)"
        )
    }
    let entry = try resolveAttachedEntry(store: attachedWindowStore, handleID: parsed.handleID)
    let fps = parsed.fps ?? 5
    let bufferSeconds = parsed.bufferSeconds ?? 8
    let maxDimensionPx = parsed.maxDimensionPx ?? 1280

    // Reuse the existing stream when present so the handler is idempotent;
    // construct a fresh one on first start. The store's `setStream` will
    // stop and replace if the agent ever passes us a brand-new stream.
    let stream = entry.stream ?? AttachedWindowStream()
    let config: AppwatchStreamConfig
    do {
        config = try runBlocking { @Sendable [stream, filter = entry.filter, fps, bufferSeconds, maxDimensionPx] in
            try await stream.start(
                filter: filter,
                fps: fps,
                bufferSeconds: bufferSeconds,
                maxDimensionPx: maxDimensionPx
            )
        }
    } catch let err as AppwatchError {
        switch err {
        case .memoryBudgetExceeded:
            // Distinct from -32001 (bridgeUnavailable / window gone) so
            // the agent can retune bufferSeconds / fps / maxDimensionPx
            // without us also clearing the attached-window state on
            // the Electron side.
            throw JSONRPCError(
                code: JSONRPCErrorCode.appwatchBudgetExceeded,
                message: err.localizedDescription
            )
        case .invalidConfig:
            throw JSONRPCError(
                code: JSONRPCErrorCode.invalidParams,
                message: err.localizedDescription
            )
        default:
            throw JSONRPCError(
                code: JSONRPCErrorCode.internalError,
                message: err.localizedDescription
            )
        }
    } catch {
        throw JSONRPCError(
            code: JSONRPCErrorCode.internalError,
            message: error.localizedDescription
        )
    }
    let frameCount = try runBlocking { @Sendable [stream] in
        await stream.status().frameCount
    }
    if entry.stream == nil {
        try runBlocking { @Sendable [attachedWindowStore, stream, handleID = parsed.handleID] in
            await attachedWindowStore.setStream(stream, for: handleID)
        }
    }
    return [
        "ok": true,
        "handleID": parsed.handleID,
        "streaming": makeStreamingPayload(config: config, frameCount: frameCount)
    ]
}

struct AppwatchHandleParams: Decodable {
    let handleID: String
}

/// `appwatch.stop` — tear down the stream and clear the ring. Safe to call
/// when not streaming (returns `{ ok: true, streaming: false }`).
dispatcher.register("appwatch.stop") { params in
    let parsed: AppwatchHandleParams
    do {
        parsed = try decodeParams(params, as: AppwatchHandleParams.self)
    } catch {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "Invalid appwatch.stop params: \(error.localizedDescription)"
        )
    }
    let entry = try resolveAttachedEntry(store: attachedWindowStore, handleID: parsed.handleID)
    guard let stream = entry.stream else {
        return [
            "ok": true,
            "handleID": parsed.handleID,
            "streaming": false
        ] as [String: Any]
    }
    try runBlocking { @Sendable [stream] in
        await stream.stop()
    }
    try runBlocking { @Sendable [attachedWindowStore, handleID = parsed.handleID] in
        await attachedWindowStore.clearStream(for: handleID)
    }
    return [
        "ok": true,
        "handleID": parsed.handleID,
        "streaming": false
    ]
}

/// `appwatch.status` — non-mutating read of the stream state. Does NOT bump
/// the idle-timeout pull clock — the renderer pill polls this every second
/// and we don't want a UI poll to keep the stream alive after the agent
/// stopped pulling frames.
dispatcher.register("appwatch.status") { params in
    let parsed: AppwatchHandleParams
    do {
        parsed = try decodeParams(params, as: AppwatchHandleParams.self)
    } catch {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "Invalid appwatch.status params: \(error.localizedDescription)"
        )
    }
    let entry = try resolveAttachedEntry(store: attachedWindowStore, handleID: parsed.handleID)
    guard let stream = entry.stream else {
        return [
            "ok": true,
            "handleID": parsed.handleID,
            "streaming": false
        ] as [String: Any]
    }
    let status = try runBlocking { @Sendable [stream] in
        await stream.status()
    }
    var payload: [String: Any] = [
        "ok": true,
        "handleID": parsed.handleID,
        "streaming": status.streaming,
        "fps": status.fps,
        "bufferSeconds": status.bufferSeconds,
        "frameCount": status.frameCount,
        "frameCapacity": status.frameCapacity,
        "estimatedMemoryMB": status.estimatedMemoryMB,
        "memoryBudgetMB": status.memoryBudgetMB
    ]
    if let oldest = status.oldestAt {
        payload["oldestAt"] = appwatchISO8601(oldest)
    }
    if let newest = status.newestAt {
        payload["newestAt"] = appwatchISO8601(newest)
    }
    if let pulled = status.lastPullAt {
        payload["lastPullAt"] = appwatchISO8601(pulled)
    }
    if let started = status.startedAt {
        payload["startedAt"] = appwatchISO8601(started)
    }
    return payload
}

/// `appwatch.latestFrame` — return the most recent BGRA frame from the ring
/// as PNG bytes. M1 surface; M2 will add `since` / `count` for batch pulls.
/// Bumps the idle-timeout pull clock so an active agent loop keeps the
/// stream alive.
dispatcher.register("appwatch.latestFrame") { params in
    let parsed: AppwatchHandleParams
    do {
        parsed = try decodeParams(params, as: AppwatchHandleParams.self)
    } catch {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "Invalid appwatch.latestFrame params: \(error.localizedDescription)"
        )
    }
    let entry = try resolveAttachedEntry(store: attachedWindowStore, handleID: parsed.handleID)
    guard let stream = entry.stream else {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidRequest,
            message: "Appwatch is not streaming for this handle (call appwatch.start first)."
        )
    }
    let frame = try runBlocking { @Sendable [stream] in
        await stream.latestFrame()
    }
    guard let frame else {
        // Stream is up but no frame has landed yet. Tell the renderer the
        // truth (ok=true, frame=null) so it can show a "warming up" beat
        // rather than a hard error.
        return [
            "ok": true,
            "handleID": parsed.handleID,
            "hasFrame": false
        ] as [String: Any]
    }
    let pngData: Data
    do {
        pngData = try AppwatchFrameEncoder.encodePNG(frame: frame)
    } catch let err as AppwatchError {
        throw JSONRPCError(
            code: JSONRPCErrorCode.internalError,
            message: err.localizedDescription
        )
    } catch {
        throw JSONRPCError(
            code: JSONRPCErrorCode.internalError,
            message: error.localizedDescription
        )
    }
    return [
        "ok": true,
        "handleID": parsed.handleID,
        "hasFrame": true,
        "pngBase64": pngData.base64EncodedString(),
        "byteLength": pngData.count,
        "width": frame.width,
        "height": frame.height,
        "capturedAt": appwatchISO8601(frame.capturedAt)
    ]
}

/// `appwatch.frames` — return a chronological batch from the ring buffer,
/// optionally newer than a fractional-second ISO timestamp. This powers
/// M2 agent loops that want a small visual sequence instead of polling one
/// latest frame repeatedly.
dispatcher.register("appwatch.frames") { params in
    let parsed: AppwatchFramesParams
    do {
        parsed = try decodeParams(params, as: AppwatchFramesParams.self)
    } catch {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "Invalid appwatch.frames params: \(error.localizedDescription)"
        )
    }
    let entry = try resolveAttachedEntry(store: attachedWindowStore, handleID: parsed.handleID)
    guard let stream = entry.stream else {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidRequest,
            message: "Appwatch is not streaming for this handle (call appwatch.start first)."
        )
    }
    let includeOCR = parsed.includeOCR ?? false
    let requestedCount = parsed.count ?? 5
    let countLimit = includeOCR ? 5 : 20
    let count = max(1, min(countLimit, requestedCount))
    let format = (parsed.format ?? "jpeg").lowercased() == "png" ? "png" : "jpeg"
    let since = parseAppwatchISO8601(parsed.since)
    let batch = try runBlocking { @Sendable [stream, since, count] in
        await stream.frames(since: since, count: count)
    }

    var framesPayload: [[String: Any]] = []
    framesPayload.reserveCapacity(batch.frames.count)
    for (index, frame) in batch.frames.enumerated() {
        let imageData: Data
        do {
            imageData = format == "png"
                ? try AppwatchFrameEncoder.encodePNG(frame: frame)
                : try AppwatchFrameEncoder.encodeJPEG(frame: frame)
        } catch let err as AppwatchError {
            throw JSONRPCError(
                code: JSONRPCErrorCode.internalError,
                message: err.localizedDescription
            )
        } catch {
            throw JSONRPCError(
                code: JSONRPCErrorCode.internalError,
                message: error.localizedDescription
            )
        }

        var framePayload: [String: Any] = [
            "index": index,
            "capturedAt": appwatchISO8601(frame.capturedAt),
            "mimeType": format == "png" ? "image/png" : "image/jpeg",
            "imageBase64": imageData.base64EncodedString(),
            "byteLength": imageData.count,
            "width": frame.width,
            "height": frame.height
        ]
        if includeOCR {
            do {
                let ocr = try runBlocking { @Sendable [imageData] in
                    try await AttachedWindowOCR.recognize(pngData: imageData)
                }
                framePayload["ocr"] = ocr.toJSONObject()
            } catch {
                framePayload["ocrError"] = error.localizedDescription
            }
        }
        framesPayload.append(framePayload)
    }

    var payload: [String: Any] = [
        "ok": true,
        "handleID": parsed.handleID,
        "hasFrames": !framesPayload.isEmpty,
        "returned": framesPayload.count,
        "requested": requestedCount,
        "count": count,
        "format": format,
        "includeOCR": includeOCR,
        "availableCapturedAt": batch.availableCapturedAt.map { appwatchISO8601($0) },
        "frames": framesPayload
    ]
    if let nextSince = batch.nextSince {
        payload["nextSince"] = appwatchISO8601(nextSince)
    }
    return payload
}

// MARK: - Creative-app probe (Phase K1)
//
// `creative.runningApplications` — answers "is bundle id X currently running?"
// for one or more requested bundle ids. Used by `creative_app_status` /
// `creative_app_capabilities` on the renderer side to upgrade the status
// snapshot from "installed" (a `fileExists` check) to "installed + running".
//
// Params shape: `{ bundleIds: [string] }`. Returns `{ [bundleId]: bool }`.
// Empty input → empty map; the renderer's caching layer treats that as a
// safe no-op.
dispatcher.register("creative.runningApplications") { params in
    let dict = (params as? [String: Any]) ?? [:]
    guard let bundleIds = dict["bundleIds"] as? [String] else {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "creative.runningApplications expects { bundleIds: [string] }"
        )
    }
    return CreativeAppProbe.runningBundleIds(bundleIds)
}

// MARK: - Creative-app file dispatch (Phase K3)
//
// `creative.openWithApp` — hand a file to a specific app via
// `NSWorkspace.shared.open(_:withApplicationAt:configuration:)`. The
// renderer is responsible for gating: scope the path, validate the
// bundle id against the declared creative-app set, and obtain user
// approval (Phase K3 approval modal). The Swift side just executes
// the transport.
//
// Params: `{ filePath: string, bundleId: string }`.
// Returns: `{ ok, bundleId, appURL, filePath, pid }`.
dispatcher.register("creative.openWithApp") { params in
    let dict = (params as? [String: Any]) ?? [:]
    guard let filePath = dict["filePath"] as? String, !filePath.isEmpty else {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "creative.openWithApp expects { filePath: string }"
        )
    }
    guard let bundleId = dict["bundleId"] as? String, !bundleId.isEmpty else {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "creative.openWithApp expects { bundleId: string }"
        )
    }
    return try CreativeWorkspaceOpener.openWithApp(filePath: filePath, bundleId: bundleId)
}

// `creative.runAppleScript` — execute an AppleScript source string in-
// process via OSAKit, with a default 10s timeout. Phase K4. The Swift
// side does NOT gate the call; the renderer-side
// `creative_applescript_dispatch` MCP tool is responsible for class
// approval before this method is invoked.
//
// Params: `{ source: string, timeoutMs?: number }`.
// Returns: `{ ok, result, durationMs }`. Compile + runtime errors
// surface as JSON-RPC error responses.
dispatcher.register("creative.runAppleScript") { params in
    let dict = (params as? [String: Any]) ?? [:]
    guard let source = dict["source"] as? String, !source.isEmpty else {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "creative.runAppleScript expects { source: string }"
        )
    }
    let timeoutMs = (dict["timeoutMs"] as? Int) ?? 10_000
    return try CreativeAppleScriptRunner.runScript(source: source, timeoutMs: timeoutMs)
}

// `creative.runBlenderPython` — execute a Python script inside Blender's
// `--background --python` mode via Process(). Phase K5. The script runs
// in a per-invocation sandbox tempdir set as Blender's cwd. The Swift
// side does NOT gate; the renderer-side `creative_blender_python` MCP
// tool handles class approval before dispatch.
//
// Params: `{ pythonSource: string, inputBlendPath?: string, timeoutMs?: number }`.
// Returns: `{ ok, exitCode, stdout, stderr, tempDir, durationMs }`.
dispatcher.register("creative.runBlenderPython") { params in
    let dict = (params as? [String: Any]) ?? [:]
    guard let pythonSource = dict["pythonSource"] as? String, !pythonSource.isEmpty else {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "creative.runBlenderPython expects { pythonSource: string }"
        )
    }
    let inputBlendPath = dict["inputBlendPath"] as? String
    let timeoutMs = (dict["timeoutMs"] as? Int) ?? 30_000
    return try CreativeBlenderPythonRunner.runScript(
        pythonSource: pythonSource,
        inputBlendPath: inputBlendPath,
        timeoutMs: timeoutMs
    )
}

// `creative.dispatchMIDI` — send a single MIDI event through the
// daemon's virtual "AGBench" Core MIDI source. Logic Pro (or any MIDI
// listener) can route this source as an input. Phase K6.
//
// Params: `{ eventType: string, ...event-specific params }`. See
// CreativeMIDITransport.buildEventBytes for the per-event shape.
dispatcher.register("creative.dispatchMIDI") { params in
    let dict = (params as? [String: Any]) ?? [:]
    guard let eventType = dict["eventType"] as? String, !eventType.isEmpty else {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "creative.dispatchMIDI expects { eventType: string }"
        )
    }
    return try CreativeMIDITransport.dispatchEvent(eventType: eventType, params: dict)
}

// MARK: - Phase L — Editor / IDE transports
//
// `editor.openAtPosition` — shell out to an editor's CLI shim with a
// pre-built positional arg list. The TS-side `EditorAdapters` knows
// the per-editor positional syntax; Swift just resolves the binary on
// PATH and runs it.
//
// Params: `{ cliCommand: string, args: [string], timeoutMs?: number }`.
// Returns: `{ ok, exitCode, cliCommand, resolvedPath, durationMs }`.
dispatcher.register("editor.openAtPosition") { params in
    let dict = (params as? [String: Any]) ?? [:]
    guard let cliCommand = dict["cliCommand"] as? String, !cliCommand.isEmpty else {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "editor.openAtPosition expects { cliCommand: string }"
        )
    }
    let args = (dict["args"] as? [String]) ?? []
    let timeoutMs = (dict["timeoutMs"] as? Int) ?? 5_000
    return try EditorPositionalOpener.openAtPosition(
        cliCommand: cliCommand,
        args: args,
        timeoutMs: timeoutMs
    )
}

// `workspace.revealInFinder` — open Finder with a specific file
// selected. Trivial wrapper around NSWorkspace.shared.selectFile.
// Params: `{ filePath: string }`.
dispatcher.register("workspace.revealInFinder") { params in
    let dict = (params as? [String: Any]) ?? [:]
    guard let filePath = dict["filePath"] as? String else {
        throw JSONRPCError(
            code: JSONRPCErrorCode.invalidParams,
            message: "workspace.revealInFinder expects { filePath: string }"
        )
    }
    return try FinderReveal.reveal(filePath: filePath)
}

// MARK: - Run-event forwarding (Phase C-late slice "stream events to iOS")

// Summary broadcasts (workspace/thread sidebar data) ride the same
// BridgeRunEvent stream as live run events. Electron sends these as
// fire-and-forget JSON-RPC notifications whenever desktop state changes.
registerSummaryBroadcast("bridge.broadcastWorkspaceList", kind: .workspaceList)
registerSummaryBroadcast("bridge.broadcastThreadList", kind: .threadList)
registerSummaryBroadcast("bridge.broadcastWorkspaceUpdated", kind: .workspaceUpdated)
registerSummaryBroadcast("bridge.broadcastThreadUpdated", kind: .threadUpdated)

/// `bridge.remoteProjection` — generic typed Remote Task Console projection.
/// Electron can send `{kind, payload, threadId?}` and the daemon forwards it
/// over the same direct event path as run events using one
/// `{channel:"remote-projection", kind, payload}` envelope.
dispatcher.register("bridge.remoteProjection") { rawParams in
    do {
        let projection = try SummaryBroadcaster.makeRemoteProjectionEventJSON(
            params: rawParams,
            publishedAt: Date()
        )
        Task.detached { @Sendable [summaryBroadcaster, projection] in
            await summaryBroadcaster.broadcast(projection.data, threadID: projection.threadID)
        }
        FileHandle.standardError.write(Data(
            "[bridge.remoteProjection] broadcast bytes=\(projection.data.count) threadID=\(projection.threadID ?? "nil")\n".utf8
        ))
    } catch {
        FileHandle.standardError.write(Data(
            "[bridge.remoteProjection] WARN: \(String(describing: error))\n".utf8
        ))
    }
    return [String: Any]()
}

/// `bridge.broadcastRemoteProjection` — Electron already built a
/// RemoteProjectionEnvelope and asks the daemon to rebroadcast it to iOS.
/// Keep the envelope intact as the event payload so iOS decodes the same
/// source-of-truth projection the Mac generated.
dispatcher.register("bridge.broadcastRemoteProjection") { rawParams in
    do {
        let projection = try SummaryBroadcaster.makeRemoteProjectionEventJSON(
            params: rawParams,
            publishedAt: Date()
        )
        Task.detached { @Sendable [summaryBroadcaster, projection] in
            await summaryBroadcaster.broadcast(projection.data, threadID: projection.threadID)
        }
        FileHandle.standardError.write(Data(
            "[bridge.broadcastRemoteProjection] broadcast bytes=\(projection.data.count) threadID=\(projection.threadID ?? "nil")\n".utf8
        ))
    } catch {
        FileHandle.standardError.write(Data(
            "[bridge.broadcastRemoteProjection] WARN: \(String(describing: error))\n".utf8
        ))
    }
    return [String: Any]()
}

/// `bridge.broadcastRemoteProjectionSnapshot` — Electron sends a bounded
/// list of current projection envelopes after subscribe/resume. Expand the
/// batch into individual remote-projection events so the iOS reducer can
/// apply each card/snapshot normally.
dispatcher.register("bridge.broadcastRemoteProjectionSnapshot") { rawParams in
    do {
        let projections = try SummaryBroadcaster.makeRemoteProjectionSnapshotEvents(
            params: rawParams,
            publishedAt: Date()
        )
        for projection in projections {
            Task.detached { @Sendable [summaryBroadcaster, projection] in
                await summaryBroadcaster.broadcast(projection.data, threadID: projection.threadID)
            }
        }
        FileHandle.standardError.write(Data(
            "[bridge.broadcastRemoteProjectionSnapshot] broadcast count=\(projections.count)\n".utf8
        ))
    } catch {
        FileHandle.standardError.write(Data(
            "[bridge.broadcastRemoteProjectionSnapshot] WARN: \(String(describing: error))\n".utf8
        ))
    }
    return [String: Any]()
}

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
    logPairingPipeline("incomingResponses consumer started")
    for await incoming in pairingChannelListener.incomingResponses {
        do {
            logPairingPipeline("iPad response received by consumer session=\(incoming.sessionID)")
            let result = try await pairingCoordinator.confirmPairing(response: incoming.response)
            logPairingPipeline("confirmPairing succeeded session=\(result.pairingSessionID) code=\(result.confirmationCode)")
            let notification = PairingCoordinator.PairingResponseNotification(result: result)
            logPairingPipeline("emitting \(PairingCoordinator.PairingResponseNotification.method) upstream session=\(result.pairingSessionID)")
            bridgeNotifier.publish(method: PairingCoordinator.PairingResponseNotification.method, params: notification.params)
            await pairingChannelListener.sendConfirmationCode(sessionID: incoming.sessionID, code: result.confirmationCode)
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
            logPairingPipeline("rejected session=\(incoming.sessionID) reason=\(reason)")
        } catch {
            await pairingChannelListener.sendFinalDecision(
                sessionID: incoming.sessionID,
                accepted: false,
                message: "Mac-side coordinator error: \(error.localizedDescription)"
            )
            logPairingPipeline("rejected session=\(incoming.sessionID) error=\(error.localizedDescription)")
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
// CRITICAL: handler dispatch MUST happen off the reader thread. Some
// handlers (e.g. `bridge.testFireRequest`) call `runBlocking` to await a
// `BridgeRequester.request(...)` — but the response that unblocks them
// arrives on stdin, which is the reader's job to consume. Running the
// handler inline would deadlock the daemon. Fan out to a concurrent
// dispatch queue so the read loop stays free to deliver responses to
// `handleResponseLine`.
//
// Concurrency model:
//   - Main thread: hosts NSApplication's run loop. `attachedWindow.requestPick`
//     drives `SCContentSharingPicker` here, which requires a main-actor
//     execution context. Other handlers don't touch main.
//   - Reader thread: a dedicated serial queue blocks on `readLine`, parses
//     one line at a time, fans out via `handlerQueue`. Lives off-main so
//     `readLine`'s blocking syscall never starves the runloop.
//   - Handler queue (concurrent): N handlers in flight; each safe because
//     they own their state (actors / @unchecked Sendable wrappers).
//   - Stdout writer: serial queue inside `BridgeStdoutWriter` keeps line
//     framing intact across all writers.
//
// On stdin EOF the reader thread terminates NSApplication, which returns
// from `NSApp.run()` and runs the post-loop shutdown.
let handlerQueue = DispatchQueue(
    label: "com.example.AGBench.daemon.handler",
    attributes: .concurrent
)
let stdinReaderQueue = DispatchQueue(label: "com.example.AGBench.daemon.stdin-reader")

stdinReaderQueue.async {
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
    // stdin closed → parent terminated → tear down on the main thread so
    // NSApplication's runloop can exit cleanly. The post-NSApp.run() code
    // below performs the actual drain/flush sequence.
    DispatchQueue.main.async {
        NSApplication.shared.terminate(nil)
    }
}

// Background-only daemon. `.accessory` keeps the process out of the Dock
// and Cmd+Tab list; it still has the window-server connection it needs to
// host `SCContentSharingPicker` on demand. Set before `NSApp.run()` so the
// policy is in effect for the first picker presentation.
NSApplication.shared.setActivationPolicy(.accessory)

// Hand the main thread to AppKit. The picker UI, when called, drives off
// this runloop; everything else runs on the reader/handler queues above.
// `terminate(nil)` from the reader thread is how this returns.
NSApplication.shared.run()

// NSApp.run() returned (terminate or unexpected exit). Drain in the same
// order the prior in-place loop did:
//   1. Wait for in-flight handlers so a ping issued right before EOF isn't
//      silently dropped.
//   2. Cancel pending outbound requests so awaiters see a structured error.
//   3. Flush the stdout writer so the last batch of responses /
//      notifications actually reaches the parent before the pipe closes.
handlerQueue.sync(flags: .barrier) {}
bridgeRequester.shutdown()
stdoutWriter.flush()
