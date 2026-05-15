import Foundation
import BridgeCore
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
        public let trustedControllerCount: Int
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
    private let ackTimeoutSeconds: TimeInterval

    private var server: QUICBridgeServer?
    private var lastErrorMessage: String?
    private var trustedControllerCount: Int = 0

    public init(
        deviceStore: TrustedDeviceStore,
        secretStore: SecretStore,
        macDeviceID: DeviceID,
        notifier: BridgeNotifier,
        requester: BridgeRequester,
        ackTimeoutSeconds: TimeInterval = 10.0
    ) {
        self.deviceStore = deviceStore
        self.secretStore = secretStore
        self.macDeviceID = macDeviceID
        self.notifier = notifier
        self.requester = requester
        self.ackTimeoutSeconds = ackTimeoutSeconds
    }

    public func start() async throws {
        if server != nil {
            throw TransportListenerError.alreadyRunning
        }

        let controllers = try await loadTrustedControllers()
        if controllers.isEmpty {
            // Surface this as a structured error so the UI can show "pair first"
            // instead of letting the listener bind to a port no one can connect to.
            throw TransportListenerError.noTrustedDevices
        }

        let cfg = BridgeProductConfiguration.current

        // Capture collaborators locally so the @Sendable handler closures can
        // call them without hopping back through the actor. Both are
        // Sendable + internally serialized, so concurrent calls from
        // different connections are safe.
        let notifier = self.notifier
        let requester = self.requester
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
            onActionRecord: { [self] payloadData, pairID in
                await self.logHandler(
                    "onActionRecord pairID=\(pairID.rawValue) payloadBytes=\(payloadData.count)"
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
                // Phase C3.5.7: ask Electron via JSON-RPC request for a real
                // ack. The Electron-side `onRequest` handler (when wired)
                // should route to RunService/ApprovalService and respond
                // with `{accepted: Bool, message: String?}`. If no handler is
                // registered yet, Electron returns `-32601 methodNotFound` and
                // we fall back to a denial — preserving the Phase C3
                // behavior so the iOS side gets a stable contract.
                let ackParams: [String: Any] = [
                    "pairID": pairIDString,
                    "payloadBytes": payloadBytes,
                    "payloadBase64": payloadBase64
                ]
                guard let ackParamsJSON = try? JSONSerialization.data(
                    withJSONObject: ackParams,
                    options: [.sortedKeys]
                ) else {
                    return BridgeActionAck(
                        accepted: false,
                        message: "Phase C3.5 fallback — failed to encode ack request"
                    )
                }
                do {
                    let resultData = try await requester.request(
                        method: "bridge.requestActionAck",
                        paramsJSON: ackParamsJSON,
                        timeoutSeconds: ackTimeout
                    )
                    if let obj = try JSONSerialization.jsonObject(
                        with: resultData,
                        options: [.fragmentsAllowed]
                    ) as? [String: Any],
                       let accepted = obj["accepted"] as? Bool {
                        let message = (obj["message"] as? String)
                            ?? (accepted ? "Accepted" : "Rejected")
                        return BridgeActionAck(accepted: accepted, message: message)
                    }
                    // Result shape wrong — fall through to denial.
                    FileHandle.standardError.write(Data(
                        "[TransportListener] WARN: onActionRecord ack result missing 'accepted' Bool — denying\n".utf8
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
                return BridgeActionAck(
                    accepted: false,
                    message: "Phase C3.5 fallback — Electron handler not yet wired"
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
                // Phase C3.5.8: ask Electron via JSON-RPC request for a real
                // ack. Same fallback contract as onActionRecord — when no
                // handler is wired or the request fails, return the Phase C3
                // denial. The result schema is just `{accepted, message?}`:
                // prepareID/workspaceID/threadID stay anchored to the request
                // (Electron doesn't get to retarget them).
                guard let prepareParamsJSON = try? JSONSerialization.data(
                    withJSONObject: prepareParams,
                    options: [.sortedKeys]
                ) else {
                    return BridgePrepareStartTurnAck(
                        prepareID: request.prepareID,
                        workspaceID: request.workspaceID,
                        threadID: request.threadID,
                        accepted: false,
                        message: "Phase C3.5 fallback — failed to encode ack request"
                    )
                }
                do {
                    let resultData = try await requester.request(
                        method: "bridge.requestPrepareStartTurnAck",
                        paramsJSON: prepareParamsJSON,
                        timeoutSeconds: ackTimeout
                    )
                    if let obj = try JSONSerialization.jsonObject(
                        with: resultData,
                        options: [.fragmentsAllowed]
                    ) as? [String: Any],
                       let accepted = obj["accepted"] as? Bool {
                        let message = (obj["message"] as? String)
                            ?? (accepted ? "Accepted" : "Rejected")
                        return BridgePrepareStartTurnAck(
                            prepareID: request.prepareID,
                            workspaceID: request.workspaceID,
                            threadID: request.threadID,
                            accepted: accepted,
                            message: message
                        )
                    }
                    FileHandle.standardError.write(Data(
                        "[TransportListener] WARN: onPrepareStartTurn ack result missing 'accepted' Bool — denying\n".utf8
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
                return BridgePrepareStartTurnAck(
                    prepareID: request.prepareID,
                    workspaceID: request.workspaceID,
                    threadID: request.threadID,
                    accepted: false,
                    message: "Phase C3.5 fallback — Electron handler not yet wired"
                )
            },
            onWatchedThreads: { [self] threadIDs, pairID in
                await self.logHandler(
                    "onWatchedThreads count=\(threadIDs.count) pairID=\(pairID.rawValue)"
                )
                notifier.publish(method: "bridge.didReceiveWatchedThreads", params: [
                    "pairID": pairID.rawValue,
                    "threadIDs": threadIDs
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
            try await server.start()
        } catch {
            lastErrorMessage = error.localizedDescription
            throw TransportListenerError.underlying(error)
        }

        self.server = server
        self.trustedControllerCount = controllers.count
        self.lastErrorMessage = nil
    }

    public func stop() async throws {
        guard let server else {
            throw TransportListenerError.notRunning
        }
        await server.stop()
        self.server = nil
        self.trustedControllerCount = 0
    }

    public func status() async -> Status {
        let cfg = BridgeProductConfiguration.current
        return Status(
            running: server != nil,
            bonjourServiceType: cfg.bonjourQUICServiceType,
            port: server != nil ? cfg.directQUICPort : nil,
            trustedControllerCount: trustedControllerCount,
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
        guard let server else { return } // not running → nothing to refresh
        let controllers = try await loadTrustedControllers()
        await server.updateTrustedControllers(controllers)
        trustedControllerCount = controllers.count
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
    /// Best-effort: when the server isn't running OR no peers are
    /// connected, the call is a no-op. Sessions that fail a write are
    /// pruned automatically by `LANBridgeServer.broadcast`.
    public func broadcastRunEvent(_ payloadJSON: Data) async {
        guard let server else { return }
        let envelope = BridgeInboundEnvelope(payload: .eventRecord(payloadJSON))
        await server.broadcast(envelope)
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

    private func logHandler(_ message: String) async {
        FileHandle.standardError.write(Data("[TransportListener handler] \(message)\n".utf8))
    }
}
