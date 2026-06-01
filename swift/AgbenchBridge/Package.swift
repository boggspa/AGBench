// swift-tools-version: 6.0
import PackageDescription

/// AgbenchBridge — Mac-side daemon that bridges the AGBench Electron app
/// to native macOS Screen Watch, creative-app, editor, and stdio JSON-RPC
/// helpers.
///
/// Architecture:
///   - Electron main process spawns the `AgbenchBridgeDaemon` executable
///     as a subprocess (mirrors the existing `CodexAppServerClient` spawn
///     pattern in `src/main/CodexAppServerClient.ts`).
///   - The daemon communicates with Electron over stdio JSON-RPC.
///   - The package is self-contained and has no sibling-checkout dependency.
let package = Package(
    name: "AgbenchBridge",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "AgbenchBridgeDaemon",
            targets: ["AgbenchBridgeDaemon"]
        )
    ],
    targets: [
        .executableTarget(
            name: "AgbenchBridgeDaemon"
        ),
        .testTarget(
            name: "AgbenchBridgeDaemonTests",
            dependencies: ["AgbenchBridgeDaemon"]
        )
    ]
)
