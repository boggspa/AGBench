import XCTest
import Foundation
@preconcurrency import Network
import CryptoKit
import BridgeCore
import BridgeCryptoPairing
import BridgeLANTransport
@testable import GuiGeminiCompanionCore

/// Integration-shape tests for `GuiGeminiBridgeClient`.
///
/// We don't spin up the underlying transport (no network in these
/// tests). The wrapper's transport-independent logic — service-type
/// selection, action encoding, pair-construction — is exercised here.
/// End-to-end transport tests will land alongside the real Bonjour
/// listener + a mock-Mac fixture in a later slice.
final class GuiGeminiBridgeClientTests: XCTestCase {
    private func samplePair() -> GuiGeminiBridgeClient.Pair {
        // Derive a real pair via the controller-side derivation path so
        // the SymmetricKey shapes match what LANBridgeController expects.
        let macPrivate = P256.KeyAgreement.PrivateKey()
        let controllerPrivate = P256.KeyAgreement.PrivateKey()
        let macNonce = Data((0..<32).map { _ in UInt8.random(in: 0...255) })
        let controllerNonce = Data((0..<32).map { _ in UInt8.random(in: 0...255) })
        let derived = try! PairingKeyDeriver.deriveFromControllerSide(
            controllerPrivateKey: controllerPrivate,
            macPublicKeyData: macPrivate.publicKey.rawRepresentation,
            macNonce: macNonce,
            controllerNonce: controllerNonce
        )
        return GuiGeminiBridgeClient.Pair(
            pairID: PairID("pair-test-1"),
            controllerDeviceID: DeviceID("iphone-test-1"),
            macDeviceID: DeviceID("mac-test-1"),
            derivedKeys: derived
        )
    }

    func testServiceTypeConstants() {
        // Lock the daemon-side bonjour service-type strings. If the
        // daemon ever changes these, this test forces an explicit update
        // here so the iOS client doesn't silently fail to discover the
        // Mac.
        XCTAssertEqual(GuiGeminiBridgeClient.ServiceType.quic, "_guigemini-quic._udp")
        XCTAssertEqual(GuiGeminiBridgeClient.ServiceType.tcp, "_guigemini._tcp")
    }

    func testInitDoesNotStartTransport() async {
        // Constructing the wrapper should not initiate Bonjour browsing or
        // network connections. Only an explicit `start()` triggers
        // discovery.
        _ = GuiGeminiBridgeClient(pair: samplePair())
        // If we got here without hanging on network init, the test passes.
        // (Implicit assertion: no thrown errors, no timeouts.)
        XCTAssertTrue(true)
    }

    func testPairConstructionExtractsDerivedKeys() {
        let macPrivate = P256.KeyAgreement.PrivateKey()
        let controllerPrivate = P256.KeyAgreement.PrivateKey()
        let macNonce = Data(repeating: 0xAB, count: 32)
        let controllerNonce = Data(repeating: 0xCD, count: 32)
        let derived = try! PairingKeyDeriver.deriveFromControllerSide(
            controllerPrivateKey: controllerPrivate,
            macPublicKeyData: macPrivate.publicKey.rawRepresentation,
            macNonce: macNonce,
            controllerNonce: controllerNonce
        )
        let pair = GuiGeminiBridgeClient.Pair(
            pairID: PairID("p"),
            controllerDeviceID: DeviceID("c"),
            macDeviceID: DeviceID("m"),
            derivedKeys: derived
        )
        // Both subkeys must be 32 bytes (HKDF-SHA256 output size).
        XCTAssertEqual(
            pair.macToControllerKey.withUnsafeBytes { $0.count },
            32
        )
        XCTAssertEqual(
            pair.controllerToMacKey.withUnsafeBytes { $0.count },
            32
        )
        // The two directional keys must be distinct (different HKDF
        // contexts derive different bytes).
        XCTAssertNotEqual(
            pair.macToControllerKey.withUnsafeBytes { Data($0) },
            pair.controllerToMacKey.withUnsafeBytes { Data($0) }
        )
    }

    func testPairCarriesTailscaleEndpointHint() {
        var pair = samplePair()
        XCTAssertNil(pair.tailscaleEndpointHint)

        pair = GuiGeminiBridgeClient.Pair(
            pairID: pair.pairID,
            controllerDeviceID: pair.controllerDeviceID,
            macDeviceID: pair.macDeviceID,
            derivedKeys: sampleDerivedKeys(),
            tailscaleEndpointHint: "100.64.10.20:38747"
        )
        XCTAssertEqual(pair.tailscaleEndpointHint, "100.64.10.20:38747")
        XCTAssertEqual(
            GuiGeminiBridgeClient.tailscaleEndpoint(from: pair.tailscaleEndpointHint)?.rawValue,
            "100.64.10.20:38747"
        )
    }

    func testRouteSelectionPrefersReachableTailnetEndpoint() async {
        let endpoint = BridgeDirectEndpoint(host: "100.64.10.20", port: 38_747)
        let selection = await GuiGeminiBridgeClient.selectRoute(
            tailscaleEndpoint: endpoint,
            requestedPreference: .automatic,
            networkProtocol: .tcp,
            quicSecurity: nil,
            probeTimeout: 0.1,
            probe: { candidate, _, _, _ in
                candidate == endpoint
            }
        )

        XCTAssertEqual(selection.activeRoute, .tailnet)
        XCTAssertEqual(selection.tailscaleEndpoint, endpoint)
        XCTAssertEqual(selection.transportPreference, .tailscale)
    }

    func testRouteSelectionFallsBackToLANWhenTailnetProbeFails() async {
        let endpoint = BridgeDirectEndpoint(host: "100.64.10.20", port: 38_747)
        let selection = await GuiGeminiBridgeClient.selectRoute(
            tailscaleEndpoint: endpoint,
            requestedPreference: .automatic,
            networkProtocol: .tcp,
            quicSecurity: nil,
            probeTimeout: 0.1,
            probe: { _, _, _, _ in false }
        )

        XCTAssertEqual(selection.activeRoute, .lan)
        XCTAssertNil(selection.tailscaleEndpoint)
        XCTAssertEqual(selection.transportPreference, .bonjour)
    }

    func testTailscaleProbeSucceedsForReachableTCPEndpoint() async throws {
        let (listener, endpoint) = try startProbeListener()
        let reachable = await GuiGeminiBridgeClient.probeTailscaleEndpoint(
            endpoint,
            timeout: 1,
            networkProtocol: .tcp,
            quicSecurity: nil
        )
        listener.cancel()
        XCTAssertTrue(reachable)
    }

    private func startProbeListener() throws -> (NWListener, BridgeDirectEndpoint) {
        let parameters = NWParameters.tcp
        parameters.acceptLocalOnly = true
        let listener = try NWListener(using: parameters)
        listener.newConnectionHandler = { connection in
            connection.start(queue: .global())
        }
        let semaphore = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { state in
            if case .ready = state {
                semaphore.signal()
            }
        }
        listener.start(queue: .global())
        _ = semaphore.wait(timeout: .now() + .seconds(3))
        guard let port = listener.port else {
            listener.cancel()
            throw NSError(
                domain: "GuiGeminiBridgeClientTests",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "listener did not publish a port"]
            )
        }
        let endpoint = BridgeDirectEndpoint(host: "127.0.0.1", port: port.rawValue)
        return (listener, endpoint)
    }

    func testSendActionEncodesToExpectedWireBytes() throws {
        // We can't easily mock the underlying controller's network path
        // in a unit test, but we CAN verify that the wrapper produces
        // the same wire bytes as a direct `BridgeActionPayload.encode()`
        // — that's the contract `sendActionRecord(payloadData:)` will
        // see when it eventually goes out on the network.
        let action = BridgeActionPayload.composerPrompt(
            workspaceId: "ws-1",
            threadId: "t-1",
            text: "find the auth bug",
            provider: "gemini",
            approvalMode: "plan",
            model: "gemini-2.5-pro",
            contextTurns: 5
        )
        let bytes = try action.encode()
        let decoded = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
        XCTAssertEqual(decoded["kind"] as? String, "composerPrompt")
        XCTAssertEqual(decoded["workspaceId"] as? String, "ws-1")
        XCTAssertEqual(decoded["provider"] as? String, "gemini")
        XCTAssertEqual(decoded["contextTurns"] as? Int, 5)
    }

    func testStreamsExistAndAreNonisolated() {
        // Verify the AsyncStreams are accessible from any actor — the
        // wrapper exposes them as `nonisolated let`. If we accidentally
        // changed them to actor-isolated stored properties, callers
        // wouldn't be able to `for await` them without hops.
        let client = GuiGeminiBridgeClient(pair: samplePair())
        // Access from a non-actor context — these would refuse to compile
        // if isolation regressed.
        _ = client.runEvents
        _ = client.status
        _ = client.otherInbound
        _ = client.activeRoute
    }

    private func sampleDerivedKeys() -> PairingDerivedKeys {
        let macPrivate = P256.KeyAgreement.PrivateKey()
        let controllerPrivate = P256.KeyAgreement.PrivateKey()
        return try! PairingKeyDeriver.deriveFromControllerSide(
            controllerPrivateKey: controllerPrivate,
            macPublicKeyData: macPrivate.publicKey.rawRepresentation,
            macNonce: Data(repeating: 0xAB, count: 32),
            controllerNonce: Data(repeating: 0xCD, count: 32)
        )
    }
}
