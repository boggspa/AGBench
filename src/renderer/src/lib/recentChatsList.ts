import type { ChatRecord } from '../../../main/store/types';

export interface SelectRecentChatsOptions {
  limit: number;
  excludeArchived?: boolean;
  excludePinned?: boolean;
}

/** Pure derivation used by the sidebar Recents section.
 *
 * Sorts by `updatedAt` descending — most recently active first. Ties
 * are broken by `appChatId` so the ordering is fully deterministic for
 * snapshot tests + stable React keys (no jitter when two chats share a
 * timestamp, which happens around bulk imports).
 *
 * `excludeArchived` and `excludePinned` default to `true` because the
 * sidebar surface always wants those filtered out — the Pinned section
 * renders pinned items separately and archived chats are hidden across
 * the whole sidebar. The flags exist so other callers can opt out. */
export function selectRecentChats(
  chats: ChatRecord[],
  options: SelectRecentChatsOptions,
): ChatRecord[] {
  const { limit, excludeArchived = true, excludePinned = true } = options;
  if (!Array.isArray(chats) || chats.length === 0 || limit <= 0) {
    return [];
  }

  const filtered = chats.filter((chat) => {
    if (excludeArchived && chat.archived) return false;
    if (excludePinned && chat.pinned) return false;
    return true;
  });

  const sorted = filtered.slice().sort((a, b) => {
    const aTime = Number.isFinite(a.updatedAt) ? a.updatedAt : 0;
    const bTime = Number.isFinite(b.updatedAt) ? b.updatedAt : 0;
    if (aTime !== bTime) return bTime - aTime;
    return String(a.appChatId).localeCompare(String(b.appChatId));
  });

  return sorted.slice(0, limit);
}
