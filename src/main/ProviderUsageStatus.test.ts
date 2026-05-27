import { describe, expect, it } from 'vitest'
import { bandForUsedPercent, summarizeProviderUsage } from './ProviderUsageStatus'
import type { NormalizedProviderUsageSnapshot } from './ProviderQuotaSnapshots'

function snapshot(overrides: Partial<NormalizedProviderUsageSnapshot> = {}): NormalizedProviderUsageSnapshot {
  return {
    provider: 'codex',
    source: 'codex-account',
    configured: true,
    fetchedAt: '2026-05-27T12:00:00.000Z',
    windows: [],
    ...overrides
  } as NormalizedProviderUsageSnapshot
}

describe('bandForUsedPercent', () => {
  it('maps to coarse bins', () => {
    expect(bandForUsedPercent(0)).toBe('low')
    expect(bandForUsedPercent(15)).toBe('low')
    expect(bandForUsedPercent(29.9)).toBe('low')
    expect(bandForUsedPercent(30)).toBe('medium')
    expect(bandForUsedPercent(50)).toBe('medium')
    expect(bandForUsedPercent(69.9)).toBe('medium')
    expect(bandForUsedPercent(70)).toBe('high')
    expect(bandForUsedPercent(89)).toBe('high')
    expect(bandForUsedPercent(90)).toBe('critical')
    expect(bandForUsedPercent(100)).toBe('critical')
  })

  it('returns "unknown" for undefined / NaN / negative', () => {
    expect(bandForUsedPercent(undefined)).toBe('unknown')
    expect(bandForUsedPercent(Number.NaN)).toBe('unknown')
    expect(bandForUsedPercent(-5)).toBe('unknown')
  })
})

describe('summarizeProviderUsage', () => {
  it('returns an unconfigured shell when snapshot is null/undefined', () => {
    expect(summarizeProviderUsage('codex', null)).toEqual({
      provider: 'codex',
      configured: false,
      source: null,
      stale: false,
      worstBand: 'unknown',
      windows: []
    })
  })

  it('summarises windows and clamps usedPercent to [0,100]', () => {
    const result = summarizeProviderUsage(
      'codex',
      snapshot({
        windows: [
          {
            id: '5h',
            label: '5h',
            runs: 0,
            totalTokens: 0,
            limitLabel: '',
            trackingOnly: false,
            usedPercent: 45
          },
          {
            id: 'weekly',
            label: 'Weekly',
            runs: 0,
            totalTokens: 0,
            limitLabel: '',
            trackingOnly: false,
            usedPercent: 150 // clamps to 100 → critical
          }
        ]
      })
    )
    expect(result.windows).toEqual([
      { id: '5h', label: '5h', band: 'medium', usedPercent: 45 },
      { id: 'weekly', label: 'Weekly', band: 'critical', usedPercent: 100 }
    ])
  })

  it('computes worstBand as the highest band across all windows', () => {
    const result = summarizeProviderUsage(
      'codex',
      snapshot({
        windows: [
          { id: 'a', label: 'A', runs: 0, totalTokens: 0, limitLabel: '', trackingOnly: false, usedPercent: 20 },
          { id: 'b', label: 'B', runs: 0, totalTokens: 0, limitLabel: '', trackingOnly: false, usedPercent: 92 },
          { id: 'c', label: 'C', runs: 0, totalTokens: 0, limitLabel: '', trackingOnly: false, usedPercent: 50 }
        ]
      })
    )
    expect(result.worstBand).toBe('critical')
  })

  it('preserves resetAt when present', () => {
    const result = summarizeProviderUsage(
      'gemini',
      snapshot({
        provider: 'gemini',
        windows: [
          {
            id: 'pro',
            label: 'Pro',
            runs: 0,
            totalTokens: 0,
            limitLabel: '',
            trackingOnly: false,
            usedPercent: 30,
            resetAt: '2026-05-28T00:00:00.000Z'
          }
        ]
      })
    )
    expect(result.windows[0].resetAt).toBe('2026-05-28T00:00:00.000Z')
  })

  it('propagates stale flag from the underlying snapshot', () => {
    const result = summarizeProviderUsage(
      'kimi',
      snapshot({ provider: 'kimi', stale: true })
    )
    expect(result.stale).toBe(true)
  })

  it('returns worstBand "unknown" when usedPercent is non-finite', () => {
    // Real-world: a window can land with usedPercent=NaN when the
    // provider's snapshot fetch failed to compute a percent (e.g.
    // a tracking-only window where no limit was discovered). The
    // type signature requires `number` but the runtime value can
    // still be NaN; `summarizeProviderUsage` should treat that as
    // "no signal".
    const result = summarizeProviderUsage(
      'claude',
      snapshot({
        provider: 'claude',
        windows: [
          {
            id: 'session',
            label: 'Session',
            runs: 0,
            totalTokens: 0,
            limitLabel: '',
            trackingOnly: false,
            usedPercent: Number.NaN
          }
        ]
      })
    )
    expect(result.worstBand).toBe('unknown')
    expect(result.windows[0].band).toBe('unknown')
  })
})
