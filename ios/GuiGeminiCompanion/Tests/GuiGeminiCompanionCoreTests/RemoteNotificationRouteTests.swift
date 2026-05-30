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

    func testIgnoresForbiddenPrivateFieldsAcrossSupportedContainers() throws {
        let forbiddenValues = [
            "PRIVATE_PROMPT_TEXT",
            "PRIVATE_APPROVAL_BODY",
            "PRIVATE_COMMAND_TEXT",
            "PRIVATE_DIFF_HUNK",
            "/Users/example/private-project"
        ]
        let route = try XCTUnwrap(RemoteNotificationRoute(userInfo: [
            "aps": [
                "alert": [
                    "title": "AGBench",
                    "body": "PRIVATE_PROMPT_TEXT"
                ]
            ],
            "workspaceId": "ws-safe",
            "promptText": "PRIVATE_PROMPT_TEXT",
            "approvalBody": "PRIVATE_APPROVAL_BODY",
            "commandText": "PRIVATE_COMMAND_TEXT",
            "filePath": "/Users/example/private-project/file.ts",
            "diffHunks": ["@@ PRIVATE_DIFF_HUNK @@"],
            "route": [
                "threadId": "thread-safe",
                "summary": "PRIVATE_APPROVAL_BODY",
                "command": "PRIVATE_COMMAND_TEXT"
            ],
            "payload": [
                "runId": "run-safe",
                "body": "PRIVATE_PROMPT_TEXT",
                "filePaths": ["/Users/example/private-project/secret.swift"],
                "diff": "@@ PRIVATE_DIFF_HUNK @@"
            ]
        ]))

        XCTAssertEqual(route.workspaceId, "ws-safe")
        XCTAssertEqual(route.threadId, "thread-safe")
        XCTAssertEqual(route.runId, "run-safe")
        let encoded = String(data: try JSONEncoder().encode(route), encoding: .utf8) ?? ""
        for forbidden in forbiddenValues {
            XCTAssertFalse(encoded.contains(forbidden), "Route leaked private APNs content: \(forbidden)")
        }
    }

    func testReturnsNilForPrivateTextOnlyPayloadWithoutRoutingIdentifiers() {
        XCTAssertNil(RemoteNotificationRoute(userInfo: [
            "aps": [
                "alert": [
                    "title": "AGBench",
                    "body": "PRIVATE_PROMPT_TEXT"
                ]
            ],
            "payload": [
                "promptText": "PRIVATE_PROMPT_TEXT",
                "approvalBody": "PRIVATE_APPROVAL_BODY",
                "commandText": "PRIVATE_COMMAND_TEXT",
                "filePath": "/Users/example/private-project/file.ts",
                "diffHunks": ["@@ PRIVATE_DIFF_HUNK @@"]
            ]
        ]))
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
