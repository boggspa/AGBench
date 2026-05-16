// swift-tools-version: 6.0
import PackageDescription

/// GuiGeminiBridge — Mac-side daemon that bridges the GUIGemini Electron app
/// to BridgeCore (transport + pairing + replay primitives lifted from
/// CodexBridge in Phase A).
///
/// Architecture:
///   - Electron main process spawns the `GuiGeminiBridgeDaemon` executable
///     as a subprocess (mirrors the existing `CodexAppServerClient` spawn
///     pattern in `src/main/CodexAppServerClient.ts`).
///   - The daemon communicates with Electron over stdio JSON-RPC (Phase C1).
///   - The daemon owns the BridgeCore transport stack: QUIC + Bonjour
///     listening, pairing acceptance, trusted-device verification, and the
///     subscription/replay primitives.
///   - Incoming iOS actions are translated to Electron-side `RunService` calls;
///     outgoing run events from the `RunEventBus` are forwarded to subscribed
///     iOS clients.
///
/// BridgeCore is consumed via a path-relative dependency on the local
/// CodexBridge checkout. Once BridgeCore lives in its own repo, this becomes
/// a Git URL dependency.
let package = Package(
    name: "GuiGeminiBridge",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "GuiGeminiBridgeDaemon",
            targets: ["GuiGeminiBridgeDaemon"]
        )
    ],
    dependencies: [
        // BridgeCore lives in the sibling CodexBridge checkout. Path is
        // relative to this Package.swift (swift/GuiGeminiBridge/) — three
        // hops up to ~/Documents/, then into CodexBridge.
        .package(path: "../../../CodexBridge")
    ],
    targets: [
        .executableTarget(
            name: "GuiGeminiBridgeDaemon",
            dependencies: [
                .product(name: "BridgeCore", package: "CodexBridge"),
                .product(name: "BridgeCryptoPairing", package: "CodexBridge"),
                .product(name: "BridgeLANTransport", package: "CodexBridge"),
                .product(name: "WorkspaceSecurity", package: "CodexBridge"),
                .product(name: "GitBridge", package: "CodexBridge")
            ]
        ),
        .testTarget(
            name: "GuiGeminiBridgeDaemonTests",
            dependencies: ["GuiGeminiBridgeDaemon"]
        )
    ]
)
