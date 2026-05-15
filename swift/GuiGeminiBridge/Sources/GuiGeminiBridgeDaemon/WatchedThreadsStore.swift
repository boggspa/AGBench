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
/// Lifecycle: an iOS device disconnecting (TCP closed) is the daemon's
/// signal to drop its subscriptions. Today's wiring doesn't propagate
/// the disconnect event, so stale entries linger until the pair sends
/// a fresh empty set or reconnects with new threads. Acceptable for
/// v1 — stale entries leak bandwidth (events sent to dead sessions
/// fail at the transport layer and get pruned automatically by
/// `LANBridgeServer.broadcast`).
public actor WatchedThreadsStore {
    private var threadsByPair: [PairID: Set<String>] = [:]
    private var pairsByThread: [String: Set<PairID>] = [:]

    public init() {}

    /// Replace the watched-thread set for a pair. The previous set is
    /// fully overwritten. Empty array means "no longer watching anything".
    public func update(pairID: PairID, threadIDs: [String]) {
        let nextSet = Set(threadIDs)
        let previous = threadsByPair[pairID] ?? []

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
    }

    /// Drop ALL subscriptions for a pair. Used when the daemon learns
    /// a pair has disconnected (future wiring).
    public func remove(pairID: PairID) {
        guard let threads = threadsByPair.removeValue(forKey: pairID) else { return }
        for thread in threads {
            pairsByThread[thread]?.remove(pairID)
            if pairsByThread[thread]?.isEmpty == true {
                pairsByThread.removeValue(forKey: thread)
            }
        }
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
    public func snapshot() -> (
        pairsWithSubscriptions: Int,
        totalSubscriptions: Int
    ) {
        let total = threadsByPair.values.reduce(0) { $0 + $1.count }
        return (threadsByPair.count, total)
    }
}
