import { describe, expect, it } from 'vitest'

import {
  fingerprintUsageSummary,
  hasUsageSummaryChanged,
  shouldRunUsageRefresh
} from './usageRefresh'

describe('fingerprintUsageSummary', () => {
  it('produces equal fingerprints for structurally equal payloads', () => {
    const a = [
      {
        provider: 'gemini' as const,
        model: 'usage limits',
        windows: [
          {
            id: 'gemini-pro',
            label: 'Pro 3.1 (preview)',
            limitLabel: '42% remaining',
            resetAt: '2026-05-16T22:00:00.000Z',
            usedPercent: 58,
            remainingPercent: 42
          }
        ]
      }
    ]
    const b = [
      {
        provider: 'gemini' as const,
        model: 'usage limits',
        windows: [
          {
            id: 'gemini-pro',
            label: 'Pro 3.1 (preview)',
            limitLabel: '42% remaining',
            resetAt: '2026-05-16T22:00:00.000Z',
            usedPercent: 58,
            remainingPercent: 42
          }
        ]
      }
    ]
    expect(fingerprintUsageSummary(a)).toBe(fingerprintUsageSummary(b))
    expect(hasUsageSummaryChanged(a, b)).toBe(false)
  })

  it('detects meter changes via remainingPercent', () => {
    const prev = [
      {
        provider: 'claude' as const,
        model: 'usage limits',
        windows: [
          {
            id: 'claude-5h',
            label: 'Session',
            limitLabel: '70% remaining',
            usedPercent: 30,
            remainingPercent: 70
          }
        ]
      }
    ]
    const next = [
      {
        provider: 'claude' as const,
        model: 'usage limits',
        windows: [
          {
            id: 'claude-5h',
            label: 'Session',
            limitLabel: '65% remaining',
            usedPercent: 35,
            remainingPercent: 65
          }
        ]
      }
    ]
    expect(hasUsageSummaryChanged(prev, next)).toBe(true)
  })

  it('treats missing resetAt and undefined percent as a single canonical form', () => {
    const a = [
      {
        provider: 'kimi' as const,
        model: 'usage limits',
        windows: [{ id: 'kimi-5h', label: '5H', limitLabel: '100% remaining' }]
      }
    ]
    const b = [
      {
        provider: 'kimi' as const,
        model: 'usage limits',
        windows: [
          {
            id: 'kimi-5h',
            label: '5H',
            limitLabel: '100% remaining',
            resetAt: undefined,
            usedPercent: undefined,
            remainingPercent: undefined
          }
        ]
      }
    ]
    expect(hasUsageSummaryChanged(a, b)).toBe(false)
  })
})

describe('shouldRunUsageRefresh', () => {
  const base = {
    msSinceLastRefresh: 90_000,
    intervalMs: 90_000,
    inFlight: false,
    windowFocused: true,
    online: true
  }

  it('allows refresh on the standard heartbeat', () => {
    expect(shouldRunUsageRefresh(base)).toBe(true)
  })

  it('skips when a previous refresh is in flight', () => {
    expect(shouldRunUsageRefresh({ ...base, inFlight: true })).toBe(false)
  })

  it('skips when the window is not focused', () => {
    expect(shouldRunUsageRefresh({ ...base, windowFocused: false })).toBe(false)
  })

  it('skips when offline', () => {
    expect(shouldRunUsageRefresh({ ...base, online: false })).toBe(false)
  })

  it('allows initial refresh when no prior run is recorded', () => {
    expect(shouldRunUsageRefresh({ ...base, msSinceLastRefresh: null })).toBe(true)
  })

  it('debounces back-to-back fires (e.g. focus-resume right after a heartbeat)', () => {
    expect(shouldRunUsageRefresh({ ...base, msSinceLastRefresh: 500 })).toBe(false)
  })

  it('lets a focus-resume win after the debounce window passes', () => {
    expect(shouldRunUsageRefresh({ ...base, msSinceLastRefresh: 6_000 })).toBe(true)
  })
})
