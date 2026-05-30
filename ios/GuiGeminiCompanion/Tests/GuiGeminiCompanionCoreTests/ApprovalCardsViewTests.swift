import SwiftUI
import XCTest
import CryptoKit
import BridgeCore
import BridgeCryptoPrimitives
import BridgeCryptoPairing
@testable import GuiGeminiCompanionCore

/// ApprovalCardsViewTests — exercise the per-kind preview block rendering
/// added in the iOS gap-fill. The view itself is render-time SwiftUI so
/// we can't grab a string from `body` directly without an environment, but
/// we can verify the view value builds without crashing for every
/// preview kind (regression guard for the switch-statement coverage) and
/// inspect the underlying `PendingApproval` data the renderer reads from.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
final class ApprovalCardsViewTests: XCTestCase {
    /// Build a minimal `Pair` so the `ApprovalViewModel` initializer (which
    /// requires a `GuiGeminiBridgeClient`) has something legal to attach to.
    /// Tests never call `client.start()` so no network ever opens.
    private func sampleClient() -> GuiGeminiBridgeClient {
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
        let pair = GuiGeminiBridgeClient.Pair(
            pairID: PairID("pair-approval-test"),
            controllerDeviceID: DeviceID("iphone-test"),
            macDeviceID: DeviceID("mac-test"),
            derivedKeys: derived
        )
        return GuiGeminiBridgeClient(pair: pair)
    }

    /// Render-path regression: the view must build a body for every
    /// `ApprovalPreview.Kind`. If the switch in `previewBlock(for:)`
    /// stops covering a case, this test fails by throwing or hitting
    /// an exhaustiveness compile error at the call site.
    func testApprovalCardsRenderEveryPreviewKindWithoutCrashing() throws {
        let viewModel = ApprovalViewModel(client: sampleClient())
        let approvals: [PendingApproval] = [
            PendingApproval(
                id: "tc-cmd",
                workspaceId: "/ws",
                threadId: "chat-1",
                summary: "Run shell command",
                title: "Run ls",
                body: "List contents of /tmp",
                preview: ApprovalPreview(
                    kind: .command,
                    command: "ls -la /tmp",
                    cwd: "/tmp"
                ),
                actions: ["accept", "decline"]
            ),
            PendingApproval(
                id: "tc-tool",
                workspaceId: "/ws",
                threadId: "chat-1",
                summary: "Tool invocation",
                title: "Use the Edit tool",
                body: "Edit Sources/App.swift",
                preview: ApprovalPreview(
                    kind: .tool,
                    toolName: "Edit"
                )
            ),
            PendingApproval(
                id: "tc-patch",
                workspaceId: "/ws",
                threadId: "chat-1",
                summary: "Apply patch",
                title: "Apply patch",
                preview: ApprovalPreview(
                    kind: .patch,
                    patchPreview: "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new"
                )
            ),
            PendingApproval(
                id: "tc-files",
                workspaceId: "/ws",
                threadId: "chat-1",
                summary: "Touch files",
                title: "Modify files",
                preview: ApprovalPreview(
                    kind: .files,
                    changes: [
                        "Sources/A.swift",
                        "Sources/B.swift",
                        "Sources/C.swift",
                        "Sources/D.swift",
                        "Sources/E.swift",
                        "Sources/F.swift",
                        "Sources/G.swift",
                        "Sources/H.swift",
                        "Sources/I.swift",  // beyond the 8-row cap → "+N more"
                        "Sources/J.swift"
                    ]
                )
            ),
            PendingApproval(
                id: "tc-trust",
                workspaceId: "/ws",
                threadId: "chat-1",
                summary: "Trust workspace",
                title: "Trust workspace",
                preview: ApprovalPreview(
                    kind: .workspaceTrust,
                    workspacePath: "/Users/me/dev/GUIGemini"
                )
            ),
            PendingApproval(
                id: "tc-generic",
                workspaceId: "/ws",
                threadId: "chat-1",
                summary: "Just a note",
                title: "Generic approval",
                body: "Body suffices.",
                preview: ApprovalPreview(kind: .generic)
            )
        ]
        for approval in approvals {
            viewModel.enqueue(approval)
        }

        let view = ApprovalCardsView(viewModel: viewModel)

        // Building the SwiftUI body must not throw and must produce a
        // non-nil value. (Headless SwiftUI doesn't expose `renderToStaticMarkup`,
        // so this is the pragmatic equivalent: the type-checker + the body
        // builder reach every branch.)
        XCTAssertNoThrow(_ = view.body)

        // The view reads each approval's fields directly — verify the
        // underlying model carries the per-kind values we expect the
        // renderer to surface.
        XCTAssertEqual(viewModel.pending.count, approvals.count)
        let byID = Dictionary(uniqueKeysWithValues: viewModel.pending.map { ($0.id, $0) })
        XCTAssertEqual(byID["tc-cmd"]?.preview?.command, "ls -la /tmp")
        XCTAssertEqual(byID["tc-cmd"]?.preview?.cwd, "/tmp")
        XCTAssertEqual(byID["tc-tool"]?.preview?.toolName, "Edit")
        XCTAssertTrue(byID["tc-patch"]?.preview?.patchPreview?.contains("+new") ?? false)
        XCTAssertEqual(byID["tc-files"]?.preview?.changes?.count, 10)
        XCTAssertEqual(byID["tc-trust"]?.preview?.workspacePath, "/Users/me/dev/GUIGemini")
        XCTAssertEqual(byID["tc-generic"]?.preview?.kind, .generic)
    }
}
