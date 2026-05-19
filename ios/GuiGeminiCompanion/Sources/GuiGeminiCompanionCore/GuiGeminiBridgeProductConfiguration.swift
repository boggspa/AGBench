import Foundation
import BridgeCore

/// Holds the AGBench-flavoured `BridgeProductConfiguration` and
/// exposes a single `install()` entry point that the iOS app calls at
/// launch.
///
/// Why this is its own helper: the default `BridgeProductConfiguration`
/// inside BridgeCore is sized for CodexBridge — its ALPN, service
/// types, and ports don't match the AGBench Mac daemon. Until
/// CodexBridge gains a `BridgeProductConfiguration.guiGemini` static
/// preset (Gap #6 in the roadmap), both the daemon and the iOS app
/// have to construct the same record by hand. The two definitions
/// MUST stay byte-identical:
///   - Daemon:  `swift/GuiGeminiBridge/Sources/GuiGeminiBridgeDaemon/main.swift`
///   - iOS:     this file, `GuiGeminiBridgeProductConfiguration.preset`
///
/// Drift between the two breaks the QUIC handshake (mismatched ALPN
/// produces a TLS abort during the carrier's first round trip — the
/// connection never reaches `.ready`, no subscribe goes out, and the
/// Mac side broadcasts events to zero peers).
public enum GuiGeminiBridgeProductConfiguration {
    /// The product configuration the iOS companion runs under. Must
    /// match the daemon-side `guiGeminiConfiguration` exactly.
    public static let preset = BridgeProductConfiguration(
        displayName: "AGBench",
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

    /// Idempotent — installs `preset` into `BridgeProductConfiguration.current`.
    /// Call once at app launch, before any view model spins up a transport.
    public static func install() {
        BridgeProductConfiguration.current = preset
    }
}
