import { describe, expect, it, vi } from 'vitest'

import { findNextRunnableQueueIndex } from './runQueueScheduling'

describe('findNextRunnableQueueIndex', () => {
  it('returns -1 for an empty queue', () => {
    expect(findNextRunnableQueueIndex([], vi.fn())).toBe(-1)
  })

  it('returns the first job that can dispatch right now', () => {
    // Generic `canDispatch(job)` predicate — callers pick whatever
    // busy axis they want (per-chat, per-provider, per-workspace).
    expect(
      findNextRunnableQueueIndex(
        [{ id: 'a', ready: false }, { id: 'b', ready: true }, { id: 'c', ready: true }],
        (job) => job.ready
      )
    ).toBe(1)
  })

  it('returns -1 when every job is blocked', () => {
    expect(
      findNextRunnableQueueIndex([{ id: 'a' }, { id: 'b' }], () => false)
    ).toBe(-1)
  })

  it('per-chat busy: parallel chats on same provider can both dispatch', () => {
    // The actual user-visible win: chat A and chat B both targeting
    // Codex, A's run is in flight, B's queued — B dispatches because
    // the chat-busy predicate is per-chat, not per-provider.
    const runningChats = new Set(['chat-A'])
    expect(
      findNextRunnableQueueIndex(
        [
          { chatId: 'chat-A', provider: 'codex' },
          { chatId: 'chat-B', provider: 'codex' }
        ],
        (job) => !runningChats.has(job.chatId)
      )
    ).toBe(1)
  })
})
