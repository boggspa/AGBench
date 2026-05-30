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
}
