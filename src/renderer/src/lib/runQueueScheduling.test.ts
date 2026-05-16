import { describe, expect, it, vi } from 'vitest'

import { findNextRunnableQueueIndex } from './runQueueScheduling'

describe('findNextRunnableQueueIndex', () => {
  it('returns -1 for an empty queue', () => {
    expect(findNextRunnableQueueIndex([], vi.fn())).toBe(-1)
  })

  it('returns the first job whose provider is not busy', () => {
    expect(
      findNextRunnableQueueIndex(
        [{ provider: 'gemini' }, { provider: 'codex' }, { provider: 'kimi' }],
        (provider) => provider === 'gemini'
      )
    ).toBe(1)
  })

  it('returns -1 when every provider is busy', () => {
    expect(
      findNextRunnableQueueIndex([{ provider: 'gemini' }, { provider: 'codex' }], () => true)
    ).toBe(-1)
  })
})
