import XCTest
@testable import GuiGeminiCompanionCore

/// Tests for the four `summary-kind` payload decoders, the round-trip
/// behavior of the typed structs, and the dispatch logic in
/// `BridgeWorkspaceSummariesDecoder`.
///
/// These cover the iOS half of the workspace+thread broadcast contract;
/// the matching Mac TS / Swift-daemon halves live in their own repos.
final class BridgeWorkspaceSummariesTests: XCTestCase {
    private func encodeEnvelope(_ object: [String: Any]) -> Data {
        try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    // MARK: - Codable round-trips

    func testWorkspaceSummaryRoundTrip() throws {
        let payload = WorkspaceSummaryPayload(
            workspaceId: "ws-1",
            displayName: "GUIGemini",
            path: "/Users/me/dev/GUIGemini",
            chatCount: 4,
            runningChatCount: 1,
            lastActivityAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(payload)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(WorkspaceSummaryPayload.self, from: data)
        XCTAssertEqual(decoded, payload)
    }

    func testThreadSummaryRoundTripWithoutOptionalDates() throws {
        let payload = ThreadSummaryPayload(
            chatId: "chat-7",
            title: "Wire iPad sidebar",
            workspaceId: nil,
            provider: "codex",
            status: "idle",
            lastMessageAt: nil
        )
        let encoder = JSONEncoder()
        let data = try encoder.encode(payload)
        let decoder = JSONDecoder()
        let decoded = try decoder.decode(ThreadSummaryPayload.self, from: data)
        XCTAssertEqual(decoded, payload)
        XCTAssertNil(decoded.workspaceId)
        XCTAssertNil(decoded.lastMessageAt)
    }

    // MARK: - Decoder dispatch

    func testDecodeWorkspaceListChannel() throws {
        let event = try BridgeRunEvent.decode(eventRecordBytes: encodeEnvelope([
            "channel": "workspace-list",
            "provider": "system",
            "publishedAt": "2026-05-18T09:00:00Z",
            "payload": [
                "workspaces": [
                    [
                        "workspaceId": "ws-1",
                        "displayName": "GUIGemini",
                        "path": "/Users/me/dev/GUIGemini",
                        "chatCount": 3,
                        "runningChatCount": 1,
                        "lastActivityAt": "2026-05-18T08:59:00Z"
                    ],
                    [
                        "workspaceId": "ws-2",
                        "displayName": "CodexBridge",
                        "path": "/Users/me/dev/CodexBridge",
                        "chatCount": 0,
                        "runningChatCount": 0
                    ]
                ]
            ]
        ]))
        let decoded = try BridgeWorkspaceSummariesDecoder.decode(event: event)
        guard case .workspaceList(let payload) = decoded else {
            XCTFail("expected workspaceList, got \(String(describing: decoded))")
            return
        }
        XCTAssertEqual(payload.workspaces.count, 2)
        XCTAssertEqual(payload.workspaces[0].workspaceId, "ws-1")
        XCTAssertEqual(payload.workspaces[0].runningChatCount, 1)
        XCTAssertNotNil(payload.workspaces[0].lastActivityAt)
        XCTAssertEqual(payload.workspaces[1].workspaceId, "ws-2")
        XCTAssertNil(payload.workspaces[1].lastActivityAt)
    }

    func testDecodeWorkspaceUpdatedChannel() throws {
        let event = try BridgeRunEvent.decode(eventRecordBytes: encodeEnvelope([
            "channel": "workspace-updated",
            "provider": "system",
            "publishedAt": "2026-05-18T09:00:00Z",
            "payload": [
                "workspace": [
                    "workspaceId": "ws-9",
                    "displayName": "AGBench",
                    "path": "/Users/me/dev/AGBench",
                    "chatCount": 1,
                    "runningChatCount": 0
                ]
            ]
        ]))
        let decoded = try BridgeWorkspaceSummariesDecoder.decode(event: event)
        guard case .workspaceUpdated(let payload) = decoded else {
            XCTFail("expected workspaceUpdated, got \(String(describing: decoded))")
            return
        }
        XCTAssertEqual(payload.workspace.workspaceId, "ws-9")
        XCTAssertEqual(payload.workspace.displayName, "AGBench")
    }

    func testDecodeThreadListChannel() throws {
        let event = try BridgeRunEvent.decode(eventRecordBytes: encodeEnvelope([
            "channel": "thread-list",
            "provider": "system",
            "publishedAt": "2026-05-18T09:00:00Z",
            "payload": [
                "threads": [
                    [
                        "chatId": "chat-1",
                        "title": "Wire iPad",
                        "workspaceId": "ws-1",
                        "provider": "gemini",
                        "status": "running",
                        "lastMessageAt": "2026-05-18T08:58:00Z"
                    ],
                    [
                        "chatId": "chat-2",
                        "title": "Global notes",
                        "workspaceId": NSNull(),
                        "provider": "codex",
                        "status": "idle"
                    ]
                ]
            ]
        ]))
        let decoded = try BridgeWorkspaceSummariesDecoder.decode(event: event)
        guard case .threadList(let payload) = decoded else {
            XCTFail("expected threadList, got \(String(describing: decoded))")
            return
        }
        XCTAssertEqual(payload.threads.count, 2)
        XCTAssertEqual(payload.threads[0].chatId, "chat-1")
        XCTAssertEqual(payload.threads[0].status, "running")
        XCTAssertEqual(payload.threads[0].workspaceId, "ws-1")
        XCTAssertNotNil(payload.threads[0].lastMessageAt)
        XCTAssertNil(payload.threads[1].workspaceId)
        XCTAssertNil(payload.threads[1].lastMessageAt)
    }

    func testDecodeThreadUpdatedChannel() throws {
        let event = try BridgeRunEvent.decode(eventRecordBytes: encodeEnvelope([
            "channel": "thread-updated",
            "provider": "system",
            "publishedAt": "2026-05-18T09:00:00Z",
            "payload": [
                "thread": [
                    "chatId": "chat-42",
                    "title": "Polish iPad shell",
                    "workspaceId": "ws-1",
                    "provider": "claude",
                    "status": "success",
                    "lastMessageAt": "2026-05-18T08:59:30Z"
                ]
            ]
        ]))
        let decoded = try BridgeWorkspaceSummariesDecoder.decode(event: event)
        guard case .threadUpdated(let payload) = decoded else {
            XCTFail("expected threadUpdated, got \(String(describing: decoded))")
            return
        }
        XCTAssertEqual(payload.thread.chatId, "chat-42")
        XCTAssertEqual(payload.thread.status, "success")
        XCTAssertEqual(payload.thread.provider, "claude")
    }

    func testDecodeReturnsNilForNonSummaryChannel() throws {
        let event = try BridgeRunEvent.decode(eventRecordBytes: encodeEnvelope([
            "channel": "agent-output",
            "provider": "gemini",
            "publishedAt": "2026-05-18T09:00:00Z",
            "payload": ["text": "hello"]
        ]))
        let decoded = try BridgeWorkspaceSummariesDecoder.decode(event: event)
        XCTAssertNil(decoded, "non-summary channels should return nil so the subscriber can skip-with-one-branch")
    }

    func testDecodeThrowsOnMalformedSummaryPayload() throws {
        let event = try BridgeRunEvent.decode(eventRecordBytes: encodeEnvelope([
            "channel": "workspace-list",
            "provider": "system",
            "publishedAt": "2026-05-18T09:00:00Z",
            "payload": ["unexpected": "shape"]  // missing required "workspaces" array
        ]))
        XCTAssertThrowsError(try BridgeWorkspaceSummariesDecoder.decode(event: event))
    }

    func testDecodeAcceptsFractionalSecondsInDate() throws {
        let event = try BridgeRunEvent.decode(eventRecordBytes: encodeEnvelope([
            "channel": "workspace-updated",
            "provider": "system",
            "publishedAt": "2026-05-18T09:00:00.123Z",
            "payload": [
                "workspace": [
                    "workspaceId": "ws-1",
                    "displayName": "x",
                    "path": "/x",
                    "chatCount": 0,
                    "runningChatCount": 0,
                    "lastActivityAt": "2026-05-18T08:59:00.456Z"
                ]
            ]
        ]))
        let decoded = try BridgeWorkspaceSummariesDecoder.decode(event: event)
        guard case .workspaceUpdated(let payload) = decoded else {
            XCTFail("expected workspaceUpdated")
            return
        }
        XCTAssertNotNil(payload.workspace.lastActivityAt)
    }

    func testDecodeToleratesAdditionalUnknownPayloadFields() throws {
        // Forward-compatibility check — the Mac side may add fields later
        // and iOS must keep decoding the known ones.
        let event = try BridgeRunEvent.decode(eventRecordBytes: encodeEnvelope([
            "channel": "thread-updated",
            "provider": "system",
            "publishedAt": "2026-05-18T09:00:00Z",
            "payload": [
                "thread": [
                    "chatId": "chat-1",
                    "title": "x",
                    "workspaceId": "ws-1",
                    "provider": "gemini",
                    "status": "idle",
                    "futureField": "ignored"
                ],
                "extraEnvelopeField": 12345
            ]
        ]))
        let decoded = try BridgeWorkspaceSummariesDecoder.decode(event: event)
        guard case .threadUpdated(let payload) = decoded else {
            XCTFail("expected threadUpdated")
            return
        }
        XCTAssertEqual(payload.thread.chatId, "chat-1")
    }
}
