import XCTest
@testable import GuiGeminiCompanionCore

final class RemoteNotificationRouteTests: XCTestCase {
    func testParsesNestedRouteIdentifiers() throws {
        let route = try XCTUnwrap(RemoteNotificationRoute(userInfo: [
            "aps": ["content-available": 1],
            "route": [
                "kind": "approval",
                "workspaceId": "ws-1",
                "threadId": "thread-1",
                "taskId": "task-1",
                "runId": "run-1",
                "approvalId": "approval-1"
            ]
        ]))

        XCTAssertEqual(route.kind, "approval")
        XCTAssertEqual(route.workspaceId, "ws-1")
        XCTAssertEqual(route.threadId, "thread-1")
        XCTAssertEqual(route.taskId, "task-1")
        XCTAssertEqual(route.runId, "run-1")
        XCTAssertEqual(route.approvalId, "approval-1")
        XCTAssertEqual(route.watchedThreadIds, ["thread-1"])
    }

    func testParsesLegacyRoutingAliases() throws {
        let route = try XCTUnwrap(RemoteNotificationRoute(userInfo: [
            "payload": [
                "appChatId": "chat-77",
                "appRunId": "app-run-77",
                "promptId": "question-77"
            ]
        ]))

        XCTAssertEqual(route.threadId, "chat-77")
        XCTAssertEqual(route.runId, "app-run-77")
        XCTAssertEqual(route.questionId, "question-77")
    }

    func testIgnoresVisibleAlertAndPrivateTextFields() throws {
        let route = try XCTUnwrap(RemoteNotificationRoute(userInfo: [
            "aps": [
                "alert": [
                    "title": "Approval needed",
                    "body": "Do not copy this prompt text"
                ]
            ],
            "payload": [
                "threadId": "thread-safe",
                "workspacePath": "/Users/example/private",
                "body": "Do not copy this approval body"
            ]
        ]))

        XCTAssertEqual(route.threadId, "thread-safe")
        let encoded = String(data: try JSONEncoder().encode(route), encoding: .utf8) ?? ""
        XCTAssertFalse(encoded.contains("Do not copy"))
        XCTAssertFalse(encoded.contains("workspacePath"))
        XCTAssertFalse(encoded.contains("/Users/example/private"))
    }

    func testReturnsNilWhenPayloadHasNoRoutingIdentifiers() {
        XCTAssertNil(RemoteNotificationRoute(userInfo: [
            "aps": [
                "alert": [
                    "title": "AGBench",
                    "body": "A task needs attention"
                ]
            ],
            "payload": [
                "body": "text-only payload"
            ]
        ]))
    }
}
