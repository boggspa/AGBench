import Foundation
import Observation
import BridgeCore
import BridgeCryptoPairing

/// PairingViewModel — observable state machine for the iOS pairing flow.
///
/// UI lifecycle:
///   1. View calls `scan(bootstrapJSON:)` after a QR is read (or text
///      pasted during early testing). On success, `state` flips to
///      `.confirmingCode` with the 6-digit code to display.
///   2. View shows the code; user verifies it matches what the Mac
///      shows. View calls `confirm()` to accept or `cancel()` to abort.
///   3. On `confirm()`, the view model exposes the typed `Pair` via
///      `confirmedPair` so a downstream coordinator can hand it to
///      `GuiGeminiBridgeClient`.
///
/// What's missing (intentionally):
///   - The "send response to Mac" step: pairing handshake transport
///     is a future slice (needs a bonjour-discovered TCP socket to
///     speak the pairing protocol over before keys are derived).
///     Today's view model stops at "code displayed, user confirmed,
///     pair credentials ready" — the actual session-keys hand-off
///     waits for the transport piece.
///
/// `@Observable` (Swift 5.9+) avoids manual `@Published` for each
/// property and works seamlessly with SwiftUI's view-binding.
@Observable
@MainActor
public final class PairingViewModel {
    public enum State: Sendable, Equatable {
        case idle
        case scanning
        case confirmingCode(confirmationCode: String, controllerDisplayName: String)
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

    /// Set during `scan()`. Held until `confirm()` to seal the pair.
    private var stagedFlow: PairingFlow.Started?
    private var stagedResponse: PairingResponsePayload?
    private var stagedDerivedKeys: PairingDerivedKeys?

    public init(
        controllerDeviceID: DeviceID = DeviceID(UUID().uuidString.lowercased()),
        controllerDisplayName: String = "iPhone",
        identityKey: DeviceIdentitySigningKey = DeviceIdentitySigningKey()
    ) {
        self.controllerDeviceID = controllerDeviceID
        self.controllerDisplayName = controllerDisplayName
        self.identityKey = identityKey
    }

    /// Step 1: decode QR bytes (or pasted JSON), derive keys, compute
    /// the 6-digit confirmation code. View transitions to
    /// `.confirmingCode` on success or `.failed` on any decode/expiry
    /// error.
    public func scan(bootstrapJSON: Data) {
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
            self.state = .confirmingCode(
                confirmationCode: result.confirmationCode,
                controllerDisplayName: controllerDisplayName
            )
        } catch {
            self.state = .failed(message: describe(error: error))
        }
    }

    /// Step 2 — user confirmed the codes match. Produces the typed
    /// `Pair` for the client wrapper. The view model can be discarded
    /// after this; consumers hold the pair credentials.
    public func confirm() {
        guard
            case .confirmingCode = state,
            let response = stagedResponse,
            let derivedKeys = stagedDerivedKeys,
            let _ = stagedFlow
        else {
            state = .failed(message: "Cannot confirm — pairing was not staged")
            return
        }
        // Pair id mirrors the Mac-side: a fresh UUID minted when the
        // Mac finalizes. iOS doesn't know the Mac's chosen pairID until
        // the transport-side hello echoes it. For now we mint
        // controller-side; reconcile in the transport slice.
        let pairID = PairID(UUID().uuidString.lowercased())
        confirmedPair = GuiGeminiBridgeClient.Pair(
            pairID: pairID,
            controllerDeviceID: response.controllerDeviceID,
            macDeviceID: stagedFlow!.bootstrap.macDeviceID,
            derivedKeys: derivedKeys
        )
        state = .confirmed
    }

    /// User rejected the codes (mismatch / suspected attack) — discard
    /// staged credentials and return to idle.
    public func cancel() {
        stagedFlow = nil
        stagedResponse = nil
        stagedDerivedKeys = nil
        state = .idle
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

    private func describe(error: Error) -> String {
        if let flowError = error as? PairingFlowError {
            return flowError.description
        }
        return error.localizedDescription
    }
}
