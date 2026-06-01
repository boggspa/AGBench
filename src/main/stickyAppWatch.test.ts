import { describe, expect, it } from 'vitest'
import {
  clearStickyAppWatch,
  getStickyAppWatch,
  MAX_STICKY_APPWATCH_SNAPSHOTS,
  normalizeStickyAppWatchStore,
  pruneStickyAppWatch,
  stashStickyAppWatch,
  type StickyAppWatchStore
} from './stickyAppWatch'

function meta(over: Partial<{ windowID: number; title: string; bundleID: string }> = {}) {
  return {
    windowID: over.windowID ?? 7,
    title: over.title ?? 'Untitled.fcpxml',
    bundleID: over.bundleID ?? 'com.apple.FinalCut',
    applicationName: 'Final Cut Pro',
    pid: 1234
  }
}

function stashInput(chatId: string, over: Record<string, unknown> = {}) {
  return {
    chatId,
    windowMeta: meta(),
    attachedAt: '2026-06-01T10:00:00.000Z',
    wasStreaming: false,
    stashedAt: '2026-06-01T10:05:00.000Z',
    ...over
  }
}

describe('stashStickyAppWatch', () => {
  it('stores a snapshot keyed by chatId', () => {
    const store = stashStickyAppWatch({}, stashInput('chat-1'))
    expect(getStickyAppWatch(store, 'chat-1')).toMatchObject({
      chatId: 'chat-1',
      wasStreaming: false,
      windowMeta: { applicationName: 'Final Cut Pro' }
    })
  })

  it('does not mutate the input store', () => {
    const original: StickyAppWatchStore = {}
    stashStickyAppWatch(original, stashInput('chat-1'))
    expect(original).toEqual({})
  })

  it('upserts (a second stash for the same chat replaces the first)', () => {
    let store = stashStickyAppWatch({}, stashInput('chat-1', { wasStreaming: false }))
    store = stashStickyAppWatch(store, stashInput('chat-1', { wasStreaming: true }))
    expect(Object.keys(store)).toHaveLength(1)
    expect(getStickyAppWatch(store, 'chat-1')?.wasStreaming).toBe(true)
  })

  it('rejects input with no chatId or no windowMeta', () => {
    expect(stashStickyAppWatch({}, stashInput(''))).toEqual({})
    // @ts-expect-error — exercising the runtime guard
    expect(stashStickyAppWatch({}, { chatId: 'c', windowMeta: null })).toEqual({})
  })

  it('LRU-prunes to the cap, dropping the oldest stashedAt', () => {
    let store: StickyAppWatchStore = {}
    for (let i = 0; i < MAX_STICKY_APPWATCH_SNAPSHOTS; i++) {
      const n = String(i).padStart(3, '0')
      store = stashStickyAppWatch(store, stashInput(`chat-${n}`, { stashedAt: `2026-06-01T10:00:00.${n}Z` }))
    }
    expect(Object.keys(store)).toHaveLength(MAX_STICKY_APPWATCH_SNAPSHOTS)
    // One more, newest — evicts the oldest (chat-000).
    store = stashStickyAppWatch(store, stashInput('chat-new', { stashedAt: '2026-06-01T11:00:00.000Z' }))
    expect(Object.keys(store)).toHaveLength(MAX_STICKY_APPWATCH_SNAPSHOTS)
    expect(getStickyAppWatch(store, 'chat-000')).toBeNull()
    expect(getStickyAppWatch(store, 'chat-new')).not.toBeNull()
  })
})

describe('clearStickyAppWatch', () => {
  it('removes a chat snapshot', () => {
    const store = stashStickyAppWatch({}, stashInput('chat-1'))
    expect(getStickyAppWatch(clearStickyAppWatch(store, 'chat-1'), 'chat-1')).toBeNull()
  })
  it('no-ops for an absent chat', () => {
    const store = stashStickyAppWatch({}, stashInput('chat-1'))
    expect(clearStickyAppWatch(store, 'nope')).toBe(store)
  })
})

describe('normalizeStickyAppWatchStore', () => {
  it('returns {} for junk', () => {
    expect(normalizeStickyAppWatchStore(null)).toEqual({})
    expect(normalizeStickyAppWatchStore('str')).toEqual({})
    expect(normalizeStickyAppWatchStore([1, 2])).toEqual({})
  })

  it('drops entries with no numeric windowID', () => {
    const raw = {
      good: {
        windowMeta: { windowID: 3, title: 't', bundleID: 'b', applicationName: 'A', pid: 1 },
        attachedAt: 'x',
        stashedAt: 'y',
        wasStreaming: true
      },
      bad: { windowMeta: { title: 'no id' } }
    }
    const out = normalizeStickyAppWatchStore(raw)
    expect(Object.keys(out)).toEqual(['good'])
    expect(out.good.wasStreaming).toBe(true)
  })

  it('fills missing string fields defensively', () => {
    const out = normalizeStickyAppWatchStore({
      c: { windowMeta: { windowID: 1 } }
    })
    expect(out.c.windowMeta).toMatchObject({ title: '', bundleID: '', applicationName: '', pid: 0 })
    expect(out.c.attachedAt).toBe('')
  })
})

describe('pruneStickyAppWatch', () => {
  it('returns the same reference when under the cap', () => {
    const store = stashStickyAppWatch({}, stashInput('chat-1'))
    expect(pruneStickyAppWatch(store)).toBe(store)
  })
})
