import { describe, expect, it } from 'vitest'
import { applyStateAction, nextPerChatValues } from './usePerChatState'

describe('applyStateAction', () => {
  it('returns a plain value as-is', () => {
    expect(applyStateAction(5, 1)).toBe(5)
  })

  it('applies an updater function against the previous value', () => {
    expect(applyStateAction((prev: number) => prev + 1, 41)).toBe(42)
  })
})

describe('nextPerChatValues', () => {
  it('sets a value for a chat', () => {
    expect(nextPerChatValues({}, 'a', 1, 0)).toEqual({ a: 1 })
  })

  it('applies an updater against the current value (or initial when absent)', () => {
    expect(nextPerChatValues({ a: 2 }, 'a', (p: number) => p + 3, 0)).toEqual({ a: 5 })
    expect(nextPerChatValues({}, 'b', (p: number) => p + 3, 10)).toEqual({ b: 13 })
  })

  it('deletes the entry when reset to initial (keeps the map sparse)', () => {
    expect(nextPerChatValues({ a: 5, b: 2 }, 'a', 0, 0)).toEqual({ b: 2 })
  })

  it('returns the SAME object when resetting an absent chat to initial', () => {
    const prev = { a: 1 }
    expect(nextPerChatValues(prev, 'b', 0, 0)).toBe(prev)
  })

  it('returns the SAME object when the value is unchanged (lets React bail)', () => {
    const prev = { a: 5 }
    expect(nextPerChatValues(prev, 'a', 5, 0)).toBe(prev)
  })

  it('does not mutate the previous map when adding/deleting', () => {
    const prev = { a: 1 }
    nextPerChatValues(prev, 'b', 2, 0)
    expect(prev).toEqual({ a: 1 })
  })
})
