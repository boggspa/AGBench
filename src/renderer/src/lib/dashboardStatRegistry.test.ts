import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_STAT_REGISTRY,
  getDashboardStatResetAt,
  getDashboardStatsByGroup,
  isDashboardStatVisible
} from './dashboardStatRegistry'

// 1.0.5-EW49 — Registry + accessor helpers. Lightweight tests
// because the registry is data, not logic. We mainly verify the
// shape contract + the defensive-default behaviour of the
// visibility / reset accessors.
describe('DASHBOARD_STAT_REGISTRY', () => {
  it('contains the 12 stats we surface in the dense grid', () => {
    expect(DASHBOARD_STAT_REGISTRY).toHaveLength(12)
  })

  it('groups split into 4 semantic families with 3 stats each (calendar / duration / volume / spend)', () => {
    expect(getDashboardStatsByGroup('calendar')).toHaveLength(3)
    expect(getDashboardStatsByGroup('duration')).toHaveLength(3)
    expect(getDashboardStatsByGroup('volume')).toHaveLength(3)
    expect(getDashboardStatsByGroup('spend')).toHaveLength(3)
  })

  it('every entry has a unique key', () => {
    const keys = new Set(DASHBOARD_STAT_REGISTRY.map((stat) => stat.key))
    expect(keys.size).toBe(DASHBOARD_STAT_REGISTRY.length)
  })

  it('every entry has a non-empty label', () => {
    for (const stat of DASHBOARD_STAT_REGISTRY) {
      expect(stat.label.trim().length).toBeGreaterThan(0)
    }
  })

  it('Peak hour is the only stat with supportsReset=false (histogram derivation)', () => {
    const noReset = DASHBOARD_STAT_REGISTRY.filter((stat) => !stat.supportsReset)
    expect(noReset.map((stat) => stat.key)).toEqual(['peakHour'])
  })

  it('includes the three EW49 spend additions in canonical positions', () => {
    const spend = getDashboardStatsByGroup('spend').map((s) => s.key)
    expect(spend).toEqual(['totalCostUsd', 'avgSessionMs', 'tokensPerSession'])
  })
})

describe('isDashboardStatVisible', () => {
  it('defaults to true when no preference exists at all', () => {
    expect(isDashboardStatVisible(undefined, 'sessions')).toBe(true)
    expect(isDashboardStatVisible({}, 'sessions')).toBe(true)
  })

  it('defaults to true when the key is explicitly undefined in the map', () => {
    expect(isDashboardStatVisible({ sessions: undefined as unknown as boolean }, 'sessions')).toBe(
      true
    )
  })

  it('returns false ONLY when the key is explicitly set to false', () => {
    expect(isDashboardStatVisible({ sessions: false }, 'sessions')).toBe(false)
    expect(isDashboardStatVisible({ sessions: true }, 'sessions')).toBe(true)
  })

  it('a falsey-but-not-false value (null) is treated as "not explicitly hidden" → visible', () => {
    // The function uses `explicit !== false` — only literal false hides.
    expect(isDashboardStatVisible({ sessions: null as unknown as boolean }, 'sessions')).toBe(true)
  })
})

describe('getDashboardStatResetAt', () => {
  it('defaults to 0 (no reset) when no map exists', () => {
    expect(getDashboardStatResetAt(undefined, 'sessions')).toBe(0)
    expect(getDashboardStatResetAt({}, 'sessions')).toBe(0)
  })

  it('returns the stored cutoff when set', () => {
    expect(getDashboardStatResetAt({ sessions: 1_700_000_000_000 }, 'sessions')).toBe(
      1_700_000_000_000
    )
  })

  it('rejects non-positive / non-finite values defensively', () => {
    expect(getDashboardStatResetAt({ sessions: 0 }, 'sessions')).toBe(0)
    expect(getDashboardStatResetAt({ sessions: -100 }, 'sessions')).toBe(0)
    expect(
      getDashboardStatResetAt({ sessions: Number.NaN as unknown as number }, 'sessions')
    ).toBe(0)
  })
})
