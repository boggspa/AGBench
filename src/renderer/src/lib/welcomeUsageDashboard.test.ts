import { describe, expect, it } from 'vitest'

import type { UsageRecord } from '../../../main/store/types'

import {
  HEATMAP_DAY_COUNT,
  HEATMAP_HOUR_COUNT,
  buildWelcomeUsageDashboardData,
  mixProviderColors
} from './welcomeUsageDashboard'

const baseRecord = (overrides: Partial<UsageRecord>): UsageRecord => ({
  id: 'rec',
  provider: 'codex',
  timestamp: 0,
  workspaceId: 'ws-1',
  chatId: 'chat-1',
  runId: 'run-1',
  model: 'gpt-5-codex',
  inputTokens: 100,
  outputTokens: 200,
  totalTokens: 300,
  durationMs: 1000,
  usageKind: 'run',
  ...overrides
})

describe('buildWelcomeUsageDashboardData hourly grid', () => {
  it('emits HEATMAP_DAY_COUNT × HEATMAP_HOUR_COUNT cells anchored on the current hour', () => {
    const now = new Date(2026, 4, 15, 14, 30).getTime()
    const data = buildWelcomeUsageDashboardData([], [], 'all', now)
    expect(data.hourlyHeatmap).toHaveLength(HEATMAP_DAY_COUNT * HEATMAP_HOUR_COUNT)
    const last = data.hourlyHeatmap[data.hourlyHeatmap.length - 1]
    expect(last.isCurrentHour).toBe(true)
    expect(last.hour).toBe(14)
    // Cells are chronological; the first is the oldest.
    const first = data.hourlyHeatmap[0]
    const expectedStart =
      new Date(2026, 4, 15, 14).getTime() -
      (HEATMAP_DAY_COUNT * HEATMAP_HOUR_COUNT - 1) * 60 * 60 * 1000
    const firstDate = new Date(expectedStart)
    expect(first.hour).toBe(firstDate.getHours())
  })

  it('buckets usage tokens by local hour and tracks provider totals', () => {
    const now = new Date(2026, 4, 15, 14, 0).getTime()
    const sameHour = new Date(2026, 4, 15, 12, 25).getTime()
    const records: UsageRecord[] = [
      baseRecord({ id: 'a', timestamp: sameHour, provider: 'codex', totalTokens: 200 }),
      baseRecord({ id: 'b', timestamp: sameHour + 60_000, provider: 'gemini', totalTokens: 400 })
    ]
    const data = buildWelcomeUsageDashboardData(records, [], 'all', now)
    const hourCell = data.hourlyHeatmap.find(
      (cell) => cell.hour === 12 && cell.dayKey === '2026-05-15'
    )
    expect(hourCell).toBeDefined()
    expect(hourCell!.totalTokens).toBe(600)
    expect(hourCell!.providerTotals.codex).toBe(200)
    expect(hourCell!.providerTotals.gemini).toBe(400)
    expect(hourCell!.providerTotals.claude).toBe(0)
    expect(hourCell!.providerTotals.kimi).toBe(0)
    expect(hourCell!.level).toBeGreaterThanOrEqual(1)
    expect(hourCell!.level).toBeLessThanOrEqual(4)
  })

  it('scales level intensity 0..4 by hourly maximum', () => {
    const now = new Date(2026, 4, 15, 14, 0).getTime()
    const records: UsageRecord[] = [
      baseRecord({ id: 'low', timestamp: new Date(2026, 4, 15, 10, 0).getTime(), totalTokens: 10 }),
      baseRecord({
        id: 'high',
        timestamp: new Date(2026, 4, 15, 11, 0).getTime(),
        totalTokens: 4000
      })
    ]
    const data = buildWelcomeUsageDashboardData(records, [], 'all', now)
    const lowCell = data.hourlyHeatmap.find(
      (cell) => cell.hour === 10 && cell.dayKey === '2026-05-15'
    )
    const highCell = data.hourlyHeatmap.find(
      (cell) => cell.hour === 11 && cell.dayKey === '2026-05-15'
    )
    expect(lowCell!.level).toBe(1)
    expect(highCell!.level).toBe(4)
  })

  it('treats usage records without explicit token counts as a single unit', () => {
    const now = new Date(2026, 4, 15, 14, 0).getTime()
    const record = baseRecord({
      id: 'no-tokens',
      timestamp: new Date(2026, 4, 15, 9, 30).getTime(),
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      provider: 'claude'
    })
    const data = buildWelcomeUsageDashboardData([record], [], 'all', now)
    const cell = data.hourlyHeatmap.find((c) => c.hour === 9 && c.dayKey === '2026-05-15')
    expect(cell!.totalTokens).toBe(1)
    expect(cell!.providerTotals.claude).toBe(1)
  })
})

describe('buildWelcomeUsageDashboardData model breakdown — range scoping (Welcome L4)', () => {
  // Anchor "now" so cutoff math is deterministic.
  const NOW = new Date(2026, 4, 22, 12, 0).getTime() // 2026-05-22 12:00 local
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR

  it('computes model percentages against the selected range, not the lifetime aggregate', () => {
    // Two records: gpt-5-codex 90 days ago (200k tokens), gemini-flash today (50k tokens).
    // Under `'all'` the older gpt entry dominates the percentages.
    // Under `'7d'` only the gemini entry survives the cutoff and the
    // breakdown becomes single-model 100%.
    const records: UsageRecord[] = [
      baseRecord({
        id: 'old-codex',
        timestamp: NOW - 90 * DAY,
        provider: 'codex',
        model: 'gpt-5-codex',
        inputTokens: 100_000,
        outputTokens: 100_000,
        totalTokens: 200_000
      }),
      baseRecord({
        id: 'recent-gemini',
        timestamp: NOW - 30 * 60_000, // 30 minutes ago
        provider: 'gemini',
        model: 'gemini-3-flash-preview',
        inputTokens: 30_000,
        outputTokens: 20_000,
        totalTokens: 50_000
      })
    ]

    const allData = buildWelcomeUsageDashboardData(records, [], 'all', NOW)
    expect(allData.modelBreakdown).toHaveLength(2)
    // Older codex entry has 4x tokens → larger percent share under lifetime.
    const codexAll = allData.modelBreakdown.find((m) => m.model === 'gpt-5-codex')
    const geminiAll = allData.modelBreakdown.find((m) => m.model === 'gemini-3-flash-preview')
    expect(codexAll!.percent).toBeGreaterThan(geminiAll!.percent)
    // Sum of percents is ~100.
    expect(codexAll!.percent + geminiAll!.percent).toBeCloseTo(100, 0)

    const dayData = buildWelcomeUsageDashboardData(records, [], '24h', NOW)
    expect(dayData.modelBreakdown).toHaveLength(1)
    expect(dayData.modelBreakdown[0].model).toBe('gemini-3-flash-preview')
    expect(dayData.modelBreakdown[0].percent).toBeCloseTo(100, 0)

    const weekData = buildWelcomeUsageDashboardData(records, [], '7d', NOW)
    expect(weekData.modelBreakdown).toHaveLength(1)
    expect(weekData.modelBreakdown[0].model).toBe('gemini-3-flash-preview')

    const monthData = buildWelcomeUsageDashboardData(records, [], '30d', NOW)
    // Still only the gemini entry — the 90-day-old codex run is outside 30d.
    expect(monthData.modelBreakdown).toHaveLength(1)
    expect(monthData.modelBreakdown[0].model).toBe('gemini-3-flash-preview')
  })

  it('drops models with zero in-range tokens entirely (not 0%)', () => {
    const records: UsageRecord[] = [
      baseRecord({
        id: 'old-claude',
        timestamp: NOW - 60 * DAY,
        provider: 'claude',
        model: 'sonnet-4-6',
        totalTokens: 10_000
      }),
      baseRecord({
        id: 'recent-codex',
        timestamp: NOW - 1 * HOUR,
        provider: 'codex',
        model: 'gpt-5-codex',
        totalTokens: 5_000
      })
    ]
    const data = buildWelcomeUsageDashboardData(records, [], '24h', NOW)
    expect(data.modelBreakdown.map((m) => m.model)).toEqual(['gpt-5-codex'])
    // No 0% claude entry — model breakdown derives from filtered runRecords.
    expect(data.modelBreakdown.find((m) => m.model === 'sonnet-4-6')).toBeUndefined()
  })

  it('reports zero models + 0 totalTokens when the selected window has no activity', () => {
    const records: UsageRecord[] = [
      baseRecord({
        id: 'old-only',
        timestamp: NOW - 60 * DAY,
        provider: 'kimi',
        model: 'kimi-k2.6',
        totalTokens: 12_345
      })
    ]
    const data = buildWelcomeUsageDashboardData(records, [], '24h', NOW)
    expect(data.modelBreakdown).toEqual([])
    expect(data.totalTokens).toBe(0)
    expect(data.hasActivity).toBe(false)
    expect(data.favoriteModel).toBe('n/a')
  })

  it('reports lifetimeHasActivity=true even when the selected window is empty (Welcome L6)', () => {
    // Same shape as the previous test but check the L6 flag: when the
    // user has historical activity but nothing in the selected range,
    // lifetimeHasActivity must stay true so the renderer keeps the
    // dashboard + range-toggle mounted.
    const records: UsageRecord[] = [
      baseRecord({
        id: 'old-only',
        timestamp: NOW - 60 * DAY,
        provider: 'kimi',
        model: 'kimi-k2.6',
        totalTokens: 12_345
      })
    ]
    const data = buildWelcomeUsageDashboardData(records, [], '24h', NOW)
    expect(data.hasActivity).toBe(false)
    expect(data.lifetimeHasActivity).toBe(true)

    // And conversely: when there is literally no data anywhere, both
    // flags read false and the renderer hides the dashboard entirely.
    const dryData = buildWelcomeUsageDashboardData([], [], 'all', NOW)
    expect(dryData.hasActivity).toBe(false)
    expect(dryData.lifetimeHasActivity).toBe(false)
  })
})

describe('buildWelcomeUsageDashboardData headline stats — range scoping (Welcome L5)', () => {
  // Anchor "now" so cutoff math is deterministic.
  const NOW = new Date(2026, 4, 22, 12, 0).getTime() // 2026-05-22 12:00 local
  const DAY = 24 * 60 * 60 * 1000

  it('range-scopes sessions / messages / activeDays / peakHour / favoriteModel', () => {
    // Two windows of activity: a big burst 60 days ago (a 5-day streak,
    // 3 sessions, codex-dominant) and a single tiny entry today
    // (gemini). A 24h window should only see today's activity.
    const records: UsageRecord[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        baseRecord({
          id: `burst-${i}`,
          timestamp: NOW - (60 - i) * DAY + 14 * 60 * 60 * 1000,
          provider: 'codex',
          model: 'gpt-5-codex',
          chatId: `burst-chat-${i % 3}`, // 3 distinct sessions in burst
          totalTokens: 100_000
        })
      ),
      baseRecord({
        id: 'today',
        timestamp: NOW - 30 * 60_000, // 30 min ago
        provider: 'gemini',
        model: 'gemini-3-flash-preview',
        chatId: 'recent-chat',
        totalTokens: 1_000
      })
    ]

    const all = buildWelcomeUsageDashboardData(records, [], 'all', NOW)
    expect(all.sessions).toBe(4) // 3 burst chats + 1 recent
    expect(all.activeDays).toBe(6) // 5-day burst + today
    expect(all.favoriteModel).toBe('gpt-5-codex')

    const day = buildWelcomeUsageDashboardData(records, [], '24h', NOW)
    expect(day.sessions).toBe(1) // just the recent-chat
    expect(day.activeDays).toBe(1) // just today
    expect(day.favoriteModel).toBe('gemini-3-flash-preview') // burst dropped
  })

  it('keeps current + longest streak ON THE LIFETIME calendar regardless of range', () => {
    // Records span: a 5-day streak 30+ days ago, a 2-day streak today/yesterday.
    // Lifetime longest streak = 5. Current streak = 2.
    // A 24h range view must STILL show longestStreak=5, currentStreak=2 —
    // not collapse them to whatever the 24h slice contains.
    const burstStart = NOW - 30 * DAY
    const records: UsageRecord[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        baseRecord({
          id: `burst-${i}`,
          timestamp: burstStart - (4 - i) * DAY + 10 * 60 * 60 * 1000,
          provider: 'gemini',
          totalTokens: 1_000
        })
      ),
      baseRecord({
        // Yesterday at 09:00 — 27 hours before NOW (May 22 12:00), so
        // outside the 24h cutoff but inside the 7d cutoff.
        id: 'yesterday',
        timestamp: new Date(2026, 4, 21, 9, 0).getTime(),
        provider: 'gemini',
        totalTokens: 500
      }),
      baseRecord({
        id: 'today',
        timestamp: NOW - 30 * 60_000,
        provider: 'gemini',
        totalTokens: 500
      })
    ]

    const all = buildWelcomeUsageDashboardData(records, [], 'all', NOW)
    expect(all.currentStreak).toBe(2)
    expect(all.longestStreak).toBe(5)

    const day = buildWelcomeUsageDashboardData(records, [], '24h', NOW)
    // Sessions / activeDays narrow but streaks stay lifetime.
    expect(day.activeDays).toBe(1) // only today in-window
    expect(day.currentStreak).toBe(2)
    expect(day.longestStreak).toBe(5)

    const week = buildWelcomeUsageDashboardData(records, [], '7d', NOW)
    expect(week.activeDays).toBe(2) // today + yesterday
    expect(week.currentStreak).toBe(2)
    expect(week.longestStreak).toBe(5)
  })

  it('peakHour reflects the selected range (not lifetime)', () => {
    // Two records at different hours; the 24h view should pick the
    // recent one's hour, all-time picks whichever has more tokens.
    const records: UsageRecord[] = [
      baseRecord({
        id: 'old-3am',
        timestamp: new Date(2026, 3, 22, 3, 0).getTime(), // 30 days ago at 03:00
        provider: 'codex',
        totalTokens: 500_000
      }),
      baseRecord({
        id: 'recent-noon',
        timestamp: NOW - 30 * 60_000, // 11:30 same day
        provider: 'gemini',
        totalTokens: 1_000
      })
    ]
    const all = buildWelcomeUsageDashboardData(records, [], 'all', NOW)
    // Lifetime: the 500k-token 03:00 burst dominates the hour totals
    // (formatter renders as "3 AM").
    expect(all.peakHour).toBe('3 AM')
    const day = buildWelcomeUsageDashboardData(records, [], '24h', NOW)
    // 24h: only the 11:30 record survives the cutoff — peak hour
    // shifts to the noon-ish bucket and definitely isn't 3 AM.
    expect(day.peakHour).not.toBe('3 AM')
  })
})

describe('buildWelcomeUsageDashboardData model-breakdown filter (Welcome L8)', () => {
  const NOW = new Date(2026, 4, 22, 12, 0).getTime()

  it('drops `default` model entries across every provider', () => {
    const records: UsageRecord[] = [
      baseRecord({
        id: 'a',
        timestamp: NOW - 60_000,
        provider: 'claude',
        model: 'default',
        totalTokens: 1_000
      }),
      baseRecord({
        id: 'b',
        timestamp: NOW - 90_000,
        provider: 'kimi',
        model: 'default',
        totalTokens: 1_000
      }),
      baseRecord({
        id: 'c',
        timestamp: NOW - 120_000,
        provider: 'gemini',
        model: 'gemini-3-flash-preview',
        totalTokens: 5_000
      })
    ]
    const data = buildWelcomeUsageDashboardData(records, [], 'all', NOW)
    expect(data.modelBreakdown.map((m) => m.model)).toEqual(['gemini-3-flash-preview'])
    // The `default` runs still contribute to total tokens + active days
    // because they happened — only the per-model breakdown filter is
    // narrower than the rest of the stats.
    expect(data.totalTokens).toBeGreaterThan(5_000)
  })

  it('keeps only canonical Kimi variants (K2.6 + K2.6 Thinking) and relabels them', () => {
    const records: UsageRecord[] = [
      baseRecord({
        id: 'a',
        timestamp: NOW - 60_000,
        provider: 'kimi',
        model: 'kimi-k2.6',
        totalTokens: 1_000
      }),
      baseRecord({
        id: 'b',
        timestamp: NOW - 90_000,
        provider: 'kimi',
        model: 'kimi-k2-thinking',
        totalTokens: 500
      }),
      baseRecord({
        id: 'c',
        timestamp: NOW - 120_000,
        provider: 'kimi',
        model: 'kimi-latest',
        totalTokens: 1_000
      }),
      baseRecord({
        id: 'd',
        timestamp: NOW - 150_000,
        provider: 'kimi',
        model: 'kimi-k2.5',
        totalTokens: 1_000
      }),
      baseRecord({
        id: 'e',
        timestamp: NOW - 180_000,
        provider: 'kimi',
        model: 'kimi-k2',
        totalTokens: 1_000
      })
    ]
    const data = buildWelcomeUsageDashboardData(records, [], 'all', NOW)
    expect(data.modelBreakdown.map((m) => m.label)).toEqual([
      'Kimi K2.6',
      'Kimi K2.6 Thinking'
    ])
  })

  it('percentages are computed against kept-model tokens, not the lifetime aggregate', () => {
    const records: UsageRecord[] = [
      baseRecord({
        id: 'kept',
        timestamp: NOW - 60_000,
        provider: 'gemini',
        model: 'gemini-3-flash-preview',
        totalTokens: 1_000
      }),
      baseRecord({
        id: 'dropped',
        timestamp: NOW - 90_000,
        provider: 'claude',
        model: 'default',
        totalTokens: 1_000
      })
    ]
    const data = buildWelcomeUsageDashboardData(records, [], 'all', NOW)
    // Without rebalancing, this would read ~50%. With the L8 rebalanced
    // denominator (kept-tokens only), the surviving entry reads 100%.
    expect(data.modelBreakdown).toHaveLength(1)
    expect(data.modelBreakdown[0].percent).toBeCloseTo(100, 0)
    expect(data.totalTokens).toBeGreaterThan(1_500) // still counts both runs
  })
})

describe('buildWelcomeUsageDashboardData tokens24h (Welcome L9 hero chip)', () => {
  const NOW = new Date(2026, 4, 22, 12, 0).getTime()

  it('sums tokens only for records within the trailing 24h window', () => {
    const records: UsageRecord[] = [
      // Within window: 2h ago.
      baseRecord({
        id: 'recent',
        timestamp: NOW - 2 * 60 * 60_000,
        provider: 'codex',
        totalTokens: 1_000
      }),
      // Outside window: 25h ago.
      baseRecord({
        id: 'stale',
        timestamp: NOW - 25 * 60 * 60_000,
        provider: 'codex',
        totalTokens: 9_000
      })
    ]
    const data = buildWelcomeUsageDashboardData(records, [], '30d', NOW)
    expect(data.tokens24h).toBe(1_000)
  })

  it('is range-independent: same value regardless of dashboard cutoff', () => {
    const records: UsageRecord[] = [
      baseRecord({
        id: 'a',
        timestamp: NOW - 60 * 60_000, // 1h ago
        provider: 'gemini',
        totalTokens: 500
      })
    ]
    const day = buildWelcomeUsageDashboardData(records, [], '24h', NOW)
    const week = buildWelcomeUsageDashboardData(records, [], '7d', NOW)
    const all = buildWelcomeUsageDashboardData(records, [], 'all', NOW)
    expect(day.tokens24h).toBe(500)
    expect(week.tokens24h).toBe(500)
    expect(all.tokens24h).toBe(500)
  })

  it('is zero when no records fall inside the trailing 24h window', () => {
    const records: UsageRecord[] = [
      baseRecord({
        id: 'old',
        timestamp: NOW - 48 * 60 * 60_000,
        provider: 'claude',
        totalTokens: 4_000
      })
    ]
    const data = buildWelcomeUsageDashboardData(records, [], '30d', NOW)
    expect(data.tokens24h).toBe(0)
  })
})

describe('buildWelcomeUsageDashboardData favoriteProject (Welcome L9 hero chip)', () => {
  const NOW = new Date(2026, 4, 22, 12, 0).getTime()
  const workspaces = [
    { id: 'ws-a', displayName: 'Chill-Q' },
    { id: 'ws-b', displayName: 'Guitar Cabs' },
    { id: 'ws-c', displayName: 'GUIGemini' }
  ]

  it('picks the workspace with the most tokens in-window and resolves its displayName', () => {
    const records: UsageRecord[] = [
      baseRecord({
        id: 'a1',
        timestamp: NOW - 60_000,
        workspaceId: 'ws-a',
        totalTokens: 1_000
      }),
      baseRecord({
        id: 'b1',
        timestamp: NOW - 90_000,
        workspaceId: 'ws-b',
        totalTokens: 9_000
      }),
      baseRecord({
        id: 'c1',
        timestamp: NOW - 120_000,
        workspaceId: 'ws-c',
        totalTokens: 500
      })
    ]
    const data = buildWelcomeUsageDashboardData(records, [], '30d', NOW, workspaces)
    expect(data.favoriteProject).toBe('Guitar Cabs')
  })

  it('returns "n/a" when no records carry a workspaceId', () => {
    const records: UsageRecord[] = [
      // Override the default workspaceId so the record has no workspace.
      baseRecord({
        id: 'a',
        timestamp: NOW - 60_000,
        workspaceId: undefined as unknown as string,
        totalTokens: 1_000
      })
    ]
    const data = buildWelcomeUsageDashboardData(records, [], '30d', NOW, workspaces)
    expect(data.favoriteProject).toBe('n/a')
  })

  it('returns "n/a" when the favorite workspaceId is not in the workspaces list', () => {
    const records: UsageRecord[] = [
      baseRecord({
        id: 'a',
        timestamp: NOW - 60_000,
        workspaceId: 'ws-orphan',
        totalTokens: 1_000
      })
    ]
    const data = buildWelcomeUsageDashboardData(records, [], '30d', NOW, workspaces)
    expect(data.favoriteProject).toBe('n/a')
  })

  it('ignores records outside the dashboard range', () => {
    const records: UsageRecord[] = [
      // Stale (40 days ago): would dominate ws-a if range-unaware.
      baseRecord({
        id: 'stale',
        timestamp: NOW - 40 * 24 * 60 * 60_000,
        workspaceId: 'ws-a',
        totalTokens: 100_000
      }),
      // Recent: small but in-window.
      baseRecord({
        id: 'recent',
        timestamp: NOW - 60_000,
        workspaceId: 'ws-b',
        totalTokens: 500
      })
    ]
    const data = buildWelcomeUsageDashboardData(records, [], '30d', NOW, workspaces)
    expect(data.favoriteProject).toBe('Guitar Cabs')
  })

  it('degrades to "n/a" when called without a workspaces list', () => {
    const records: UsageRecord[] = [
      baseRecord({
        id: 'a',
        timestamp: NOW - 60_000,
        workspaceId: 'ws-a',
        totalTokens: 1_000
      })
    ]
    // No workspaces arg → backstop default `[]` → lookup misses.
    const data = buildWelcomeUsageDashboardData(records, [], '30d', NOW)
    expect(data.favoriteProject).toBe('n/a')
  })
})

describe('mixProviderColors', () => {
  const palette = {
    gemini: '#2563EB',
    codex: '#6366F1',
    claude: '#D97706',
    kimi: '#84A33B'
  } as const

  it('returns empty string when no provider has weight', () => {
    expect(mixProviderColors({ gemini: 0, codex: 0, claude: 0, kimi: 0 }, palette)).toBe('')
  })

  it('returns the single provider color when only one contributes', () => {
    expect(mixProviderColors({ gemini: 0, codex: 50, claude: 0, kimi: 0 }, palette)).toBe('#6366F1')
  })

  it('builds a nested color-mix() expression that references both providers when two contribute', () => {
    const result = mixProviderColors({ gemini: 30, codex: 70, claude: 0, kimi: 0 }, palette)
    expect(result).toContain('color-mix(in srgb,')
    expect(result).toContain('#2563EB')
    expect(result).toContain('#6366F1')
  })

  it('weights the dominant provider with a higher percentage in the color-mix expression', () => {
    const dominantCodex = mixProviderColors({ gemini: 10, codex: 90, claude: 0, kimi: 0 }, palette)
    // color-mix(in srgb, <gemini> 10%, <codex> 90%) → codex weight should appear with a high number.
    expect(dominantCodex).toMatch(/#6366F1 9[0-9]%/)
  })
})
