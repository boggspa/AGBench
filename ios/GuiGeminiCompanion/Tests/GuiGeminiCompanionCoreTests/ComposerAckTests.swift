import XCTest
import BridgeCore
@testable import GuiGeminiCompanionCore

final class ComposerAckTests: XCTestCase {
    func testExtractAppRunIdPrefersStructuredAckField() {
        let ack = BridgeActionAck(
            accepted: true,
            message: "Run dispatched; appRunId=legacy-run",
            appRunId: "structured-run"
        )

        XCTAssertEqual(ComposerViewModel.extractAppRunId(from: ack), "structured-run")
    }

    func testExtractAppRunIdReadsStructuredDataBag() {
        let ack = BridgeActionAck(
            accepted: true,
            message: "Run dispatched",
            data: ["appRunId": .string("data-run")]
        )

        XCTAssertEqual(ComposerViewModel.extractAppRunId(from: ack), "data-run")
    }

    func testExtractAppRunIdKeepsLegacyMessageFallback() {
        let ack = BridgeActionAck(
            accepted: true,
            message: "Run dispatched for workspace; appRunId=legacy-run"
        )

        XCTAssertEqual(ComposerViewModel.extractAppRunId(from: ack), "legacy-run")
    }
}
