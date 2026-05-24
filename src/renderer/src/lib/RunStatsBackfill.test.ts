import { describe, expect, it } from 'vitest'
import { shouldBackfillRunStats } from './RunStatsBackfill'

describe('RunStatsBackfill', () => {
  it('fills an empty run from meaningful exit stats', () => {
    expect(
      shouldBackfillRunStats(undefined, {
        input_tokens: 12,
        output_tokens: 4,
        total_tokens: 16
      })
    ).toBe(true)
  })

  it('does not overwrite richer run-finished stats', () => {
    expect(
      shouldBackfillRunStats(
        {
          input_tokens: 20,
          output_tokens: 6,
          total_tokens: 26
        },
        {
          input_tokens: 12,
          output_tokens: 4,
          total_tokens: 16
        }
      )
    ).toBe(false)
  })

  it('does not backfill from empty exit stats', () => {
    expect(shouldBackfillRunStats({}, {})).toBe(false)
  })
})
