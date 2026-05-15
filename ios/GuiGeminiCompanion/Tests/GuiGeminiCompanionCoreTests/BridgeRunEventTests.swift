import XCTest
@testable import GuiGeminiCompanionCore

final class BridgeRunEventTests: XCTestCase {
    private func encode(_ object: [String: Any]) -> Data {
        try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    func testDecodesAgentOutputEvent() throws {
        let bytes = encode([
            "channel": "agent-output",
            "provider": "gemini",
            "payload": ["text": "hello world", "appRunId": "run-1"],
            "publishedAt": "2026-05-15T12:00:00Z"
        ])
        let event = try BridgeRunEvent.decode(eventRecordBytes: bytes)
        XCTAssertEqual(event.channel, .agentOutput)
        XCTAssertEqual(event.provider, "gemini")
        // The payload subtree is preserved.
        let payload = event.payloadDictionary()
        XCTAssertEqual(payload?["text"] as? String, "hello world")
        XCTAssertEqual(payload?["appRunId"] as? String, "run-1")
    }

    func testDecodesAllSixChannels() throws {
        let channels = [
            ("agent-output", BridgeRunEvent.Channel.agentOutput),
            ("agent-error", BridgeRunEvent.Channel.agentError),
            ("agent-exit", BridgeRunEvent.Channel.agentExit),
            ("gemini-output", BridgeRunEvent.Channel.geminiOutput),
            ("gemini-error", BridgeRunEvent.Channel.geminiError),
            ("gemini-exit", BridgeRunEvent.Channel.geminiExit)
        ]
        for (channelString, expected) in channels {
            let bytes = encode([
                "channel": channelString,
                "provider": "codex",
                "payload": NSNull(),
                "publishedAt": "2026-05-15T12:00:00Z"
            ])
            let event = try BridgeRunEvent.decode(eventRecordBytes: bytes)
            XCTAssertEqual(event.channel, expected)
        }
    }

    func testRejectsUnknownChannel() {
        let bytes = encode([
            "channel": "agent-newkind",
            "provider": "codex",
            "payload": NSNull(),
            "publishedAt": "2026-05-15T12:00:00Z"
        ])
        do {
            _ = try BridgeRunEvent.decode(eventRecordBytes: bytes)
            XCTFail("expected unknownChannel error")
        } catch BridgeRunEventDecodeError.unknownChannel(let s) {
            XCTAssertEqual(s, "agent-newkind")
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testRejectsMalformedJSON() {
        let bytes = Data("not valid json {".utf8)
        XCTAssertThrowsError(try BridgeRunEvent.decode(eventRecordBytes: bytes)) { error in
            guard case BridgeRunEventDecodeError.malformedJSON = error else {
                XCTFail("expected malformedJSON, got \(error)")
                return
            }
        }
    }

    func testRejectsMissingChannel() {
        let bytes = encode([
            "provider": "codex",
            "payload": NSNull(),
            "publishedAt": "2026-05-15T12:00:00Z"
        ])
        XCTAssertThrowsError(try BridgeRunEvent.decode(eventRecordBytes: bytes)) { error in
            guard case BridgeRunEventDecodeError.missingField(let f) = error, f == "channel" else {
                XCTFail("expected missingField('channel'), got \(error)")
                return
            }
        }
    }

    func testRejectsMissingProvider() {
        let bytes = encode([
            "channel": "agent-output",
            "payload": NSNull(),
            "publishedAt": "2026-05-15T12:00:00Z"
        ])
        XCTAssertThrowsError(try BridgeRunEvent.decode(eventRecordBytes: bytes)) { error in
            guard case BridgeRunEventDecodeError.missingField(let f) = error, f == "provider" else {
                XCTFail("expected missingField('provider'), got \(error)")
                return
            }
        }
    }

    func testRejectsInvalidDate() {
        let bytes = encode([
            "channel": "agent-output",
            "provider": "codex",
            "payload": NSNull(),
            "publishedAt": "not-a-date"
        ])
        XCTAssertThrowsError(try BridgeRunEvent.decode(eventRecordBytes: bytes)) { error in
            guard case BridgeRunEventDecodeError.invalidDate = error else {
                XCTFail("expected invalidDate, got \(error)")
                return
            }
        }
    }

    func testDecodesPayloadWithNoFractionalSecondsTimestamp() throws {
        let bytes = encode([
            "channel": "agent-exit",
            "provider": "codex",
            "payload": ["code": 0],
            "publishedAt": "2026-05-15T12:00:00Z"
        ])
        let event = try BridgeRunEvent.decode(eventRecordBytes: bytes)
        XCTAssertEqual(event.channel, .agentExit)
    }

    func testTreatsNullPayloadAsNullJSON() throws {
        let bytes = encode([
            "channel": "agent-exit",
            "provider": "codex",
            "payload": NSNull(),
            "publishedAt": "2026-05-15T12:00:00Z"
        ])
        let event = try BridgeRunEvent.decode(eventRecordBytes: bytes)
        XCTAssertNil(event.payloadDictionary())
    }
}
