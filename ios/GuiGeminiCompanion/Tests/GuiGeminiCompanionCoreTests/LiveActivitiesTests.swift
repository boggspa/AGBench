import XCTest
import Foundation
import AGBenchRunActivityShared
@testable import GuiGeminiCompanionCore

final class LiveActivitiesTests: XCTestCase {
    func testActivityStateSerializationRoundTrips() throws {
        let attributes = AGBenchRunActivityAttributes(
            runId: "run-1",
            provider: "gemini",
            workspaceName: "GUIGemini",
            threadTitle: "Glass dashboard follow-up"
        )
        let state = AGBenchRunActivityAttributes.ContentState(
            status: .running,
            lastEventSummary: "Tool event: shell",
            toolCallsCount: 2,
            durationS: 42,
            pendingApprovalCount: 1
        )

        let encodedAttributes = try JSONEncoder().encode(attributes)
        let encodedState = try JSONEncoder().encode(state)

        XCTAssertEqual(try JSONDecoder().decode(AGBenchRunActivityAttributes.self, from: encodedAttributes), attributes)
        XCTAssertEqual(
            try JSONDecoder().decode(AGBenchRunActivityAttributes.ContentState.self, from: encodedState),
            state
        )
    }

    func testControllerStartsUpdatesAndEndsActivity() async {
        let backend = RecordingLiveActivityBackend()
        let controller = AGBenchLiveActivityController(
            authorization: StubLiveActivityAuthorization(enabled: true),
            backend: backend
        )
        let attributes = AGBenchRunActivityAttributes(
            runId: "run-1",
            provider: "gemini",
            workspaceName: "GUIGemini",
            threadTitle: "Run tests"
        )
        let running = AGBenchRunActivityAttributes.ContentState(status: .running, lastEventSummary: "Started")
        let updated = AGBenchRunActivityAttributes.ContentState(
            status: .running,
            lastEventSummary: "Tool event",
            toolCallsCount: 1,
            durationS: 5
        )
        let completed = AGBenchRunActivityAttributes.ContentState(
            status: .completed,
            lastEventSummary: "Done",
            toolCallsCount: 1,
            durationS: 8
        )

        await controller.start(attributes: attributes, state: running)
        await controller.update(runId: "run-1", state: updated)
        await controller.end(runId: "run-1", finalState: completed, dismissalPolicy: .after(120))

        let snapshot = await backend.snapshot()
        XCTAssertEqual(snapshot.starts.count, 1)
        XCTAssertEqual(snapshot.starts.first?.attributes, attributes)
        XCTAssertEqual(snapshot.updates.count, 1)
        XCTAssertEqual(snapshot.updates.first?.0, "run-1")
        XCTAssertEqual(snapshot.updates.first?.1, updated)
        XCTAssertEqual(snapshot.ends.count, 1)
        XCTAssertEqual(snapshot.ends.first?.runId, "run-1")
        XCTAssertEqual(snapshot.ends.first?.state.status, .completed)
        XCTAssertEqual(snapshot.ends.first?.policy, .after(120))
        let isTracking = await controller.isTracking(runId: "run-1")
        XCTAssertFalse(isTracking)
    }

    func testControllerNoopsWhenAuthorizationDisabled() async {
        let backend = RecordingLiveActivityBackend()
        let controller = AGBenchLiveActivityController(
            authorization: StubLiveActivityAuthorization(enabled: false),
            backend: backend
        )
        let state = AGBenchRunActivityAttributes.ContentState(status: .running)

        await controller.start(
            runId: "run-disabled",
            provider: "codex",
            workspaceName: "Workspace",
            threadTitle: "Thread"
        )
        await controller.update(runId: "run-disabled", state: state)
        await controller.end(runId: "run-disabled", finalState: state, dismissalPolicy: .immediate)

        let snapshot = await backend.snapshot()
        XCTAssertTrue(snapshot.starts.isEmpty)
        XCTAssertTrue(snapshot.updates.isEmpty)
        XCTAssertTrue(snapshot.ends.isEmpty)
        let isTracking = await controller.isTracking(runId: "run-disabled")
        XCTAssertFalse(isTracking)
    }

    func testReducerStartsUpdatesAndEndsRunFromBridgeEvents() {
        var reducer = AGBenchRunActivityEventReducer()

        let start = reducer.apply(event(
            channel: .agentOutput,
            provider: "gemini",
            payload: [
                "appRunId": "run-1",
                "appChatId": "thread-1",
                "workspacePath": "/tmp/GUIGemini",
                "data": jsonLine([
                    "type": "run_started",
                    "model": "gemini-pro"
                ])
            ],
            seconds: 0
        ))
        guard case .start(let attributes, let initialState) = start else {
            XCTFail("expected start, got \(String(describing: start))")
            return
        }
        XCTAssertEqual(attributes.runId, "run-1")
        XCTAssertEqual(attributes.provider, "gemini")
        XCTAssertEqual(attributes.workspaceName, "GUIGemini")
        XCTAssertEqual(attributes.threadTitle, "thread-1")
        XCTAssertEqual(initialState.status, .running)

        let tool = reducer.apply(event(
            channel: .agentOutput,
            provider: "gemini",
            payload: [
                "appRunId": "run-1",
                "appChatId": "thread-1",
                "data": jsonLine([
                    "type": "tool_use",
                    "id": "tool-1",
                    "name": "shell"
                ])
            ],
            seconds: 5
        ))
        guard case .update(let runId, let updatedState) = tool else {
            XCTFail("expected update, got \(String(describing: tool))")
            return
        }
        XCTAssertEqual(runId, "run-1")
        XCTAssertEqual(updatedState.toolCallsCount, 1)
        XCTAssertEqual(updatedState.durationS, 5)

        let finish = reducer.apply(event(
            channel: .agentExit,
            provider: "gemini",
            payload: [
                "appRunId": "run-1",
                "code": 0
            ],
            seconds: 9
        ))
        guard case .end(let endedRunId, let finalState, let dismissalPolicy) = finish else {
            XCTFail("expected end, got \(String(describing: finish))")
            return
        }
        XCTAssertEqual(endedRunId, "run-1")
        XCTAssertEqual(finalState.status, .completed)
        XCTAssertEqual(finalState.toolCallsCount, 1)
        XCTAssertEqual(finalState.durationS, 9)
        XCTAssertEqual(dismissalPolicy, .after(120))
    }

    func testReducerTracksApprovalPendingCountWhenApprovalEventsArrive() {
        var reducer = AGBenchRunActivityEventReducer()
        _ = reducer.apply(event(
            channel: .agentOutput,
            provider: "codex",
            payload: ["appRunId": "run-approval", "type": "run_started"]
        ))

        let approval = reducer.apply(event(
            channel: .agentOutput,
            provider: "codex",
            payload: [
                "appRunId": "run-approval",
                "type": "approval_request",
                "approvalId": "approval-1",
                "title": "Approval required"
            ],
            seconds: 1
        ))
        guard case .update(_, let approvalState) = approval else {
            XCTFail("expected approval update, got \(String(describing: approval))")
            return
        }
        XCTAssertEqual(approvalState.pendingApprovalCount, 1)

        let response = reducer.apply(event(
            channel: .agentOutput,
            provider: "codex",
            payload: [
                "appRunId": "run-approval",
                "type": "approval_response",
                "approvalId": "approval-1"
            ],
            seconds: 2
        ))
        guard case .update(_, let responseState) = response else {
            XCTFail("expected response update, got \(String(describing: response))")
            return
        }
        XCTAssertEqual(responseState.pendingApprovalCount, 0)
    }

    private func event(
        channel: BridgeRunEvent.Channel,
        provider: String,
        payload: [String: Any],
        seconds: TimeInterval = 0
    ) -> BridgeRunEvent {
        BridgeRunEvent(
            channel: channel,
            provider: provider,
            payloadJSON: try! JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
            publishedAt: Date(timeIntervalSince1970: 1_800_000_000 + seconds)
        )
    }

    private func jsonLine(_ payload: [String: Any]) -> String {
        let data = try! JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        return String(data: data, encoding: .utf8)! + "\n"
    }
}

private struct StubLiveActivityAuthorization: AGBenchLiveActivityAuthorizationProviding {
    let enabled: Bool

    func areLiveActivitiesEnabled() -> Bool {
        enabled
    }
}

private actor RecordingLiveActivityBackend: AGBenchLiveActivityBackend {
    struct Snapshot: Sendable {
        var starts: [(attributes: AGBenchRunActivityAttributes, state: AGBenchRunActivityAttributes.ContentState)]
        var updates: [(String, AGBenchRunActivityAttributes.ContentState)]
        var ends: [(runId: String, state: AGBenchRunActivityAttributes.ContentState, policy: AGBenchLiveActivityDismissalPolicy)]
    }

    private var starts: [(attributes: AGBenchRunActivityAttributes, state: AGBenchRunActivityAttributes.ContentState)] = []
    private var updates: [(String, AGBenchRunActivityAttributes.ContentState)] = []
    private var ends: [(runId: String, state: AGBenchRunActivityAttributes.ContentState, policy: AGBenchLiveActivityDismissalPolicy)] = []

    func start(
        attributes: AGBenchRunActivityAttributes,
        state: AGBenchRunActivityAttributes.ContentState
    ) async throws {
        starts.append((attributes, state))
    }

    func update(
        runId: String,
        state: AGBenchRunActivityAttributes.ContentState
    ) async {
        updates.append((runId, state))
    }

    func end(
        runId: String,
        finalState: AGBenchRunActivityAttributes.ContentState,
        dismissalPolicy: AGBenchLiveActivityDismissalPolicy
    ) async {
        ends.append((runId, finalState, dismissalPolicy))
    }

    func snapshot() -> Snapshot {
        Snapshot(starts: starts, updates: updates, ends: ends)
    }
}
