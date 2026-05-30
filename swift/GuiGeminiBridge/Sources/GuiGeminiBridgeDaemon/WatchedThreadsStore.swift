import Foundation
import BridgeCore

/// WatchedThreadsStore — per-pair subscription state for run-event
/// broadcast filtering.
///
/// When an iOS device opens a chat in its UI, it calls
/// `LANBridgeController.sendWatchedThreads(threadIDs:)` to declare what
/// it wants events for. The Mac side receives this via
/// `LANBridgeServer.Handlers.onWatchedThreads`, which (in `TransportListener`)
/// forwards into this store.
///
/// On every `broadcastRunEvent(payloadJSON:threadID:)`, the daemon calls
/// `pairsWatching(threadID:)` to compute the set of paired devices that
/// have explicitly opted in to seeing events for that thread. The
/// `LANBridgeServer.broadcast(envelope:toPairIDs:)` call uses that set
/// to scope the wire delivery.
///
/// **Backward-compat fallback**: when no pair has registered any watched
/// threads at all (e.g. no iOS clients connected, or all of them are at
/// the pair-screen with no chat open), `pairsWatching(...)` returns nil
/// to signal "no opinion — broadcast to all". This preserves the
/// existing "iOS sees everything" behavior for clients that haven't
/// adopted subscription declarations yet. The signal flips to filtered
/// the moment ANY pair sends a non-empty watched-threads set.
///
/// Memory shape: two maps for O(1) lookup either direction.
///   - `threadsByPair: [PairID: Set<String>]`: source of truth, populated
///     by `update(pairID:threadIDs:)`. Replaces (not merges) — iOS
///     sends the FULL current set every time it changes.
///   - `pairsByThread: [String: Set<PairID>]`: reverse index for fast
///     `pairsWatching(threadID:)` lookups. Kept in sync with the
///     source-of-truth map.
///
/// Lifecycle: the shared BridgeCore server still does not expose every
/// disconnect event to GUIGemini, so this store also records per-pair
/// `lastSeenAt` timestamps. The listener can prune very old subscriptions
/// opportunistically without requiring a BridgeCore API change.
public actor WatchedThreadsStore {
    public struct UpdateResult: Sendable, Equatable {
        public let pairID: PairID
        public let threadIDs: [String]
        public let previousThreadIDs: [String]
        public let changed: Bool
        public let isFirstSeen: Bool
        public let revision: UInt64
        public let lastSeenAt: Date
        public let pairsWithSubscriptions: Int
        public let seenPairCount: Int
        public let totalSubscriptions: Int
    }

    public struct Snapshot: Sendable, Equatable {
        public let pairsWithSubscriptions: Int
        public let seenPairCount: Int
        public let totalSubscriptions: Int
        public let lastSeenAt: Date?
        public let revision: UInt64
    }

    private var threadsByPair: [PairID: Set<String>] = [:]
    private var pairsByThread: [String: Set<PairID>] = [:]
    private var lastSeenByPair: [PairID: Date] = [:]
    private var revision: UInt64 = 0
    private let now: @Sendable () -> Date

    public init(now: @escaping @Sendable () -> Date = Date.init) {
        self.now = now
    }

    /// Replace the watched-thread set for a pair. The previous set is
    /// fully overwritten. Empty array means "no longer watching anything".
    @discardableResult
    public func update(pairID: PairID, threadIDs: [String]) -> UpdateResult {
        let seenAt = now()
        let nextSet = Set(threadIDs)
        let previous = threadsByPair[pairID] ?? []
        let wasSeen = lastSeenByPair[pairID] != nil
        let changed = previous != nextSet

        // Remove pair from threads it no longer watches.
        for stale in previous.subtracting(nextSet) {
            pairsByThread[stale]?.remove(pairID)
            if pairsByThread[stale]?.isEmpty == true {
                pairsByThread.removeValue(forKey: stale)
            }
        }
        // Add pair to threads it newly watches.
        for fresh in nextSet.subtracting(previous) {
            pairsByThread[fresh, default: []].insert(pairID)
        }

        if nextSet.isEmpty {
            threadsByPair.removeValue(forKey: pairID)
        } else {
            threadsByPair[pairID] = nextSet
        }
        lastSeenByPair[pairID] = seenAt
        revision &+= 1

        let snapshot = snapshotValues()
        return UpdateResult(
            pairID: pairID,
            threadIDs: nextSet.sorted(),
            previousThreadIDs: previous.sorted(),
            changed: changed,
            isFirstSeen: !wasSeen,
            revision: revision,
            lastSeenAt: seenAt,
            pairsWithSubscriptions: snapshot.pairsWithSubscriptions,
            seenPairCount: snapshot.seenPairCount,
            totalSubscriptions: snapshot.totalSubscriptions
        )
    }

    /// Drop ALL subscriptions for a pair. Used when the daemon learns
    /// a pair has disconnected (future wiring).
    public func remove(pairID: PairID) {
        let threads = threadsByPair.removeValue(forKey: pairID) ?? []
        for thread in threads {
            pairsByThread[thread]?.remove(pairID)
            if pairsByThread[thread]?.isEmpty == true {
                pairsByThread.removeValue(forKey: thread)
            }
        }
        guard lastSeenByPair.removeValue(forKey: pairID) != nil || !threads.isEmpty else { return }
        revision &+= 1
    }

    /// Drop subscriptions whose pair has not sent any watched-thread state
    /// since `cutoff`. This is intentionally opportunistic; active clients
    /// should refresh on reconnect/subscribe and restore their filters.
    @discardableResult
    public func removeStalePairs(lastSeenBefore cutoff: Date) -> Int {
        let stalePairs = lastSeenByPair.compactMap { pairID, lastSeenAt in
            lastSeenAt < cutoff ? pairID : nil
        }
        for pairID in stalePairs {
            remove(pairID: pairID)
        }
        return stalePairs.count
    }

    /// Returns the set of pairs that have explicitly opted in to events
    /// for `threadID`, or **nil** when no pair has registered any
    /// watched threads at all (broadcast-to-all backward-compat).
    ///
    /// The nil-vs-empty distinction matters:
    ///   - nil → no subscriber has spoken; treat events as global.
    ///   - empty set → at least one pair has subscriptions, but none
    ///     match this thread; deliver to nobody.
    public func pairsWatching(threadID: String) -> Set<PairID>? {
        if threadsByPair.isEmpty {
            return nil
        }
        return pairsByThread[threadID] ?? []
    }

    /// Diagnostic snapshot.
    public func snapshot() -> Snapshot {
        snapshotValues()
    }

    private func snapshotValues() -> Snapshot {
        let total = threadsByPair.values.reduce(0) { $0 + $1.count }
        let lastSeenAt = lastSeenByPair.values.max()
        return Snapshot(
            pairsWithSubscriptions: threadsByPair.count,
            seenPairCount: lastSeenByPair.count,
            totalSubscriptions: total,
            lastSeenAt: lastSeenAt,
            revision: revision
        )
    }
}
