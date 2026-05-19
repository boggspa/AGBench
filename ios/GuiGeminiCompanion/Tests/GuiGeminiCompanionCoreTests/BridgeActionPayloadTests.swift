import XCTest
@testable import GuiGeminiCompanionCore

final class BridgeActionPayloadTests: XCTestCase {
    // Decodes the JSON bytes back to a Foundation tree for assertion.
    private func parse(_ data: Data) -> [String: Any] {
        try! JSONSerialization.jsonObject(with: data) as! [String: Any]
    }

    func testApprovalReplyEncodingHasRequiredFields() throws {
        let action = BridgeActionPayload.approvalReply(
            workspaceId: "ws-1",
            threadId: "t-1",
            toolCallId: "tc-99",
            decision: .acceptForSession,
            message: "approved from iPhone"
        )
        let dict = parse(try action.encode())
        XCTAssertEqual(dict["kind"] as? String, "approvalReply")
        XCTAssertEqual(dict["workspaceId"] as? String, "ws-1")
        XCTAssertEqual(dict["threadId"] as? String, "t-1")
        XCTAssertEqual(dict["toolCallId"] as? String, "tc-99")
        XCTAssertEqual(dict["decision"] as? String, "acceptForSession")
        XCTAssertEqual(dict["message"] as? String, "approved from iPhone")
    }

    func testApprovalReplyOmitsOptionalMessage() throws {
        let action = BridgeActionPayload.approvalReply(
            workspaceId: "ws-1",
            threadId: "t-1",
            toolCallId: "tc-1",
            decision: .accept
        )
        let dict = parse(try action.encode())
        XCTAssertNil(dict["message"])
    }

    func testApprovalReplyAllFiveDecisions() throws {
        for decision in [
            BridgeActionPayload.ApprovalDecision.accept,
            .acceptForSession,
            .acceptForWorkspace,
            .decline,
            .cancel
        ] {
            let action = BridgeActionPayload.approvalReply(
                workspaceId: "w", threadId: "t", toolCallId: "tc", decision: decision
            )
            let dict = parse(try action.encode())
            XCTAssertEqual(dict["decision"] as? String, decision.rawValue)
        }
    }

    func testQuestionReplyEncoding() throws {
        let action = BridgeActionPayload.questionReply(
            workspaceId: "ws-1",
            threadId: "t-1",
            promptId: "q-1",
            answer: "the user's answer"
        )
        let dict = parse(try action.encode())
        XCTAssertEqual(dict["kind"] as? String, "questionReply")
        XCTAssertEqual(dict["promptId"] as? String, "q-1")
        XCTAssertEqual(dict["answer"] as? String, "the user's answer")
    }

    func testQuestionRejectEncoding() throws {
        let action = BridgeActionPayload.questionReject(
            workspaceId: "ws-1",
            threadId: "t-1",
            promptId: "q-1",
            message: "user said no"
        )
        let dict = parse(try action.encode())
        XCTAssertEqual(dict["kind"] as? String, "questionReject")
        XCTAssertEqual(dict["message"] as? String, "user said no")
    }

    func testComposerPromptRequiresProvider() throws {
        let action = BridgeActionPayload.composerPrompt(
            workspaceId: "ws-1",
            threadId: "t-1",
            text: "find the auth bug",
            provider: "gemini",
            approvalMode: "plan",
            model: "gemini-2.5-pro",
            contextTurns: 5
        )
        let dict = parse(try action.encode())
        XCTAssertEqual(dict["kind"] as? String, "composerPrompt")
        XCTAssertEqual(dict["provider"] as? String, "gemini")
        XCTAssertEqual(dict["approvalMode"] as? String, "plan")
        XCTAssertEqual(dict["model"] as? String, "gemini-2.5-pro")
        XCTAssertEqual(dict["contextTurns"] as? Int, 5)
    }

    func testComposerPromptOmitsUnsetOptionalFields() throws {
        let action = BridgeActionPayload.composerPrompt(
            workspaceId: "ws-1",
            threadId: "t-1",
            text: "hi",
            provider: "codex"
        )
        let dict = parse(try action.encode())
        XCTAssertNil(dict["approvalMode"])
        XCTAssertNil(dict["model"])
        XCTAssertNil(dict["contextTurns"])
    }

    func testCancelRunEncoding() throws {
        let action = BridgeActionPayload.cancelRun(
            workspaceId: "ws-1",
            threadId: "t-1",
            provider: "kimi",
            runId: "run-77",
            message: "user canceled from phone"
        )
        let dict = parse(try action.encode())
        XCTAssertEqual(dict["kind"] as? String, "cancelRun")
        XCTAssertEqual(dict["provider"] as? String, "kimi")
        XCTAssertEqual(dict["runId"] as? String, "run-77")
    }

    func testSetYoloModeEncoding() throws {
        let dict = parse(try BridgeActionPayload.setYoloMode(enabled: true).encode())
        XCTAssertEqual(dict["kind"] as? String, "setYoloMode")
        XCTAssertEqual(dict["enabled"] as? Bool, true)
    }

    func testTogglePinChatEncoding() throws {
        let dict = parse(try BridgeActionPayload.togglePinChat(
            workspaceId: "ws-1",
            appChatId: "chat-1",
            pinned: true
        ).encode())
        XCTAssertEqual(dict["kind"] as? String, "togglePinChat")
        XCTAssertEqual(dict["workspaceId"] as? String, "ws-1")
        XCTAssertEqual(dict["appChatId"] as? String, "chat-1")
        XCTAssertEqual(dict["pinned"] as? Bool, true)
    }

    func testTogglePinWorkspaceEncoding() throws {
        let dict = parse(try BridgeActionPayload.togglePinWorkspace(
            workspaceId: "ws-1",
            pinned: false
        ).encode())
        XCTAssertEqual(dict["kind"] as? String, "togglePinWorkspace")
        XCTAssertEqual(dict["workspaceId"] as? String, "ws-1")
        XCTAssertEqual(dict["pinned"] as? Bool, false)
    }

    func testRegisterApnsTokenEncoding() throws {
        let action = BridgeActionPayload.registerApnsToken(
            pairID: "pair-1",
            deviceToken: "abc123def456",
            env: .production
        )
        let dict = parse(try action.encode())
        XCTAssertEqual(dict["kind"] as? String, "registerApnsToken")
        XCTAssertEqual(dict["pairID"] as? String, "pair-1")
        XCTAssertEqual(dict["deviceToken"] as? String, "abc123def456")
        XCTAssertEqual(dict["env"] as? String, "production")
    }

    func testRegisterApnsTokenSupportsSandboxEnv() throws {
        let action = BridgeActionPayload.registerApnsToken(
            pairID: "pair-1",
            deviceToken: "tok",
            env: .sandbox
        )
        let dict = parse(try action.encode())
        XCTAssertEqual(dict["env"] as? String, "sandbox")
    }

    func testEncodingProducesSortedKeys() throws {
        // Sorted keys keep wire bytes deterministic for hashing / logging.
        let action = BridgeActionPayload.approvalReply(
            workspaceId: "w", threadId: "t", toolCallId: "tc", decision: .accept
        )
        let bytes = try action.encode()
        let text = String(data: bytes, encoding: .utf8)!
        // Sorted keys: decision < kind < threadId < toolCallId < workspaceId
        let decisionIdx = text.range(of: "\"decision\"")!.lowerBound
        let kindIdx = text.range(of: "\"kind\"")!.lowerBound
        XCTAssertLessThan(decisionIdx, kindIdx)
    }

    func testEncodingRoundTripsThroughElectronShape() throws {
        // The encoded bytes should be decodable back into a [String: Any]
        // matching `toJSONDictionary()`. Loose parity check against the
        // TS-side decoder's expectation.
        let action = BridgeActionPayload.cancelRun(
            workspaceId: "ws-1", threadId: "t-1", provider: "gemini", runId: "r"
        )
        let bytes = try action.encode()
        let decoded = parse(bytes)
        XCTAssertEqual(decoded["kind"] as? String, "cancelRun")
        let viaToDict = action.toJSONDictionary()
        XCTAssertEqual(decoded["workspaceId"] as? String, viaToDict["workspaceId"] as? String)
        XCTAssertEqual(decoded["runId"] as? String, viaToDict["runId"] as? String)
    }
}
