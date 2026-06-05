// swift-tools-version: 6.0
import PackageDescription

/// TaskWraithBridge — Mac-side daemon that bridges the TaskWraith Electron app
/// to native macOS Screen Watch, creative-app, editor, and stdio JSON-RPC
/// helpers.
///
/// Architecture:
///   - Electron main process spawns the `TaskWraithBridgeDaemon` executable
///     as a subprocess (mirrors the existing `CodexAppServerClient` spawn
///     pattern in `src/main/CodexAppServerClient.ts`).
///   - The daemon communicates with Electron over stdio JSON-RPC.
///   - The package is self-contained and has no sibling-checkout dependency.
let package = Package(
    name: "TaskWraithBridge",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "TaskWraithBridgeDaemon",
            targets: ["TaskWraithBridgeDaemon"]
        )
    ],
    targets: [
        .executableTarget(
            name: "TaskWraithBridgeDaemon"
        ),
        .testTarget(
            name: "TaskWraithBridgeDaemonTests",
            dependencies: ["TaskWraithBridgeDaemon"]
        )
    ]
)
