import { describe, expect, it } from 'vitest'
import { estimateLiveOutputTokensFromChars } from './LiveThreadTokenTally'

describe('estimateLiveOutputTokensFromChars', () => {
  it('approximates four streamed characters per token', () => {
    expect(estimateLiveOutputTokensFromChars(0)).toBe(0)
    expect(estimateLiveOutputTokensFromChars(1)).toBe(1)
    expect(estimateLiveOutputTokensFromChars(4)).toBe(1)
    expect(estimateLiveOutputTokensFromChars(5)).toBe(2)
  })

  it('ignores invalid or negative lengths', () => {
    expect(estimateLiveOutputTokensFromChars(-10)).toBe(0)
    expect(estimateLiveOutputTokensFromChars(Number.NaN)).toBe(0)
  })
})
