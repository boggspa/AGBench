import Foundation

public struct TailscaleEndpoint: Codable, Equatable, Sendable {
    public let ipv4: String?
    public let ipv6: String?
    public let hostname: String?

    public init(ipv4: String? = nil, ipv6: String? = nil, hostname: String? = nil) {
        self.ipv4 = ipv4
        self.ipv6 = ipv6
        self.hostname = hostname
    }

    public var isAvailable: Bool {
        ipv4 != nil || ipv6 != nil
    }

    public func quicEndpointHint(port: UInt16) -> String? {
        guard let ipv4 else { return nil }
        return "\(ipv4):\(port)"
    }
}

public final class TailscaleEndpointResolver: @unchecked Sendable {
    public typealias Runner = @Sendable (_ executablePath: String, _ arguments: [String]) throws -> String
    public typealias Clock = @Sendable () -> Date

    public static let statusJSONEnvironmentKey = "AGBENCH_BRIDGE_TAILSCALE_STATUS_JSON"
    public static let cliPathEnvironmentKey = "AGBENCH_BRIDGE_TAILSCALE_CLI"

    private static let defaultCLILocations = [
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        "/opt/homebrew/bin/tailscale",
        "/usr/local/bin/tailscale",
        "/usr/bin/tailscale"
    ]

    private let cliPath: String?
    private let environment: [String: String]
    private let runner: Runner
    private let clock: Clock
    private let cacheTTL: TimeInterval
    private let lock = NSLock()

    private var cachedEndpoint: TailscaleEndpoint?
    private var cachedAt: Date?

    public init(
        cliPath: String? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        cacheTTL: TimeInterval = 30,
        clock: @escaping Clock = Date.init,
        runner: @escaping Runner = TailscaleEndpointResolver.runStatusJSON
    ) {
        self.cliPath = cliPath
        self.environment = environment
        self.cacheTTL = cacheTTL
        self.clock = clock
        self.runner = runner
    }

    public func current() -> TailscaleEndpoint {
        let now = clock()
        lock.lock()
        if let cachedEndpoint,
           let cachedAt,
           now.timeIntervalSince(cachedAt) < cacheTTL {
            lock.unlock()
            return cachedEndpoint
        }
        lock.unlock()

        let detected = detect()

        lock.lock()
        cachedEndpoint = detected
        cachedAt = now
        lock.unlock()

        return detected
    }

    public static func parseStatusJSON(_ statusJSON: String) -> TailscaleEndpoint {
        guard let data = statusJSON.data(using: .utf8),
              let raw = try? JSONDecoder().decode(RawStatus.self, from: data)
        else {
            return TailscaleEndpoint()
        }

        let ips = raw.selfNode?.tailscaleIPs ?? raw.tailscaleIPs ?? []
        let ipv4 = ips.first { isTailnetIPv4($0) }
        let ipv6 = ips.first { $0.contains(":") }
        return TailscaleEndpoint(
            ipv4: ipv4,
            ipv6: ipv6,
            hostname: raw.selfNode?.hostName
        )
    }

    private func detect() -> TailscaleEndpoint {
        if let fixtureJSON = environment[Self.statusJSONEnvironmentKey],
           !fixtureJSON.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return Self.parseStatusJSON(fixtureJSON)
        }

        guard let executablePath = resolvedCLIPath() else {
            return TailscaleEndpoint()
        }

        do {
            return Self.parseStatusJSON(try runner(executablePath, ["status", "--json"]))
        } catch {
            FileHandle.standardError.write(Data(
                "[TailscaleEndpointResolver] tailscale status failed: \(error.localizedDescription)\n".utf8
            ))
            return TailscaleEndpoint()
        }
    }

    private func resolvedCLIPath() -> String? {
        if let cliPath, !cliPath.isEmpty {
            return cliPath
        }
        if let envPath = environment[Self.cliPathEnvironmentKey], !envPath.isEmpty {
            return envPath
        }
        return Self.defaultCLILocations.first {
            FileManager.default.isExecutableFile(atPath: $0)
        }
    }

    public static func runStatusJSON(executablePath: String, arguments: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = arguments

        let stdout = Pipe()
        process.standardOutput = stdout
        process.standardError = Pipe()

        try process.run()

        let group = DispatchGroup()
        group.enter()
        DispatchQueue.global(qos: .utility).async {
            process.waitUntilExit()
            group.leave()
        }

        if group.wait(timeout: .now() + 3) == .timedOut {
            process.terminate()
            throw TailscaleEndpointError.timeout
        }

        guard process.terminationStatus == 0 else {
            throw TailscaleEndpointError.nonZeroExit(process.terminationStatus)
        }

        let data = stdout.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8) ?? ""
    }

    private static func isTailnetIPv4(_ value: String) -> Bool {
        let parts = value.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4 else { return false }
        return parts[0] == 100 && (0...255).contains(parts[1]) && parts[1] >= 64 && parts[1] <= 127
            && parts.dropFirst(2).allSatisfy { (0...255).contains($0) }
    }

    private struct RawStatus: Decodable {
        let tailscaleIPs: [String]?
        let selfNode: SelfNode?

        enum CodingKeys: String, CodingKey {
            case tailscaleIPs = "TailscaleIPs"
            case selfNode = "Self"
        }
    }

    private struct SelfNode: Decodable {
        let hostName: String?
        let tailscaleIPs: [String]?

        enum CodingKeys: String, CodingKey {
            case hostName = "HostName"
            case tailscaleIPs = "TailscaleIPs"
        }
    }
}

private enum TailscaleEndpointError: Error, LocalizedError {
    case timeout
    case nonZeroExit(Int32)

    var errorDescription: String? {
        switch self {
        case .timeout:
            return "tailscale status timed out"
        case .nonZeroExit(let status):
            return "tailscale status exited with code \(status)"
        }
    }
}
