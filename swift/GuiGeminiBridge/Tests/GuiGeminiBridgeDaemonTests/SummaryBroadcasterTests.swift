import XCTest
@testable import GuiGeminiBridgeDaemon

final class SummaryBroadcasterTests: XCTestCase {
    func testWorkspaceListBroadcastEnvelopePreservesPayload() throws {
        let params: [String: Any] = [
            "workspaces": [
                [
                    "workspaceId": "ws-1",
                    "displayName": "AGBench",
                    "path": "/Users/dev/agbench",
                    "chatCount": 3,
                    "runningChatCount": 1,
                    "lastActivityAt": "2026-05-18T10:11:12.123Z"
                ]
            ]
        ]

        let event = try decodeEvent(
            SummaryBroadcaster.makeEventJSON(
                kind: .workspaceList,
                params: params,
                publishedAt: Date(timeIntervalSince1970: 1_700_000_000)
            )
        )

        XCTAssertEqual(event["channel"] as? String, "remote-projection")
        XCTAssertEqual(event["kind"] as? String, "workspaceList")
        XCTAssertEqual(event["legacyChannel"] as? String, "workspace-list")
        XCTAssertEqual(event["provider"] as? String, "system")
        let payload = try XCTUnwrap(event["payload"] as? [String: Any])
        let workspaces = try XCTUnwrap(payload["workspaces"] as? [[String: Any]])
        XCTAssertEqual(workspaces.first?["workspaceId"] as? String, "ws-1")
        XCTAssertEqual(workspaces.first?["lastActivityAt"] as? String, "2026-05-18T10:11:12.123Z")
    }

    func testThreadUpdatedBroadcastEnvelopeUsesExactChannelAndRootKey() throws {
        let params: [String: Any] = [
            "thread": [
                "chatId": "chat-1",
                "title": "Bridge work",
                "workspaceId": "ws-1",
                "provider": "codex",
                "status": "running",
                "lastMessageAt": "2026-05-18T10:11:12Z"
            ]
        ]

        let event = try decodeEvent(
            SummaryBroadcaster.makeEventJSON(
                kind: .threadUpdated,
                params: params,
                publishedAt: Date(timeIntervalSince1970: 1_700_000_000)
            )
        )

        XCTAssertEqual(event["channel"] as? String, "remote-projection")
        XCTAssertEqual(event["kind"] as? String, "threadUpdated")
        XCTAssertEqual(event["legacyChannel"] as? String, "thread-updated")
        XCTAssertEqual(event["threadId"] as? String, "chat-1")
        let payload = try XCTUnwrap(event["payload"] as? [String: Any])
        let thread = try XCTUnwrap(payload["thread"] as? [String: Any])
        XCTAssertEqual(thread["chatId"] as? String, "chat-1")
        XCTAssertEqual(thread["provider"] as? String, "codex")
    }

    func testAllSharedChannelsStayStable() {
        XCTAssertEqual(SummaryBroadcastKind.workspaceList.channel, "workspace-list")
        XCTAssertEqual(SummaryBroadcastKind.workspaceUpdated.channel, "workspace-updated")
        XCTAssertEqual(SummaryBroadcastKind.threadList.channel, "thread-list")
        XCTAssertEqual(SummaryBroadcastKind.threadUpdated.channel, "thread-updated")
        XCTAssertEqual(SummaryBroadcastKind.workspaceList.projectionKind, "workspaceList")
        XCTAssertEqual(SummaryBroadcastKind.threadUpdated.projectionKind, "threadUpdated")
        XCTAssertEqual(RemoteProjectionEnvelope.channel, "remote-projection")
    }

    func testGenericRemoteProjectionEnvelopeUsesChannelKindAndThreadHint() throws {
        let projection = try SummaryBroadcaster.makeRemoteProjectionEventJSON(
            params: [
                "kind": "threadSnapshot",
                "threadId": "chat-1",
                "payload": [
                    "threadId": "chat-1",
                    "schemaVersion": 1,
                    "rows": []
                ]
            ],
            publishedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )

        XCTAssertEqual(projection.threadID, "chat-1")
        let event = try decodeEvent(projection.data)
        XCTAssertEqual(event["channel"] as? String, "remote-projection")
        XCTAssertEqual(event["kind"] as? String, "threadSnapshot")
        XCTAssertEqual(event["threadId"] as? String, "chat-1")
        let payload = try XCTUnwrap(event["payload"] as? [String: Any])
        XCTAssertEqual(payload["threadId"] as? String, "chat-1")
        XCTAssertEqual(payload["schemaVersion"] as? Int, 1)
    }

    func testMissingRootKeyFailsBeforeBroadcast() {
        XCTAssertThrowsError(
            try SummaryBroadcaster.makeEventJSON(
                kind: .threadList,
                params: ["workspaces": []],
                publishedAt: Date(timeIntervalSince1970: 1_700_000_000)
            )
        ) { error in
            XCTAssertEqual(
                error as? SummaryBroadcasterError,
                SummaryBroadcasterError.invalidParams("Summary broadcast params missing root key \"threads\"")
            )
        }
    }

    private func decodeEvent(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}
