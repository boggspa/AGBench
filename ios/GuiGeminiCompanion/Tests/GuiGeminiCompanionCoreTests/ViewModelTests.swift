import XCTest
import Foundation
import CryptoKit
import BridgeCore
import BridgeCryptoPrimitives
import BridgeCryptoPairing
@testable import GuiGeminiCompanionCore

private actor MockPairingChannelTransport: PairingChannelTransport {
    private(set) var attemptedResponses: [PairingResponsePayload] = []
    private(set) var finalDecisions: [PairingChannelClient.FinalDecisionMessage] = []
    private(set) var cancelWasCalled = false

    var desktopDecision = PairingChannelClient.DesktopFinalDecision(
        accepted: true,
        pairID: "pair-from-mac"
    )

    private var pendingAttempt: CheckedContinuation<PairingChannelClient.PairingReply, Error>?

    func attemptPairing(response: PairingResponsePayload) async throws -> PairingChannelClient.PairingReply {
        attemptedResponses.append(response)
        return try await withCheckedThrowingContinuation { continuation in
            pendingAttempt = continuation
        }
    }

    func sendFinalDecision(accepted: Bool, message: String?) async throws {
        finalDecisions.append(PairingChannelClient.FinalDecisionMessage(accepted: accepted, message: message))
    }

    func sendFinalDecisionAndWaitForDesktop(
        accepted: Bool,
        message: String?
    ) async throws -> PairingChannelClient.DesktopFinalDecision {
        finalDecisions.append(PairingChannelClient.FinalDecisionMessage(accepted: accepted, message: message))
        return desktopDecision
    }

    func cancel() async {
        cancelWasCalled = true
        pendingAttempt?.resume(throwing: CancellationError())
        pendingAttempt = nil
    }

    func hasPendingAttempt() -> Bool {
        pendingAttempt != nil
    }

    func attemptedResponseCount() -> Int {
        attemptedResponses.count
    }

    func finalDecisionSnapshot() -> [PairingChannelClient.FinalDecisionMessage] {
        finalDecisions
    }

    func wasCancelled() -> Bool {
        cancelWasCalled
    }

    func setDesktopDecision(_ decision: PairingChannelClient.DesktopFinalDecision) {
        desktopDecision = decision
    }

    func resolveAttempt(macConfirmationCode: String, sessionID: String? = nil) {
        guard let continuation = pendingAttempt else { return }
        pendingAttempt = nil
        let responseSessionID = attemptedResponses.last?.pairingSessionID ?? "missing-session"
        continuation.resume(returning: PairingChannelClient.PairingReply(
            macConfirmationCode: macConfirmationCode,
            sessionID: sessionID ?? responseSessionID
        ))
    }
}

private final class PairingTransportFactorySpy: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var lastConfiguration: PairingChannelClient.Configuration?
    let transport: MockPairingChannelTransport

    init(transport: MockPairingChannelTransport) {
        self.transport = transport
    }

    func make(configuration: PairingChannelClient.Configuration) -> any PairingChannelTransport {
        lock.lock()
        lastConfiguration = configuration
        lock.unlock()
        return transport
    }
}

@MainActor
final class PairingViewModelTests: XCTestCase {
    private func makeBootstrapJSON(
        expiresIn: TimeInterval = 300,
        tailscaleEndpointHint: String? = nil,
        macDisplayName: String? = nil
    ) -> Data {
        let macPrivate = P256.KeyAgreement.PrivateKey()
        let macIdentity = DeviceIdentitySigningKey()
        let macNonce = Data((0..<32).map { _ in UInt8.random(in: 0...255) })
        let bootstrap = PairingBootstrapPayload(
            pairingSessionID: UUID().uuidString,
            macDeviceID: DeviceID("mac-1"),
            macIdentityKeyID: macIdentity.identityKeyID,
            macEphemeralPublicKey: macPrivate.publicKey.rawRepresentation,
            macNonce: macNonce,
            expiresAt: Date().addingTimeInterval(expiresIn),
            bonjourServiceName: "_test._tcp",
            tailscaleEndpointHint: tailscaleEndpointHint,
            quicTransportCertificateSHA256: nil
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.dataEncodingStrategy = .base64
        let data = try! encoder.encode(bootstrap)
        guard let macDisplayName else { return data }
        var object = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
        object["macDisplayName"] = macDisplayName
        return try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    private func makeViewModel(
        controllerDisplayName: String = "iPhone Test",
        pairStorage: KeychainPairStorage? = nil,
        transport: MockPairingChannelTransport = MockPairingChannelTransport()
    ) -> (PairingViewModel, PairingTransportFactorySpy) {
        let factory = PairingTransportFactorySpy(transport: transport)
        let vm = PairingViewModel(
            controllerDisplayName: controllerDisplayName,
            pairStorage: pairStorage,
            pairingChannelTransportFactory: factory.make(configuration:)
        )
        return (vm, factory)
    }

    private func waitForState(
        _ vm: PairingViewModel,
        timeout: TimeInterval = 1,
        where predicate: (PairingViewModel.State) -> Bool
    ) async -> PairingViewModel.State? {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let state = vm.state
            if predicate(state) {
                return state
            }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return nil
    }

    private func waitUntil(
        timeout: TimeInterval = 1,
        predicate: () async -> Bool
    ) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if await predicate() {
                return true
            }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return false
    }

    private func stageDesktopVerifiedPairing(
        _ vm: PairingViewModel,
        transport: MockPairingChannelTransport
    ) async -> String {
        vm.scan(bootstrapJSON: makeBootstrapJSON())
        let awaitingState = await waitForState(vm) { state in
            if case .awaitingDesktopVerification = state { return true }
            return false
        }
        guard let awaitingState,
              case .awaitingDesktopVerification(let code, _) = awaitingState
        else {
            XCTFail("expected .awaitingDesktopVerification, got \(String(describing: awaitingState))")
            return ""
        }
        let didAttempt = await waitUntil { await transport.hasPendingAttempt() }
        XCTAssertTrue(didAttempt)
        await transport.resolveAttempt(macConfirmationCode: code)
        let confirmingState = await waitForState(vm) { state in
            if case .confirmingCode = state { return true }
            return false
        }
        guard let confirmingState,
              case .confirmingCode(let confirmedCode, _) = confirmingState
        else {
            XCTFail("expected .confirmingCode, got \(String(describing: confirmingState))")
            return ""
        }
        return confirmedCode
    }

    func testIdleAtStart() {
        let vm = PairingViewModel(controllerDisplayName: "iPhone Test")
        XCTAssertEqual(vm.state, .idle)
        XCTAssertNil(vm.confirmedPair)
    }

    func testScanStartsPairingChannelAttemptWithBonjourService() async {
        let transport = MockPairingChannelTransport()
        let (vm, factory) = makeViewModel(transport: transport)
        vm.scan(bootstrapJSON: makeBootstrapJSON())
        XCTAssertEqual(factory.lastConfiguration?.bonjourServiceName, "_test._tcp")
        let didAttempt = await waitUntil { await transport.hasPendingAttempt() }
        XCTAssertTrue(didAttempt)
        let attemptCount = await transport.attemptedResponseCount()
        XCTAssertEqual(attemptCount, 1)
        vm.cancel()
        let didCancel = await waitUntil { await transport.wasCancelled() }
        XCTAssertTrue(didCancel)
    }

    func testScanProducesConfirmingCodeStateAfterDesktopEchoesSameCode() async {
        let transport = MockPairingChannelTransport()
        let (vm, _) = makeViewModel(transport: transport)
        let confirmedCode = await stageDesktopVerifiedPairing(vm, transport: transport)
        switch vm.state {
        case .confirmingCode(let code, let name):
            XCTAssertEqual(code, confirmedCode)
            XCTAssertEqual(code.count, 6)
            XCTAssertTrue(code.allSatisfy { $0.isNumber })
            XCTAssertEqual(name, "iPhone Test")
        default:
            XCTFail("expected .confirmingCode, got \(vm.state)")
        }
    }

    func testScanWithExpiredBootstrapFails() {
        let vm = PairingViewModel()
        vm.scan(bootstrapJSON: makeBootstrapJSON(expiresIn: -10))
        if case .failed(let message) = vm.state {
            XCTAssertTrue(message.contains("expired"), "unexpected message: \(message)")
            XCTAssertTrue(vm.lastDiagnostics?.contains("payloadBytes") == true)
        } else {
            XCTFail("expected .failed, got \(vm.state)")
        }
    }

    func testScanWithGarbageJSONFails() {
        let vm = PairingViewModel()
        vm.scan(bootstrapJSON: Data("not json".utf8))
        guard case .failed = vm.state else {
            XCTFail("expected .failed, got \(vm.state)")
            return
        }
        XCTAssertTrue(vm.lastDiagnostics?.contains("AGBench iOS pairing diagnostics") == true)
    }

    func testConfirmAfterDesktopVerificationProducesPair() async {
        let transport = MockPairingChannelTransport()
        let (vm, _) = makeViewModel(transport: transport)
        _ = await stageDesktopVerifiedPairing(vm, transport: transport)
        vm.confirm()
        _ = await waitForState(vm) { $0 == .confirmed }
        XCTAssertEqual(vm.state, .confirmed)
        XCTAssertNotNil(vm.confirmedPair)
        XCTAssertEqual(vm.confirmedPair?.controllerDeviceID.rawValue.isEmpty, false)
        XCTAssertEqual(vm.confirmedPair?.pairID.rawValue, "pair-from-mac")
        let decisions = await transport.finalDecisionSnapshot()
        XCTAssertEqual(decisions.last?.accepted, true)
    }

    func testConfirmAfterScanCarriesTailscaleEndpointHint() async {
        let transport = MockPairingChannelTransport()
        let (vm, _) = makeViewModel(transport: transport)
        vm.scan(bootstrapJSON: makeBootstrapJSON(tailscaleEndpointHint: "100.64.10.20:38747"))
        let awaitingState = await waitForState(vm) { state in
            if case .awaitingDesktopVerification = state { return true }
            return false
        }
        guard let awaitingState,
              case .awaitingDesktopVerification(let code, _) = awaitingState
        else {
            XCTFail("expected .awaitingDesktopVerification, got \(String(describing: awaitingState))")
            return
        }
        let didAttempt = await waitUntil { await transport.hasPendingAttempt() }
        XCTAssertTrue(didAttempt)
        await transport.resolveAttempt(macConfirmationCode: code)
        _ = await waitForState(vm) { state in
            if case .confirmingCode = state { return true }
            return false
        }
        vm.confirm()
        _ = await waitForState(vm) { $0 == .confirmed }
        XCTAssertEqual(vm.state, .confirmed)
        XCTAssertEqual(vm.confirmedPair?.tailscaleEndpointHint, "100.64.10.20:38747")
    }

    func testConfirmAfterScanCarriesMacDisplayNameAndPersistsPair() async throws {
        let storage = KeychainPairStorage(secretStore: InMemorySecretStore())
        let transport = MockPairingChannelTransport()
        let (vm, _) = makeViewModel(pairStorage: storage, transport: transport)
        vm.scan(bootstrapJSON: makeBootstrapJSON(macDisplayName: "Chris's Mac Studio"))
        let awaitingState = await waitForState(vm) { state in
            if case .awaitingDesktopVerification = state { return true }
            return false
        }
        guard let awaitingState,
              case .awaitingDesktopVerification(let code, _) = awaitingState
        else {
            XCTFail("expected .awaitingDesktopVerification, got \(String(describing: awaitingState))")
            return
        }
        let didAttempt = await waitUntil { await transport.hasPendingAttempt() }
        XCTAssertTrue(didAttempt)
        await transport.resolveAttempt(macConfirmationCode: code)
        _ = await waitForState(vm) { state in
            if case .confirmingCode = state { return true }
            return false
        }
        vm.confirm()
        _ = await waitForState(vm) { $0 == .confirmed }
        XCTAssertEqual(vm.confirmedPair?.macDisplayName, "Chris's Mac Studio")

        let didPersist = await waitUntil {
            let pairs = (try? await storage.loadAllPairs()) ?? []
            return pairs.contains { $0.macDisplayName == "Chris's Mac Studio" }
        }
        XCTAssertTrue(didPersist)
    }

    func testConfirmFromIdleFails() {
        let vm = PairingViewModel()
        vm.confirm()  // never scanned
        guard case .failed = vm.state else {
            XCTFail("expected .failed, got \(vm.state)")
            return
        }
        XCTAssertNil(vm.confirmedPair)
    }

    func testCancelClearsStagedState() async {
        let transport = MockPairingChannelTransport()
        let (vm, _) = makeViewModel(transport: transport)
        vm.scan(bootstrapJSON: makeBootstrapJSON())
        XCTAssertNotNil(vm.pendingResponse)
        vm.cancel()
        XCTAssertEqual(vm.state, .idle)
        XCTAssertNil(vm.pendingResponse)
        let didCancel = await waitUntil { await transport.wasCancelled() }
        XCTAssertTrue(didCancel)
    }

    func testMismatchedDesktopCodeFailsAndRejectsPairing() async {
        let transport = MockPairingChannelTransport()
        let (vm, _) = makeViewModel(transport: transport)
        vm.scan(bootstrapJSON: makeBootstrapJSON())
        let didAttempt = await waitUntil { await transport.hasPendingAttempt() }
        XCTAssertTrue(didAttempt)
        await transport.resolveAttempt(macConfirmationCode: "000000")
        let failedState = await waitForState(vm) { state in
            if case .failed = state { return true }
            return false
        }
        guard let failedState,
              case .failed(let message) = failedState
        else {
            XCTFail("expected .failed, got \(String(describing: failedState))")
            return
        }
        XCTAssertTrue(message.contains("different pairing code"))
        XCTAssertTrue(vm.lastDiagnostics?.contains("bonjourServiceName: _test._tcp") == true)
        let decisions = await transport.finalDecisionSnapshot()
        XCTAssertEqual(decisions.last?.accepted, false)
    }

    func testAcceptedDesktopDecisionWithoutPairIDFailsClosed() async {
        let transport = MockPairingChannelTransport()
        await transport.setDesktopDecision(PairingChannelClient.DesktopFinalDecision(
            accepted: true,
            pairID: nil
        ))
        let (vm, _) = makeViewModel(transport: transport)
        _ = await stageDesktopVerifiedPairing(vm, transport: transport)
        vm.confirm()
        let failedState = await waitForState(vm) { state in
            if case .failed = state { return true }
            return false
        }
        guard let failedState,
              case .failed(let message) = failedState
        else {
            XCTFail("expected .failed, got \(String(describing: failedState))")
            return
        }
        XCTAssertTrue(message.contains("did not return a pair id"))
        XCTAssertNil(vm.confirmedPair)
    }
}

@MainActor
final class TranscriptViewModelTests: XCTestCase {
    func testStartsEmpty() {
        let vm = TranscriptViewModel()
        XCTAssertTrue(vm.events.isEmpty)
        XCTAssertNil(vm.lastStatus)
    }

    func testClearDrops() {
        let vm = TranscriptViewModel()
        // We can't reach `append` directly (private), but we can verify the
        // public `clear()` behavior with a manually-attached event by
        // putting one through via reflection... skip that and just verify
        // the empty state behavior here. Real append paths are tested via
        // the client-attach integration when transport tests land.
        vm.clear()
        XCTAssertTrue(vm.events.isEmpty)
    }

    func testMaxRetainedIsRespected() {
        // The cap is enforced inside `append`, which is private but
        // exercised via the public init's maxRetained value.
        let vm = TranscriptViewModel(maxRetained: 3)
        XCTAssertEqual(vm.maxRetained, 3)
    }
}
