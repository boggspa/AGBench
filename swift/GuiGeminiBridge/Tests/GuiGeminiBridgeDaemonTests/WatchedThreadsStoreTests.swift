import XCTest
import BridgeCore
@testable import GuiGeminiBridgeDaemon

final class WatchedThreadsStoreTests: XCTestCase {
    func testUpdateTracksLastSeenRevisionAndFiltering() async {
        let clock = TestClock(Date(timeIntervalSince1970: 1_700_000_000))
        let store = WatchedThreadsStore(now: clock.now)
        let pairID = PairID("pair-1")

        let first = await store.update(pairID: pairID, threadIDs: ["thread-1"])

        XCTAssertEqual(first.threadIDs, ["thread-1"])
        XCTAssertTrue(first.previousThreadIDs.isEmpty)
        XCTAssertTrue(first.changed)
        XCTAssertTrue(first.isFirstSeen)
        XCTAssertEqual(first.revision, 1)
        XCTAssertEqual(first.lastSeenAt, clock.current)
        XCTAssertEqual(first.pairsWithSubscriptions, 1)
        XCTAssertEqual(first.seenPairCount, 1)
        XCTAssertEqual(first.totalSubscriptions, 1)
        let firstWatchers = await store.pairsWatching(threadID: "thread-1")
        XCTAssertEqual(firstWatchers, Set([pairID]))

        clock.advance(by: 5)
        let second = await store.update(pairID: pairID, threadIDs: ["thread-2"])

        XCTAssertEqual(second.previousThreadIDs, ["thread-1"])
        XCTAssertEqual(second.threadIDs, ["thread-2"])
        XCTAssertTrue(second.changed)
        XCTAssertFalse(second.isFirstSeen)
        XCTAssertEqual(second.revision, 2)
        XCTAssertEqual(second.lastSeenAt, clock.current)
        let staleWatchers = await store.pairsWatching(threadID: "thread-1")
        let secondWatchers = await store.pairsWatching(threadID: "thread-2")
        XCTAssertEqual(staleWatchers, Set<PairID>())
        XCTAssertEqual(secondWatchers, Set([pairID]))
    }

    func testEmptyUpdateKeepsLastSeenButRestoresBroadcastFallback() async {
        let clock = TestClock(Date(timeIntervalSince1970: 1_700_000_000))
        let store = WatchedThreadsStore(now: clock.now)
        let pairID = PairID("pair-1")
        _ = await store.update(pairID: pairID, threadIDs: ["thread-1"])

        clock.advance(by: 10)
        let empty = await store.update(pairID: pairID, threadIDs: [])
        let snapshot = await store.snapshot()

        XCTAssertEqual(empty.threadIDs, [])
        XCTAssertTrue(empty.changed)
        XCTAssertFalse(empty.isFirstSeen)
        XCTAssertEqual(snapshot.pairsWithSubscriptions, 0)
        XCTAssertEqual(snapshot.seenPairCount, 1)
        XCTAssertEqual(snapshot.totalSubscriptions, 0)
        XCTAssertEqual(snapshot.lastSeenAt, clock.current)
        let watchers = await store.pairsWatching(threadID: "thread-1")
        XCTAssertNil(watchers)
    }

    func testStaleCleanupRemovesSubscriptionsAndLastSeen() async {
        let clock = TestClock(Date(timeIntervalSince1970: 1_700_000_000))
        let store = WatchedThreadsStore(now: clock.now)
        let oldPair = PairID("pair-old")
        let freshPair = PairID("pair-fresh")
        _ = await store.update(pairID: oldPair, threadIDs: ["thread-old"])

        clock.advance(by: 60)
        _ = await store.update(pairID: freshPair, threadIDs: ["thread-fresh"])

        let removed = await store.removeStalePairs(
            lastSeenBefore: Date(timeIntervalSince1970: 1_700_000_030)
        )
        let snapshot = await store.snapshot()

        XCTAssertEqual(removed, 1)
        XCTAssertEqual(snapshot.pairsWithSubscriptions, 1)
        XCTAssertEqual(snapshot.seenPairCount, 1)
        XCTAssertEqual(snapshot.totalSubscriptions, 1)
        let staleWatchers = await store.pairsWatching(threadID: "thread-old")
        let freshWatchers = await store.pairsWatching(threadID: "thread-fresh")
        XCTAssertEqual(staleWatchers, Set<PairID>())
        XCTAssertEqual(freshWatchers, Set([freshPair]))
    }
}

private final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Date

    init(_ value: Date) {
        self.value = value
    }

    var current: Date {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func now() -> Date {
        current
    }

    func advance(by seconds: TimeInterval) {
        lock.lock()
        value = value.addingTimeInterval(seconds)
        lock.unlock()
    }
}
