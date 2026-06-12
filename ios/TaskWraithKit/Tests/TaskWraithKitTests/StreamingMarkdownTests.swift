import Testing

@testable import TaskWraithKit

@Suite("StreamingMarkdownSplitter")
struct StreamingMarkdownSplitterTests {
    @Test func emptyTextSplitsEmpty() {
        let split = StreamingMarkdownSplitter.split("")
        #expect(split.settled == "")
        #expect(split.tail == "")
    }

    @Test func singleGrowingParagraphIsAllTail() {
        let split = StreamingMarkdownSplitter.split("Streaming **bold but unfin")
        #expect(split.settled == "")
        #expect(split.tail == "Streaming **bold but unfin")
    }

    @Test func completedParagraphSettles() {
        let split = StreamingMarkdownSplitter.split("First paragraph.\n\nSecond grow")
        #expect(split.settled == "First paragraph.\n\n")
        #expect(split.tail == "Second grow")
    }

    @Test func textEndingWithBlankLineIsFullySettled() {
        let split = StreamingMarkdownSplitter.split("Done paragraph.\n\n")
        #expect(split.settled == "Done paragraph.\n\n")
        #expect(split.tail == "")
    }

    @Test func blankLinesInsideOpenFenceDoNotSettle() {
        let text = "Intro.\n\n```swift\nlet a = 1\n\nlet b = 2\n"
        let split = StreamingMarkdownSplitter.split(text)
        // The fence is still open — the only safe boundary is before it.
        #expect(split.settled == "Intro.\n\n")
        #expect(split.tail == "```swift\nlet a = 1\n\nlet b = 2\n")
    }

    @Test func closedFenceSettlesAfterFollowingBlankLine() {
        let text = "Intro.\n\n```\ncode\n```\n\nOutro grow"
        let split = StreamingMarkdownSplitter.split(text)
        #expect(split.settled == "Intro.\n\n```\ncode\n```\n\n")
        #expect(split.tail == "Outro grow")
    }

    @Test func listsStayInTailUntilBlankLine() {
        let text = "Plan:\n\n- one\n- two\n- thr"
        let split = StreamingMarkdownSplitter.split(text)
        #expect(split.settled == "Plan:\n\n")
        #expect(split.tail == "- one\n- two\n- thr")
    }
}

@Suite("StreamingInterleave")
struct StreamingInterleaveTests {
    typealias E = StreamingInterleave.Element

    @Test func noToolsIsJustTheTail() {
        let plan = StreamingInterleave.plan(segments: ["hello"], toolCounts: [])
        #expect(plan == [.text(segmentIndex: 0, isTail: true)])
    }

    @Test func textToolTextInterleaves() {
        let plan = StreamingInterleave.plan(segments: ["before", "after"], toolCounts: [1])
        #expect(
            plan == [
                .text(segmentIndex: 0, isTail: false),
                .toolRow(index: 0),
                .text(segmentIndex: 1, isTail: true)
            ])
    }

    @Test func groupedRowConsumesItsEmptySegments() {
        // Mac collapsed 3 back-to-back calls into one row; the stream sealed
        // empty segments between them.
        let plan = StreamingInterleave.plan(
            segments: ["intro", "", "", "outro"], toolCounts: [3])
        #expect(
            plan == [
                .text(segmentIndex: 0, isTail: false),
                .toolRow(index: 0),
                .text(segmentIndex: 3, isTail: true)
            ])
    }

    @Test func separateRowsWithEmptyBetween() {
        let plan = StreamingInterleave.plan(segments: ["a", "", "c"], toolCounts: [1, 1])
        #expect(
            plan == [
                .text(segmentIndex: 0, isTail: false),
                .toolRow(index: 0),
                .toolRow(index: 1),
                .text(segmentIndex: 2, isTail: true)
            ])
    }

    @Test func snapshotLagFlushesTrailingSegments() {
        // Stream is two tools ahead of the (debounced) snapshot.
        let plan = StreamingInterleave.plan(segments: ["a", "b", "c"], toolCounts: [1])
        #expect(
            plan == [
                .text(segmentIndex: 0, isTail: false),
                .toolRow(index: 0),
                .text(segmentIndex: 1, isTail: false),
                .text(segmentIndex: 2, isTail: true)
            ])
    }

    @Test func groupedTextSurvivesDefensiveSkip() {
        // The Mac says one row covers 2 calls but the stream put REAL text
        // between them — never drop it.
        let plan = StreamingInterleave.plan(segments: ["a", "mid", "c"], toolCounts: [2])
        #expect(
            plan == [
                .text(segmentIndex: 0, isTail: false),
                .toolRow(index: 0),
                .text(segmentIndex: 1, isTail: false),
                .text(segmentIndex: 2, isTail: true)
            ])
    }

    @Test func moreClaimedToolsThanBoundariesFallsBackToLegacyOrder() {
        // Attached mid-run (or a provider without tool markers): rows first,
        // then the live text — exactly the pre-segmentation behavior.
        let plan = StreamingInterleave.plan(segments: ["tail only"], toolCounts: [1, 2])
        #expect(
            plan == [
                .toolRow(index: 0),
                .toolRow(index: 1),
                .text(segmentIndex: 0, isTail: true)
            ])
    }

    @Test func emptyTailAfterFreshBoundaryRendersNothingExtra() {
        // Tool just sealed the segment; no text has streamed since.
        let plan = StreamingInterleave.plan(segments: ["before", ""], toolCounts: [1])
        #expect(
            plan == [
                .text(segmentIndex: 0, isTail: false),
                .toolRow(index: 0)
            ])
    }
}
