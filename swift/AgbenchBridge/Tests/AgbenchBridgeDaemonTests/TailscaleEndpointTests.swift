import XCTest
import BridgeCore
import BridgeCryptoPrimitives
import BridgeCryptoPairing
@testable import AgbenchBridgeDaemon

final class TailscaleEndpointTests: XCTestCase {
    func testParsesSelfTailscaleIPs() {
        let endpoint = TailscaleEndpointResolver.parseStatusJSON(Self.runningStatusJSON)

        XCTAssertEqual(endpoint.ipv4, "100.64.10.20")
        XCTAssertEqual(endpoint.ipv6, "fd7a:115c:a1e0::1")
        XCTAssertEqual(endpoint.hostname, "chris-mac")
        XCTAssertEqual(endpoint.quicEndpointHint(port: 38747), "100.64.10.20:38747")
    }

    func testFallsBackToTopLevelTailscaleIPs() {
        let endpoint = TailscaleEndpointResolver.parseStatusJSON("""
        {
          "TailscaleIPs": ["100.99.0.1"],
          "Self": { "HostName": "fallback-host" },
          "BackendState": "Running"
        }
        """)

        XCTAssertEqual(endpoint.ipv4, "100.99.0.1")
        XCTAssertEqual(endpoint.hostname, "fallback-host")
    }

    func testIgnoresNonTailnetIPv4Addresses() {
        let endpoint = TailscaleEndpointResolver.parseStatusJSON("""
        {
          "Self": {
            "HostName": "bad-ip-host",
            "TailscaleIPs": ["192.168.1.2", "fd7a:115c:a1e0::5"]
          }
        }
        """)

        XCTAssertNil(endpoint.ipv4)
        XCTAssertEqual(endpoint.ipv6, "fd7a:115c:a1e0::5")
        XCTAssertNil(endpoint.quicEndpointHint(port: 38747))
    }

    func testResolverUsesThirtySecondCache() {
        let clock = MutableClock(Date(timeIntervalSince1970: 1_000))
        let runner = CountingRunner(output: Self.runningStatusJSON)
        let resolver = TailscaleEndpointResolver(
            cliPath: "/fake/tailscale",
            environment: [:],
            cacheTTL: 30,
            clock: { clock.now },
            runner: runner.run
        )

        XCTAssertEqual(resolver.current().ipv4, "100.64.10.20")
        XCTAssertEqual(resolver.current().ipv4, "100.64.10.20")
        XCTAssertEqual(runner.count, 1)

        clock.now = clock.now.addingTimeInterval(31)
        XCTAssertEqual(resolver.current().ipv4, "100.64.10.20")
        XCTAssertEqual(runner.count, 2)
    }

    func testPairingBootstrapAdvertisesTailscaleEndpointHint() async {
        let coordinator = PairingCoordinator(
            deviceStore: InMemoryTrustedDeviceStore(),
            secretStore: InMemorySecretStore(),
            macDeviceID: DeviceID("mac-test-device"),
            macIdentitySigningKey: DeviceIdentitySigningKey(),
            tailscaleEndpointHintProvider: { "100.64.10.20:38747" }
        )

        let result = await coordinator.beginPairing(controllerDisplayName: "iPhone")

        XCTAssertEqual(result.bootstrapPayload.tailscaleEndpointHint, "100.64.10.20:38747")
        XCTAssertEqual(
            result.bootstrapPayload.bonjourServiceName,
            BridgeProductConfiguration.current.bonjourServiceType
        )
    }

    private static let runningStatusJSON = """
    {
      "Version": "1.56.1",
      "TailscaleIPs": ["100.64.10.20", "fd7a:115c:a1e0::1"],
      "Self": {
        "HostName": "chris-mac",
        "DNSName": "chris-mac.tail-abc.ts.net",
        "TailscaleIPs": ["100.64.10.20", "fd7a:115c:a1e0::1"]
      },
      "BackendState": "Running"
    }
    """
}

private final class MutableClock: @unchecked Sendable {
    var now: Date

    init(_ now: Date) {
        self.now = now
    }
}

private final class CountingRunner: @unchecked Sendable {
    private let output: String
    private(set) var count = 0

    init(output: String) {
        self.output = output
    }

    func run(executablePath: String, arguments: [String]) throws -> String {
        XCTAssertEqual(executablePath, "/fake/tailscale")
        XCTAssertEqual(arguments, ["status", "--json"])
        count += 1
        return output
    }
}
