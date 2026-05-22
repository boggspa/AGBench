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
