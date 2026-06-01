import XCTest
import BridgeCore
@testable import AgbenchBridgeDaemon

final class BridgeAckDecodingTests: XCTestCase {
    func testActionAckPreservesStructuredElectronFields() throws {
        let receivedAt = Date(timeIntervalSince1970: 1_700_000_000)
        let result = try jsonData([
            "accepted": true,
            "schemaVersion": 2,
            "actionId": "action-1",
            "state": "succeeded",
            "deliveredAt": "2023-11-14T22:13:20.123Z",
            "executed": true,
            "reasonCode": "ok",
            "message": "Registered",
            "actionKind": "registerApnsToken",
            "workspaceId": "ws-1",
            "threadId": "chat-1",
            "runId": "provider-run-1",
            "appRunId": "app-run-1",
            "messageId": "message-1",
            "approvalId": "approval-1",
            "questionId": "question-1",
            "pairId": "pair-1",
            "correlationId": "corr-1",
            "scope": "once",
            "data": [
                "registered": true,
                "retryCount": 2,
                "note": "apns"
            ]
        ])

        let ack = try BridgeAckDecoding.actionAck(from: result, receivedAt: receivedAt)

        XCTAssertEqual(ack.schemaVersion, 2)
        XCTAssertEqual(ack.accepted, true)
        XCTAssertEqual(ack.executed, true)
        XCTAssertEqual(ack.actionID?.rawValue, "action-1")
        XCTAssertEqual(ack.state?.rawValue, "succeeded")
        XCTAssertEqual(ack.reasonCode, "ok")
        XCTAssertEqual(ack.message, "Registered")
        XCTAssertEqual(ack.actionKind, "registerApnsToken")
        XCTAssertEqual(ack.workspaceId, "ws-1")
        XCTAssertEqual(ack.threadId, "chat-1")
        XCTAssertEqual(ack.runId, "provider-run-1")
        XCTAssertEqual(ack.appRunId, "app-run-1")
        XCTAssertEqual(ack.messageId, "message-1")
        XCTAssertEqual(ack.approvalId, "approval-1")
        XCTAssertEqual(ack.questionId, "question-1")
        XCTAssertEqual(ack.pairId, "pair-1")
        XCTAssertEqual(ack.correlationId, "corr-1")
        XCTAssertEqual(ack.scope, "once")
        XCTAssertEqual(ack.data?["registered"], .bool(true))
        XCTAssertEqual(ack.data?["retryCount"], .number(2))
        XCTAssertEqual(ack.data?["note"], .string("apns"))
        XCTAssertTrue(BridgeAckDecoding.unknownActionAckFields(in: result).isEmpty)
    }

    func testActionAckFallsBackToPayloadActionIdAndStructuresRejectError() throws {
        let receivedAt = Date(timeIntervalSince1970: 1_700_000_000)
        let result = try jsonData([
            "accepted": false,
            "message": "Workspace is read-only"
        ])
        let payload = Data(#"{"kind":"cancelRun","actionId":"payload-action-1"}"#.utf8)

        let ack = try BridgeAckDecoding.actionAck(
            from: result,
            payloadData: payload,
            receivedAt: receivedAt
        )

        XCTAssertEqual(ack.accepted, false)
        XCTAssertEqual(ack.executed, nil)
        XCTAssertEqual(ack.actionID?.rawValue, "payload-action-1")
        XCTAssertEqual(ack.state?.rawValue, "rejected")
        XCTAssertEqual(ack.message, "Workspace is read-only")
        XCTAssertEqual(ack.error?.code, "bridgeActionRejected")
        XCTAssertEqual(ack.error?.severity, .warning)
    }

    func testPrepareStartTurnAckPreservesTimingAndError() throws {
        let request = BridgePrepareStartTurnRequest(
            prepareID: "prep-1",
            workspaceID: WorkspaceID("ws-1"),
            threadID: ThreadID("chat-1"),
            requestedAt: Date(timeIntervalSince1970: 1_699_999_990)
        )
        let result = try jsonData([
            "accepted": false,
            "message": "Denied",
            "readyAt": "2023-11-14T22:13:20Z",
            "expiresAt": "2023-11-14T22:14:20Z",
            "error": [
                "code": "workspaceDenied",
                "message": "Denied",
                "severity": "error",
                "redactedDetails": "allowlist"
            ]
        ])

        let ack = try BridgeAckDecoding.prepareStartTurnAck(from: result, request: request)

        XCTAssertEqual(ack.prepareID, "prep-1")
        XCTAssertEqual(ack.workspaceID, WorkspaceID("ws-1"))
        XCTAssertEqual(ack.threadID, ThreadID("chat-1"))
        XCTAssertEqual(ack.accepted, false)
        XCTAssertEqual(ack.message, "Denied")
        XCTAssertEqual(ack.error?.code, "workspaceDenied")
        XCTAssertEqual(ack.error?.severity, .error)
        XCTAssertEqual(ack.error?.redactedDetails, "allowlist")
        XCTAssertNotNil(ack.expiresAt)
    }

    private func jsonData(_ object: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }
}
