import Foundation

/// SidebarSubThreadIndex — pure derivation that buckets an array of
/// `iPadThreadSummary` rows into a parent → children index keyed by
/// `parentChatId`. Lifts the desktop's Sidebar.tsx logic:
///
/// ```ts
/// const subThreadsByParentId = useMemo(() => {
///   const grouped = new Map<string, ChatRecord[]>();
///   for (const chat of chats) {
///     if (!chat.parentChatId) continue;
///     ...
///   }
///   for (const bucket of grouped.values()) {
///     bucket.sort((a, b) => a.createdAt - b.createdAt);
///   }
///   return grouped;
/// }, [chats]);
/// ```
///
/// Output:
///   * `roots` — threads with no parent, sorted by the same rule the
///     existing sidebar uses (active first, then `lastActivityAt` desc).
///   * `children(of:)` — children of a given parent, sorted by
///     `lastActivityAt` ASC so the user sees branches in chronological
///     order under the parent.
///   * `branchCount(of:)` — convenience for the "branched · N" badge on
///     parent rows.
///
/// The index is built O(N) per call and the typical sidebar size is
/// bounded, so we rebuild on every relevant change rather than memoize.
/// Matches the desktop's `useMemo` ergonomics, which also recomputes on
/// every chat-array reference change.
public struct SidebarSubThreadIndex: Equatable, Sendable {
    public let roots: [iPadThreadSummary]
    public let childrenByParentId: [String: [iPadThreadSummary]]

    @MainActor
    public init(threads: [iPadThreadSummary]) {
        var roots: [iPadThreadSummary] = []
        var children: [String: [iPadThreadSummary]] = [:]
        let visibleThreadIds = Set(threads.map(\.id))
        for thread in threads {
            if let parentId = thread.parentChatId,
               !parentId.isEmpty,
               visibleThreadIds.contains(parentId) {
                children[parentId, default: []].append(thread)
            } else {
                roots.append(thread)
            }
        }
        // Sort each child bucket by lastActivityAt ASC — mirrors the
        // desktop's `createdAt` sort intent (chronological order under
        // the parent). lastActivityAt is the closest field we have on
        // iOS; if/when parents emit `createdAt` we can swap.
        for (key, bucket) in children {
            children[key] = bucket.sorted { lhs, rhs in
                if lhs.lastActivityAt == rhs.lastActivityAt {
                    return lhs.id < rhs.id
                }
                return lhs.lastActivityAt < rhs.lastActivityAt
            }
        }
        // Sort roots by the existing iPadSidebarStore policy (active
        // first, then lastActivityAt desc). Keeps active branches at the
        // top so the user lands on them.
        roots.sort { lhs, rhs in
            if lhs.isActive != rhs.isActive {
                return lhs.isActive && !rhs.isActive
            }
            if lhs.lastActivityAt == rhs.lastActivityAt {
                return lhs.id < rhs.id
            }
            return lhs.lastActivityAt > rhs.lastActivityAt
        }
        self.roots = roots
        self.childrenByParentId = children
    }

    /// Children of `parentId`, sorted chronologically (oldest first).
    public func children(of parentId: String) -> [iPadThreadSummary] {
        childrenByParentId[parentId] ?? []
    }

    /// "branched · N" badge count for a parent row.
    public func branchCount(of parentId: String) -> Int {
        childrenByParentId[parentId]?.count ?? 0
    }

    /// Flatten into the "parent immediately followed by children" order
    /// the sidebar renders. Each entry carries a depth flag so the row
    /// view can decide to indent + prefix with `↳`.
    public func flattenedRenderOrder() -> [SidebarRenderRow] {
        var result: [SidebarRenderRow] = []
        result.reserveCapacity(roots.count + childrenByParentId.values.reduce(0) { $0 + $1.count })
        for root in roots {
            let branchCount = self.branchCount(of: root.id)
            result.append(SidebarRenderRow(thread: root, depth: 0, branchCount: branchCount))
            for child in children(of: root.id) {
                result.append(SidebarRenderRow(thread: child, depth: 1, branchCount: 0))
            }
        }
        return result
    }
}

/// One row in the flattened parent-child render order. The `depth` field
/// is currently 0 (root) or 1 (child). v1 sub-thread depth max is 1
/// matching the desktop constraint; future revs can lift it.
public struct SidebarRenderRow: Identifiable, Equatable, Sendable {
    public var id: String { thread.id }
    public let thread: iPadThreadSummary
    public let depth: Int
    public let branchCount: Int

    public init(thread: iPadThreadSummary, depth: Int, branchCount: Int) {
        self.thread = thread
        self.depth = depth
        self.branchCount = branchCount
    }
}

// MARK: - parentChatId field on iPadThreadSummary
//
// Sub-thread support requires the iPad thread summary to carry the
// parent chat id when present. iPadThreadSummary is owned by Agent A's
// iPadShell.swift today, so we add the field via an extension stored
// alongside the index. The protocol payload (`ThreadSummaryPayload`)
// already grew a matching optional field — see BridgeWorkspaceSummaries+
// SubThread.swift in this same Models directory.

extension iPadThreadSummary {
    /// Parent chat id from the desktop's sub-thread topology. nil when
    /// this thread is a root (the common case today since most desktops
    /// haven't started broadcasting parentChatId yet). The field is
    /// surfaced via the `ThreadSummaryPayload` decoder when present.
    @MainActor
    public var parentChatId: String? {
        SidebarSubThreadAssociation.parentChatId(for: id)
    }
}

/// SidebarSubThreadAssociation — backing storage that maps a thread id
/// to its parent chat id AND a thread/workspace's pinned bit. We can't
/// add stored properties to the `iPadThreadSummary` /
/// `iPadWorkspaceSummary` structs via an extension (Swift limitation),
/// and we deliberately keep `iPadShell.swift` untouched on this slice
/// (cross-team coordination). Storage lives here as `@MainActor` static
/// dictionaries that the `iPadSidebarStore.applyThreadList(...)` etc.
/// write when their `ThreadSummaryPayload`s carry the optional fields.
///
/// Concurrency: writes happen on the main actor from the bridge summary
/// task in `AppState.connect(...)`. Reads also happen on the main actor
/// from the sidebar render. Since both ends are main-actor isolated,
/// the tables never need a lock.
@MainActor
public enum SidebarSubThreadAssociation {
    private static var parentByThreadId: [String: String] = [:]
    private static var pinnedThreadIds: Set<String> = []
    private static var pinnedWorkspaceIds: Set<String> = []

    /// Record a thread → parent association. Called by the bridge
    /// summary subscriber when a payload carries `parentChatId`.
    public static func recordParent(threadId: String, parentChatId: String?) {
        if let parent = parentChatId, !parent.isEmpty {
            parentByThreadId[threadId] = parent
        } else {
            parentByThreadId.removeValue(forKey: threadId)
        }
    }

    /// Read the association. Returns nil when the thread is a root.
    public static func parentChatId(for threadId: String) -> String? {
        parentByThreadId[threadId]
    }

    /// Mark a thread as pinned / unpinned. Called by the bridge summary
    /// subscriber when a payload carries an explicit `pinned` flag.
    public static func recordThreadPinned(threadId: String, pinned: Bool?) {
        guard let pinned else { return }
        if pinned {
            pinnedThreadIds.insert(threadId)
        } else {
            pinnedThreadIds.remove(threadId)
        }
    }

    /// True when the thread is currently pinned. Defaults to false when
    /// no `pinned` field has been seen for this id.
    public static func isThreadPinned(_ threadId: String) -> Bool {
        pinnedThreadIds.contains(threadId)
    }

    /// Same as `recordThreadPinned(...)` but for workspaces.
    public static func recordWorkspacePinned(workspaceId: String, pinned: Bool?) {
        guard let pinned else { return }
        if pinned {
            pinnedWorkspaceIds.insert(workspaceId)
        } else {
            pinnedWorkspaceIds.remove(workspaceId)
        }
    }

    /// True when the workspace is currently pinned.
    public static func isWorkspacePinned(_ workspaceId: String) -> Bool {
        pinnedWorkspaceIds.contains(workspaceId)
    }

    /// Reset all tables — used by unit tests and by `AppState.disconnect`.
    public static func reset() {
        parentByThreadId.removeAll()
        pinnedThreadIds.removeAll()
        pinnedWorkspaceIds.removeAll()
    }
}

// MARK: - Convenience accessors on summary types

extension iPadThreadSummary {
    /// True when the desktop has marked this thread as pinned via the
    /// bridge summary payload. See `SidebarSubThreadAssociation`.
    @MainActor
    public var isPinned: Bool {
        SidebarSubThreadAssociation.isThreadPinned(id)
    }
}

extension iPadWorkspaceSummary {
    /// True when the desktop has marked this workspace as pinned via the
    /// bridge summary payload. See `SidebarSubThreadAssociation`.
    @MainActor
    public var isPinned: Bool {
        SidebarSubThreadAssociation.isWorkspacePinned(id)
    }
}

/// SidebarRecentsSelector — pure derivation that returns the top-N
/// most-recently-updated non-archived threads, sorted by `lastActivityAt`
/// descending with deterministic tie-breaking on `id` (mirrors the
/// desktop's `selectRecentChats` selector in
/// `src/renderer/src/lib/recentChatsList.ts`).
///
/// "Archived" semantics: the iOS summary doesn't carry an archived bit
/// yet; for now we treat all summaries as non-archived. When the desktop
/// surfaces an `archived` field via the bridge payload this selector
/// will grow the filter; the cap-at-5 behavior + deterministic ordering
/// stay unchanged.
public enum SidebarRecentsSelector {
    /// Returns up to `limit` threads, sorted by `lastActivityAt` desc
    /// with ties broken by `id` ascending so the order is stable.
    /// `excludePinned` defaults to true to match the desktop selector —
    /// pinned chats render in the Pinned section instead.
    @MainActor
    public static func recentThreads(
        from threads: [iPadThreadSummary],
        limit: Int = 5,
        excludePinned: Bool = true
    ) -> [iPadThreadSummary] {
        guard limit > 0 else { return [] }
        let filtered = excludePinned
            ? threads.filter { !$0.isPinned }
            : threads
        let sorted = filtered.sorted { lhs, rhs in
            if lhs.lastActivityAt == rhs.lastActivityAt {
                return lhs.id < rhs.id
            }
            return lhs.lastActivityAt > rhs.lastActivityAt
        }
        return Array(sorted.prefix(limit))
    }
}
