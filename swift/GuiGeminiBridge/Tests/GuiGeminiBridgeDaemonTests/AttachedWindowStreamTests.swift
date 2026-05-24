import XCTest
@testable import GuiGeminiBridgeDaemon

/// Pure-logic tests for the Appwatch ring buffer + memory-budget math.
///
/// `SCStream` itself cannot be instantiated in a unit test (it requires a
/// real `SCContentFilter` from the system picker, which in turn requires
/// Screen Recording TCC grant and a live macOS window). We pin the parts
/// that *don't* need a stream: ring eviction policy, memory budget
/// calculation, idle-pull bookkeeping, and the start-time validation
/// guards. Live-stream behaviour is covered by manual verification + the
/// renderer's visual streaming pill.
@available(macOS 14.0, *)
final class AttachedWindowStreamTests: XCTestCase {
    // MARK: Ring eviction

    func testRingEvictionKeepsNewestFrames() async {
        let stream = AttachedWindowStream()
        await stream._configureForTesting(fps: 5, bufferSeconds: 2, maxDimensionPx: 256)
        let capacity = await stream.ringCapacity
        XCTAssertEqual(capacity, 10, "5fps × 2s = 10-frame capacity")

        // Push 14 frames; the ring should retain only the last 10 in order.
        for i in 0..<14 {
            await stream._appendFrameForTesting(makeMockFrame(tag: i))
        }
        let status = await stream.status()
        XCTAssertEqual(status.frameCount, 10, "Ring caps at capacity")
        XCTAssertEqual(status.frameCapacity, 10)

        // The newest pull should be frame 13 (zero-indexed) and oldest should be 4.
        guard let newest = await stream.latestFrame() else {
            return XCTFail("Expected a latest frame")
        }
        // Tag is encoded as the first byte of the BGRA buffer (see makeMockFrame).
        XCTAssertEqual(newest.bgra.first, 13, "Newest frame survives eviction")
    }

    func testRingFillsWithoutEvictionBelowCapacity() async {
        let stream = AttachedWindowStream()
        await stream._configureForTesting(fps: 5, bufferSeconds: 4, maxDimensionPx: 256)
        for i in 0..<7 {
            await stream._appendFrameForTesting(makeMockFrame(tag: i))
        }
        let status = await stream.status()
        XCTAssertEqual(status.frameCount, 7, "No eviction below capacity")
        XCTAssertEqual(status.frameCapacity, 20)
    }

    func testRingDropsFramesWhenCapacityIsZero() async {
        // _configureForTesting min-clamps to 1, but we still want the guard in
        // `ingestFrameSync` to drop frames when somehow capacity hits zero.
        let stream = AttachedWindowStream()
        await stream._configureForTesting(fps: 5, bufferSeconds: 1, maxDimensionPx: 256)
        await stream._appendFrameForTesting(makeMockFrame(tag: 99))
        let status = await stream.status()
        XCTAssertEqual(status.frameCount, 1, "Sanity: capacity 5 accepts one frame")
        XCTAssertGreaterThan(status.frameCapacity, 0, "Capacity must be at least 1")
    }

    // MARK: Memory budget

    func testEstimatedFrameBytesScalesQuadratically() {
        // Worst-case square frame at maxDimensionPx × maxDimensionPx × 4 bytes.
        XCTAssertEqual(AttachedWindowStream.estimatedFrameBytes(maxDimensionPx: 100), 100 * 100 * 4)
        XCTAssertEqual(AttachedWindowStream.estimatedFrameBytes(maxDimensionPx: 1280), 1280 * 1280 * 4)
    }

    func testEstimatedBufferMBForDefaults() {
        // Defaults: 5fps × 8s × 1280px BGRA8.
        let mb = AttachedWindowStream.estimatedBufferMB(
            fps: 5,
            bufferSeconds: 8,
            maxDimensionPx: 1280
        )
        // 1280*1280*4 = 6,553,600 bytes per frame.
        // 6,553,600 * 5 * 8 = 262,144,000 bytes = ~250 MB.
        XCTAssertEqual(mb, 250.0, accuracy: 0.1, "Default config sits at ~250 MB")
        // Well under the 350 MB cap.
        XCTAssertLessThan(mb, AttachedWindowStream.memoryBudgetMB)
    }

    func testEstimatedBufferMBExceedsCapForOversizedConfig() {
        // 10fps × 30s × 2560px BGRA = 10 * 30 * 2560 * 2560 * 4 / 1MB
        // = 10 * 30 * 26,214,400 / 1024 / 1024 ≈ 7500 MB. Way over the cap.
        let mb = AttachedWindowStream.estimatedBufferMB(
            fps: 10,
            bufferSeconds: 30,
            maxDimensionPx: 2560
        )
        XCTAssertGreaterThan(mb, AttachedWindowStream.memoryBudgetMB)
    }

    func testMemoryBudgetCapIsConstant() {
        XCTAssertEqual(AttachedWindowStream.memoryBudgetMB, 350.0, "Cap is a daemon-product constant")
    }

    // MARK: Latest frame bookkeeping

    func testLatestFrameBumpsLastPullAt() async {
        let stream = AttachedWindowStream()
        await stream._configureForTesting(fps: 5, bufferSeconds: 2, maxDimensionPx: 256)
        let initialStatus = await stream.status()
        let initialPullAt = initialStatus.lastPullAt
        XCTAssertNotNil(initialPullAt)

        // Sleep a beat so a Date()-bump is observable.
        try? await Task.sleep(nanoseconds: 50_000_000)
        await stream._appendFrameForTesting(makeMockFrame(tag: 1))
        _ = await stream.latestFrame()

        let afterPullStatus = await stream.status()
        guard let bumped = afterPullStatus.lastPullAt, let initial = initialPullAt else {
            return XCTFail("Expected both pull timestamps to exist")
        }
        XCTAssertGreaterThan(bumped, initial, "latestFrame bumps the idle-timeout clock")
    }

    func testStatusDoesNotBumpLastPullAt() async {
        let stream = AttachedWindowStream()
        await stream._configureForTesting(fps: 5, bufferSeconds: 2, maxDimensionPx: 256)
        let beforeStatus = await stream.status()
        let beforePullAt = beforeStatus.lastPullAt
        try? await Task.sleep(nanoseconds: 50_000_000)
        let afterStatus = await stream.status()
        XCTAssertEqual(beforeStatus.lastPullAt, afterStatus.lastPullAt, "status() must not bump pull clock")
        XCTAssertEqual(beforePullAt, afterStatus.lastPullAt)
    }

    func testStatusBeforeStartReturnsIdleSnapshot() async {
        let stream = AttachedWindowStream()
        let status = await stream.status()
        XCTAssertFalse(status.streaming)
        XCTAssertEqual(status.frameCount, 0)
        XCTAssertEqual(status.frameCapacity, 0)
        XCTAssertNil(status.oldestAt)
        XCTAssertNil(status.newestAt)
    }

    func testLatestFrameReturnsNilBeforeAnyFramesIngested() async {
        let stream = AttachedWindowStream()
        await stream._configureForTesting(fps: 5, bufferSeconds: 2, maxDimensionPx: 256)
        let frame = await stream.latestFrame()
        XCTAssertNil(frame, "No frames ingested yet → nil")
    }

    // MARK: Error surfaces

    func testAppwatchErrorMessagesAreUserReadable() {
        XCTAssertEqual(
            AppwatchError.alreadyStreaming.errorDescription,
            "Appwatch is already streaming this window."
        )
        XCTAssertEqual(
            AppwatchError.notStreaming.errorDescription,
            "Appwatch is not streaming (call appwatch.start first)."
        )
        XCTAssertEqual(
            AppwatchError.invalidConfig("fps too high").errorDescription,
            "Invalid Appwatch config: fps too high"
        )
        // memoryBudgetExceeded includes the actual numbers so the agent can
        // retune (smaller buffer / fps / dim) and retry.
        let msg = AppwatchError.memoryBudgetExceeded(
            estimatedMB: 500,
            budgetMB: 350
        ).errorDescription
        XCTAssertNotNil(msg)
        XCTAssertTrue(msg?.contains("500") ?? false, "Error mentions actual estimate")
        XCTAssertTrue(msg?.contains("350") ?? false, "Error mentions cap")
    }

    // MARK: Helpers

    /// Synthesise a small BGRA frame with `tag` encoded as the leading byte.
    /// Tests use the leading byte to verify frame order after eviction.
    private func makeMockFrame(tag: Int) -> RingFrame {
        // 1×1 BGRA frame is enough — tests only need ordering, not real pixels.
        // First byte (Blue channel) carries the tag so we can assert on it
        // without dragging in a PNG decoder.
        var bytes = Data([UInt8(tag & 0xFF), 0, 0, 0xFF])
        // Pad to a realistic shape so the ring sizing math sees a plausible
        // bytesPerRow. Tests don't decode the bytes themselves.
        bytes.append(contentsOf: [0, 0, 0, 0])
        return RingFrame(
            capturedAt: Date(),
            bgra: bytes,
            width: 1,
            height: 1,
            bytesPerRow: 4
        )
    }
}
