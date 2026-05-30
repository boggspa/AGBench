import XCTest
@testable import GuiGeminiCompanionCore

final class RemoteProjectionModelsTests: XCTestCase {
    private func data(_ object: [String: Any]) -> Data {
        try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    private func event(_ payload: [String: Any]) -> BridgeRunEvent {
        BridgeRunEvent(
            channel: .remoteProjection,
            provider: "codex",
            payloadJSON: data(payload),
            publishedAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
    }

    func testDecodesTaskCardEnvelope() throws {
        let decoded = try XCTUnwrap(RemoteProjectionEnvelope.decode(event: event([
            "schemaVersion": 1,
            "projectionKind": "RemoteTaskCard",
            "payload": [
                "taskId": "task-1",
                "workspaceId": "ws-1",
                "threadId": "chat-1",
                "runId": "run-1",
                "provider": "codex",
                "status": "awaiting-approval",
                "attentionReason": "Approval needed",
                "lastMessage": "Ready to run tests",
                "pendingApprovalCount": 1,
                "capabilities": [
                    "approve": true,
                    "cancel": true,
                    "startTurn": true
                ],
                "updatedAt": "2026-05-30T12:00:00Z"
            ]
        ])))

        guard case .task(let task) = decoded.payload else {
            XCTFail("expected task payload")
            return
        }
        XCTAssertEqual(decoded.kind, .task)
        XCTAssertEqual(task.id, "task-1")
        XCTAssertEqual(task.status, .awaitingApproval)
        XCTAssertTrue(task.capabilities.approve)
        XCTAssertTrue(task.capabilities.cancel)
    }

    func testDecodesThreadSnapshotEnvelope() throws {
        let decoded = try XCTUnwrap(RemoteProjectionEnvelope.decode(event: event([
            "projectionKind": "RemoteThreadSnapshot",
            "payload": [
                "threadId": "chat-1",
                "schemaVersion": 1,
                "mode": ["kind": "latestN", "n": 5],
                "rows": [
                    [
                        "id": "m-1",
                        "runId": "run-1",
                        "role": "assistant",
                        "kind": "assistant",
                        "preview": "Working",
                        "truncated": false,
                        "timestamp": "2026-05-30T12:01:00Z"
                    ]
                ],
                "totalRows": 9,
                "windowStartIndex": 4,
                "hasMoreAbove": true,
                "hasMoreBelow": false,
                "runSummary": [
                    "runId": "run-1",
                    "provider": "codex",
                    "status": "running"
                ],
                "generatedAt": "2026-05-30T12:02:00Z"
            ]
        ])))

        guard case .thread(let snapshot) = decoded.payload else {
            XCTFail("expected thread payload")
            return
        }
        XCTAssertEqual(snapshot.threadId, "chat-1")
        XCTAssertEqual(snapshot.rows.first?.preview, "Working")
        XCTAssertEqual(snapshot.runSummary?.runId, "run-1")
        XCTAssertEqual(decoded.runId, "run-1")
    }

    func testDecodesApprovalQuestionDiffAndEnsemblePayloads() throws {
        let approval = try XCTUnwrap(RemoteProjectionEnvelope.decode(event: event([
            "projectionKind": "MobileApprovalCard",
            "payload": [
                "approvalId": "approval-1",
                "workspaceId": "ws",
                "threadId": "chat",
                "runId": "run",
                "title": "Run command",
                "actions": ["accept", "decline"],
                "expiresAt": "2026-05-30T12:05:00Z"
            ]
        ])))
        guard case .approval(let approvalCard) = approval.payload else {
            XCTFail("expected approval")
            return
        }
        XCTAssertEqual(approvalCard.id, "approval-1")
        XCTAssertEqual(approvalCard.approvalDecisions, [.accept, .decline])

        let question = try XCTUnwrap(RemoteProjectionEnvelope.decode(event: event([
            "projectionKind": "MobileQuestionCard",
            "payload": [
                "questionId": "question-1",
                "threadId": "chat",
                "prompt": "Pick an option",
                "options": ["A", "B"]
            ]
        ])))
        guard case .question(let questionCard) = question.payload else {
            XCTFail("expected question")
            return
        }
        XCTAssertEqual(questionCard.options.map(\.value), ["A", "B"])

        let diff = try XCTUnwrap(RemoteProjectionEnvelope.decode(event: event([
            "projectionKind": "MobileDiffSummary",
            "payload": [
                "threadId": "chat",
                "runId": "run",
                "filesChanged": 1,
                "additions": 3,
                "deletions": 1,
                "files": [
                    ["path": "Sources/App.swift", "additions": 3, "deletions": 1]
                ]
            ]
        ])))
        guard case .diff(let diffSummary) = diff.payload else {
            XCTFail("expected diff")
            return
        }
        XCTAssertEqual(diffSummary.files.first?.path, "Sources/App.swift")

        let ensemble = try XCTUnwrap(RemoteProjectionEnvelope.decode(event: event([
            "projectionKind": "RemoteEnsembleProjection",
            "payload": [
                "threadId": "chat",
                "runId": "run",
                "roundStatus": "turn-bound",
                "activeParticipantId": "planner",
                "participants": [
                    ["id": "planner", "provider": "gemini", "role": "Planner", "active": true]
                ],
                "capabilities": ["steer": true]
            ]
        ])))
        guard case .ensemble(let ensembleProjection) = ensemble.payload else {
            XCTFail("expected ensemble")
            return
        }
        XCTAssertEqual(ensembleProjection.participants.first?.id, "planner")
        XCTAssertTrue(ensembleProjection.capabilities.steer)
    }

    func testDecodesShellAppearanceProjection() throws {
        let decoded = try XCTUnwrap(RemoteProjectionEnvelope.decode(event: event([
            "kind": "shellAppearance",
            "generatedAt": "2026-05-30T12:00:00Z",
            "payload": [
                "schemaVersion": 1,
                "generatedAt": "2026-05-30T12:00:00Z",
                "appearanceMode": "native_glass",
                "visualEffectStyle": "liquid_glass",
                "themeAppearance": "obsidian",
                "themeCornerStyle": "hard",
                "themeAccentStyle": "purple",
                "promptSurfaceStyle": "liquid_glass",
                "composerStyle": "claude",
                "reduceTransparency": true,
                "reduceMotion": false,
                "compactDensity": true,
                "preferredColorScheme": "dark",
                "colors": [
                    "windowBase": ["light": "#f4f6f8", "dark": "#141414"],
                    "sidebarBase": ["light": "#c2c2c2", "dark": "#1e1e22"],
                    "cardFill": ["light": "#f6f9fbae", "dark": "#1c1c20d1"],
                    "cardStroke": ["light": "#0000001a", "dark": "#ffffff1a"],
                    "elevatedCardFill": ["light": "#fbfdffc7", "dark": "#26262ce0"],
                    "inputSurface": ["light": "#00000012", "dark": "#ffffff12"],
                    "composerSurface": ["light": "#ffffffc7", "dark": "#071024eb"],
                    "composerBorder": ["light": "#0000001f", "dark": "#7c9eff38"],
                    "primaryText": ["light": "#000000e0", "dark": "#ffffffeb"],
                    "secondaryText": ["light": "#0000009e", "dark": "#ffffff8c"],
                    "tertiaryText": ["light": "#00000070", "dark": "#ffffff59"],
                    "separator": ["light": "#00000017", "dark": "#ffffff0f"],
                    "accent": "#bf7cff",
                    "accentSoft": ["light": "#bf7cff24", "dark": "#bf7cff2e"],
                    "secondaryAccent": ["light": "#00739e", "dark": "#6bc4db"],
                    "success": "#4cc38a",
                    "warning": "#f5a623",
                    "destructive": "#e54d4d"
                ]
            ]
        ])))

        guard case .shellAppearance(let appearance) = decoded.payload else {
            XCTFail("expected shell appearance")
            return
        }
        XCTAssertEqual(decoded.kind, .shellAppearance)
        XCTAssertEqual(appearance.themeAppearance, "obsidian")
        XCTAssertEqual(appearance.themeAccentStyle, "purple")
        XCTAssertEqual(appearance.composerStyle, "claude")
        XCTAssertEqual(appearance.preferredColorScheme, .dark)
        XCTAssertEqual(appearance.colors.accent, "#bf7cff")
        XCTAssertEqual(appearance.colors.composerSurface.dark, "#071024eb")
    }
}
