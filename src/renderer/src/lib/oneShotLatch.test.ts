import { describe, expect, it, vi } from 'vitest'
import { createOneShotLatch } from './oneShotLatch'

describe('createOneShotLatch', () => {
  it('runs the first action and reports success', () => {
    const latch = createOneShotLatch()
    const fn = vi.fn()
    expect(latch.run(fn)).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('ignores every action after the first (double-click / answer+dismiss race)', () => {
    const latch = createOneShotLatch()
    const answer = vi.fn()
    const dismiss = vi.fn()
    expect(latch.run(answer)).toBe(true)
    // The racing dismiss (and any repeat answer) must be dropped.
    expect(latch.run(dismiss)).toBe(false)
    expect(latch.run(answer)).toBe(false)
    expect(answer).toHaveBeenCalledTimes(1)
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('reports used state', () => {
    const latch = createOneShotLatch()
    expect(latch.used()).toBe(false)
    latch.run(() => {})
    expect(latch.used()).toBe(true)
  })
})
