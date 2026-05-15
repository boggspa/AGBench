// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "GuiGeminiCompanion",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(name: "GuiGeminiCompanionCore", targets: ["GuiGeminiCompanionCore"])
    ],
    dependencies: [
        // BridgeCore + sibling shared packages from CodexBridge.
        // Path-relative dependency mirrors the swift/GuiGeminiBridge daemon's
        // dependency on the same repo. When CodexBridge ships as a real
        // versioned package the .package(url:) declaration replaces this.
        .package(path: "../../../CodexBridge")
    ],
    targets: [
        .target(
            name: "GuiGeminiCompanionCore",
            dependencies: [
                .product(name: "BridgeCore", package: "CodexBridge"),
                .product(name: "BridgeCryptoPairing", package: "CodexBridge"),
                .product(name: "BridgeLANTransport", package: "CodexBridge")
            ]
        ),
        .testTarget(
            name: "GuiGeminiCompanionCoreTests",
            dependencies: ["GuiGeminiCompanionCore"]
        )
    ]
)
