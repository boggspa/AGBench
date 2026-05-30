import Foundation
import Observation
import BridgeCore
import BridgeCryptoPrimitives
import BridgeCryptoPairing

/// PairingViewModel — observable state machine for the iOS pairing flow.
///
/// UI lifecycle:
///   1. View calls `scan(bootstrapJSON:)` after a QR is read (or text
///      pasted during early testing). On success, the view model opens
///      the Bonjour-discovered pairing channel and sends the response
///      payload to the Mac.
///   2. View shows the local code while waiting for the Mac to echo its
///      derived code. Only matching codes move to `.confirmingCode`.
///   3. View calls `confirm()` to accept or `cancel()` to abort. Confirm
///      sends the iOS decision and waits for the desktop-side final
///      decision before exposing `confirmedPair`.
///
/// `@Observable` (Swift 5.9+) avoids manual `@Published` for each
/// property and works seamlessly with SwiftUI's view-binding.
@Observable
@MainActor
public final class PairingViewModel {
    public enum State: Sendable, Equatable {
        case idle
        case scanning
        case awaitingDesktopVerification(confirmationCode: String, controllerDisplayName: String)
        case confirmingCode(confirmationCode: String, controllerDisplayName: String)
        case finalizing(confirmationCode: String, controllerDisplayName: String)
        case confirmed
        case failed(message: String)
    }

    public private(set) var state: State = .idle
    /// The pair credentials produced after a successful confirm. nil
    /// until `confirm()` runs.
    public private(set) var confirmedPair: GuiGeminiBridgeClient.Pair?

    /// Identity signing key the iOS app persists across launches. The
    /// scaffolding generates an ephemeral one per session — Keychain
    /// integration replaces this with a stable per-device key.
    private let identityKey: DeviceIdentitySigningKey
    private let controllerDeviceID: DeviceID
    private let controllerDisplayName: String
    private let pairStorage: KeychainPairStorage?
    private let makePairingChannelTransport: PairingChannelTransportFactory

    /// Set during `scan()`. Held until `confirm()` to seal the pair.
    private var stagedFlow: PairingFlow.Started?
    private var stagedResponse: PairingResponsePayload?
    private var stagedDerivedKeys: PairingDerivedKeys?
    private var pairingTransport: (any PairingChannelTransport)?
    private var pairingTask: Task<Void, Never>?

    public init(
        controllerDeviceID: DeviceID = DeviceID(UUID().uuidString.lowercased()),
        controllerDisplayName: String = "iPhone",
        identityKey: DeviceIdentitySigningKey = DeviceIdentitySigningKey(),
        pairStorage: KeychainPairStorage? = nil,
        pairingChannelTransportFactory: @escaping PairingChannelTransportFactory = { configuration in
            PairingChannelClient(configuration: configuration)
        }
    ) {
        self.controllerDeviceID = controllerDeviceID
        self.controllerDisplayName = controllerDisplayName
        self.identityKey = identityKey
        self.pairStorage = pairStorage
        self.makePairingChannelTransport = pairingChannelTransportFactory
    }

    /// Step 1: decode QR bytes (or pasted JSON), derive keys, compute the
    /// 6-digit confirmation code, then send the response to the Mac over
    /// the Bonjour-discovered pairing channel.
    public func scan(bootstrapJSON: Data) {
        cancelActiveTransport(message: "Pairing restarted")
        state = .scanning
        do {
            let started = try PairingFlow.scan(bootstrapJSON: bootstrapJSON)
            let result = try started.buildResponse(
                controllerDeviceID: controllerDeviceID,
                controllerDisplayName: controllerDisplayName,
                controllerIdentityKey: identityKey
            )
            self.stagedFlow = started
            self.stagedResponse = result.response
            self.stagedDerivedKeys = result.derivedKeys
            self.state = .awaitingDesktopVerification(
                confirmationCode: result.confirmationCode,
                controllerDisplayName: controllerDisplayName
            )
            let configuration = PairingChannelClient.Configuration(
                bonjourServiceName: started.bootstrap.bonjourServiceName ?? GuiGeminiBridgeClient.ServiceType.tcp
            )
            let transport = makePairingChannelTransport(configuration)
            self.pairingTransport = transport
            self.pairingTask = Task { [weak self, transport, response = result.response, confirmationCode = result.confirmationCode] in
                await self?.awaitDesktopVerification(
                    transport: transport,
                    response: response,
                    localConfirmationCode: confirmationCode
                )
            }
        } catch {
            self.state = .failed(message: describe(error: error))
        }
    }

    /// Step 2 — user confirmed the codes match. Sends the local decision,
    /// waits for the Mac desktop to accept, then produces the typed `Pair`
    /// for the bridge client wrapper.
    public func confirm() {
        guard
            case .confirmingCode(let confirmationCode, let displayName) = state,
            let response = stagedResponse,
            let derivedKeys = stagedDerivedKeys,
            let flow = stagedFlow,
            let transport = pairingTransport
        else {
            state = .failed(message: "Cannot confirm — pairing was not staged")
            return
        }
        state = .finalizing(confirmationCode: confirmationCode, controllerDisplayName: displayName)
        pairingTask?.cancel()
        pairingTask = Task { [weak self, transport, response, derivedKeys, flow] in
            do {
                let decision = try await transport.sendFinalDecisionAndWaitForDesktop(
                    accepted: true,
                    message: nil
                )
                guard decision.accepted else {
                    self?.failPairing(decision.message ?? "The Mac rejected this pairing request")
                    return
                }
                guard let pairID = Self.pairID(from: decision) else {
                    self?.failPairing("The Mac accepted pairing but did not return a pair id. Pairing is incomplete; rebuild the Mac app and try again.")
                    return
                }
                self?.completePairing(response: response, derivedKeys: derivedKeys, flow: flow, pairID: pairID)
            } catch {
                self?.failPairing("Pairing finalization failed: \(self?.describe(error: error) ?? error.localizedDescription)")
            }
        }
    }

    private func completePairing(
        response: PairingResponsePayload,
        derivedKeys: PairingDerivedKeys,
        flow: PairingFlow.Started,
        pairID: PairID
    ) {
        confirmedPair = GuiGeminiBridgeClient.Pair(
            pairID: pairID,
            controllerDeviceID: response.controllerDeviceID,
            macDeviceID: flow.bootstrap.macDeviceID,
            derivedKeys: derivedKeys,
            macDisplayName: flow.macDisplayName,
            tailscaleEndpointHint: flow.bootstrap.tailscaleEndpointHint
        )
        persistPair(
            pairID: pairID,
            response: response,
            derivedKeys: derivedKeys,
            flow: flow
        )
        pairingTransport = nil
        pairingTask = nil
        state = .confirmed
    }

    private func persistPair(
        pairID: PairID,
        response: PairingResponsePayload,
        derivedKeys: PairingDerivedKeys,
        flow: PairingFlow.Started
    ) {
        guard let pairStorage else { return }
        let record = KeychainPairStorage.PairRecord(
            pairID: pairID,
            controllerDeviceID: response.controllerDeviceID,
            macDeviceID: flow.bootstrap.macDeviceID,
            macDisplayName: flow.macDisplayName,
            tailscaleEndpointHint: flow.bootstrap.tailscaleEndpointHint
        )
        Task { [pairStorage, record, derivedKeys] in
            try? await pairStorage.savePair(record, derivedKeys: derivedKeys)
        }
    }

    /// User rejected the codes (mismatch / suspected attack) — discard
    /// staged credentials and return to idle.
    public func cancel() {
        cancelActiveTransport(message: "User reported that the pairing codes did not match")
        clearStaged()
        state = .idle
    }

    private func clearStaged() {
        stagedFlow = nil
        stagedResponse = nil
        stagedDerivedKeys = nil
    }

    /// Reset back to idle without confirming. Used after `.failed`.
    public func reset() {
        cancel()
    }

    /// The PairingResponsePayload to transmit to the Mac. Available
    /// only between `scan()` and `confirm()/cancel()`. The transport
    /// slice will consume this when it ships.
    public var pendingResponse: PairingResponsePayload? {
        stagedResponse
    }

    private func awaitDesktopVerification(
        transport: any PairingChannelTransport,
        response: PairingResponsePayload,
        localConfirmationCode: String
    ) async {
        do {
            let reply = try await transport.attemptPairing(response: response)
            guard !Task.isCancelled else { return }
            guard stagedResponse?.pairingSessionID == response.pairingSessionID else { return }
            guard reply.sessionID == response.pairingSessionID else {
                try? await transport.sendFinalDecision(
                    accepted: false,
                    message: "Mac replied for a different pairing session"
                )
                failPairing("The Mac replied for a different pairing session")
                return
            }
            guard reply.macConfirmationCode == localConfirmationCode else {
                try? await transport.sendFinalDecision(
                    accepted: false,
                    message: "Pairing confirmation codes did not match"
                )
                failPairing("The Mac showed a different pairing code. Pairing was cancelled.")
                return
            }
            state = .confirmingCode(
                confirmationCode: localConfirmationCode,
                controllerDisplayName: controllerDisplayName
            )
        } catch {
            guard !Task.isCancelled else { return }
            await transport.cancel()
            failPairing("Pairing channel failed: \(describe(error: error))")
        }
    }

    private func failPairing(_ message: String) {
        clearStaged()
        pairingTransport = nil
        pairingTask = nil
        state = .failed(message: message)
    }

    private static func pairID(from decision: PairingChannelClient.DesktopFinalDecision) -> PairID? {
        guard let rawPairID = decision.pairID?.trimmingCharacters(in: .whitespacesAndNewlines),
              !rawPairID.isEmpty
        else {
            return nil
        }
        return PairID(rawPairID)
    }

    private func cancelActiveTransport(message: String) {
        pairingTask?.cancel()
        pairingTask = nil
        guard let transport = pairingTransport else { return }
        pairingTransport = nil
        Task { [transport, message] in
            try? await transport.sendFinalDecision(accepted: false, message: message)
            await transport.cancel()
        }
    }

    private func describe(error: Error) -> String {
        if let flowError = error as? PairingFlowError {
            return flowError.description
        }
        if let channelError = error as? PairingChannelClient.PairingChannelError {
            return channelError.description
        }
        return error.localizedDescription
    }
}
