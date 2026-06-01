/**
 * M11 (1.0.7) — sticky AppWatch attachment snapshots.
 *
 * AU (1.0.5 `d221558`) shipped conservative auto-detach: attach a window in
 * Chat A, switch to Chat B, and the attachment is released so B can't observe
 * A's stream. M11 adds the *remember* half: when a chat auto-detaches, we stash
 * a compact snapshot of WHAT it was watching, keyed by chat id, persisted so it
 * survives an app restart. When the user returns to that chat, the renderer can
 * offer a one-tap "Resume watching <app>".
 *
 * macOS constraint (important): the bridge daemon attaches via the interactive
 * `SCContentSharingPicker` and has NO reattach-by-windowID verb — macOS
 * requires a user gesture to grant a window. So "resume" re-opens the picker
 * (pre-targeted by the remembered app), it does NOT silently re-stream. The
 * snapshot is metadata for the affordance + restart survival, never a live
 * grant.
 *
 * This module is pure data logic (no Electron/daemon deps) so the
 * stash/prune/serialise rules are unit-testable.
 */

/** The remembered metadata for a chat's last AppWatch attachment. Mirrors the
 * subset of the live `AttachedWindowSnapshot` that's meaningful AFTER detach —
 * the `handleID` is intentionally dropped (it's a dead daemon grant once
 * detached; resuming must re-pick). */
export interface StickyAppWatchSnapshot {
  /** Chat that owned the attachment. */
  chatId: string
  windowMeta: {
    windowID: number
    title: string
    bundleID: string
    applicationName: string
    pid: number
  }
  /** When the attachment was originally created (ISO). */
  attachedAt: string
  /** When it was stashed on auto-detach (ISO) — drives LRU pruning. */
  stashedAt: string
  /** Whether OCR/streaming was active at detach time (restored as the
   * resume default). */
  wasStreaming: boolean
}

/** Hard cap on remembered chats so the store can't grow unbounded across a long
 * session. LRU by `stashedAt`. */
export const MAX_STICKY_APPWATCH_SNAPSHOTS = 50

export type StickyAppWatchStore = Record<string, StickyAppWatchSnapshot>

export interface StashInput {
  chatId: string
  windowMeta: StickyAppWatchSnapshot['windowMeta']
  attachedAt: string
  wasStreaming: boolean
  stashedAt: string
}

/**
 * Upsert a chat's stashed snapshot, then LRU-prune to the cap. Pure: returns a
 * NEW store object, never mutates the input. Rejects an input with no chatId or
 * no windowID (nothing meaningful to remember) by returning the store unchanged.
 */
export function stashStickyAppWatch(
  store: StickyAppWatchStore,
  input: StashInput
): StickyAppWatchStore {
  if (!input.chatId || !input.windowMeta || !(input.windowMeta.windowID >= 0)) {
    return store
  }
  const next: StickyAppWatchStore = {
    ...store,
    [input.chatId]: {
      chatId: input.chatId,
      windowMeta: input.windowMeta,
      attachedAt: input.attachedAt,
      stashedAt: input.stashedAt,
      wasStreaming: Boolean(input.wasStreaming)
    }
  }
  return pruneStickyAppWatch(next)
}

/** Remove a chat's stashed snapshot (e.g. the user explicitly detaches, or
 * resumes and re-attaches). Returns a new store; no-op if absent. */
export function clearStickyAppWatch(
  store: StickyAppWatchStore,
  chatId: string
): StickyAppWatchStore {
  if (!chatId || !(chatId in store)) return store
  const next = { ...store }
  delete next[chatId]
  return next
}

/** The remembered snapshot for a chat, or null. */
export function getStickyAppWatch(
  store: StickyAppWatchStore,
  chatId: string
): StickyAppWatchSnapshot | null {
  if (!chatId) return null
  return store[chatId] || null
}

/**
 * LRU-prune to MAX_STICKY_APPWATCH_SNAPSHOTS, dropping the oldest `stashedAt`
 * first. Pure. Returns the same reference when no pruning is needed.
 */
export function pruneStickyAppWatch(store: StickyAppWatchStore): StickyAppWatchStore {
  const entries = Object.values(store)
  if (entries.length <= MAX_STICKY_APPWATCH_SNAPSHOTS) return store
  const keep = entries
    .slice()
    .sort((a, b) => (a.stashedAt < b.stashedAt ? 1 : a.stashedAt > b.stashedAt ? -1 : 0))
    .slice(0, MAX_STICKY_APPWATCH_SNAPSHOTS)
  const next: StickyAppWatchStore = {}
  for (const snap of keep) next[snap.chatId] = snap
  return next
}

/**
 * Coerce arbitrary parsed JSON (from the persisted file) into a clean store,
 * dropping malformed entries. Defensive against hand-edited / corrupt data.
 */
export function normalizeStickyAppWatchStore(raw: unknown): StickyAppWatchStore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: StickyAppWatchStore = {}
  for (const [chatId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!chatId || !value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    const meta = v.windowMeta as Record<string, unknown> | undefined
    if (!meta || typeof meta.windowID !== 'number') continue
    out[chatId] = {
      chatId,
      windowMeta: {
        windowID: meta.windowID,
        title: typeof meta.title === 'string' ? meta.title : '',
        bundleID: typeof meta.bundleID === 'string' ? meta.bundleID : '',
        applicationName: typeof meta.applicationName === 'string' ? meta.applicationName : '',
        pid: typeof meta.pid === 'number' ? meta.pid : 0
      },
      attachedAt: typeof v.attachedAt === 'string' ? v.attachedAt : '',
      stashedAt: typeof v.stashedAt === 'string' ? v.stashedAt : '',
      wasStreaming: Boolean(v.wasStreaming)
    }
  }
  return pruneStickyAppWatch(out)
}
