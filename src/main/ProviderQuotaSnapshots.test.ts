import { describe, expect, it } from 'vitest'
import {
  normalizeClaudeUsageSnapshot,
  normalizeCodexUsagePayload,
  normalizeKimiUsageSnapshot
} from './ProviderQuotaSnapshots'

describe('ProviderQuotaSnapshots', () => {
  it('preserves Codex aggregate and additional Spark windows', () => {
    const snapshot = normalizeCodexUsagePayload(
      {
        plan_type: 'pro',
        rate_limit: {
          primary_window: {
            used_percent: 10,
            limit_window_seconds: 18_000,
            reset_after_seconds: 3_600,
            reset_at: 1_893_456_000
          },
          secondary_window: {
            used_percent: 33,
            limit_window_seconds: 604_800,
            reset_after_seconds: 7_200,
            reset_at: 1_893_542_400
          }
        },
        additional_rate_limits: [
          {
            limit_name: 'GPT-5.3-Codex-Spark',
            rate_limit: {
              primary_window: {
                used_percent: 0,
                limit_window_seconds: 18_000,
                reset_after_seconds: 1_800,
                reset_at: 1_893_459_600
              },
              secondary_window: {
                used_percent: 1,
                limit_window_seconds: 604_800,
                reset_after_seconds: 86_400,
                reset_at: 1_893_628_800
              }
            }
          }
        ]
      },
      { accountId: 'account-1234567890', importedAt: '2026-05-26T00:00:00.000Z' }
    )

    expect(snapshot.windows?.map((windowEntry) => windowEntry.label)).toEqual([
      'Session',
      'Weekly',
      'GPT-5.3-Codex-Spark 5h',
      'GPT-5.3-Codex-Spark Weekly'
    ])
    expect(snapshot.windows?.[2].usedPercent).toBe(0)
    expect(snapshot.accountId).toBe('accoun...7890')
  })

  it('suppresses stale Codex aggregate windows when named limits have reset', () => {
    const snapshot = normalizeCodexUsagePayload({
      rate_limit: {
        secondary_window: {
          used_percent: 100,
          limit_window_seconds: 604_800,
          reset_after_seconds: 172_800,
          reset_at: 1_893_628_800
        }
      },
      additional_rate_limits: [
        {
          limit_name: 'GPT-5.5',
          rate_limit: {
            secondary_window: {
              used_percent: 0,
              limit_window_seconds: 604_800,
              reset_after_seconds: 604_800,
              reset_at: 1_894_060_800
            }
          }
        }
      ]
    })

    expect(snapshot.windows?.map((windowEntry) => windowEntry.label)).toEqual(['GPT-5.5 Weekly'])
  })

  it('renders Claude Sonnet utilization even without a reset timestamp', () => {
    const snapshot = normalizeClaudeUsageSnapshot(
      {
        five_hour: { utilization: 15, reset_at: '2026-05-26T04:39:00Z' },
        seven_day: { utilization: 97, reset_at: '2026-05-26T07:59:00Z' },
        seven_day_sonnet: { utilization: 3 }
      },
      { subscriptionType: 'max_5x' }
    )

    expect(snapshot.windows?.map((windowEntry) => windowEntry.label)).toEqual([
      'Session',
      'Weekly',
      'Sonnet'
    ])
    expect(snapshot.windows?.find((windowEntry) => windowEntry.label === 'Sonnet')).toMatchObject({
      usedPercent: 3,
      remainingPercent: 97,
      resetAt: undefined
    })
  })

  it('normalizes Kimi zero-usage 5H and Weekly windows as used percent', () => {
    const snapshot = normalizeKimiUsageSnapshot({
      usage: {
        limit: '2000',
        remaining: '2000',
        resetTime: '2026-05-26T21:56:00Z'
      },
      limits: [
        {
          window: {
            duration: 300,
            timeUnit: 'TIME_UNIT_MINUTE'
          },
          detail: {
            limit: '200',
            remaining: '200',
            resetTime: '2026-05-26T00:56:00Z'
          }
        }
      ]
    })

    expect(snapshot.windows?.map((windowEntry) => windowEntry.label)).toEqual(['5H', 'Weekly'])
    expect(snapshot.windows?.map((windowEntry) => windowEntry.usedPercent)).toEqual([0, 0])
    expect(snapshot.windows?.map((windowEntry) => windowEntry.remainingPercent)).toEqual([100, 100])
  })
})
