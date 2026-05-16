import { describe, expect, it } from 'vitest'

import type { UsageRecord } from '../../../main/store/types'

import {
  HEATMAP_DAY_COUNT,
  HEATMAP_HOUR_COUNT,
  buildWelcomeUsageDashboardData,
  mixProviderColors,
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
  ...overrides,
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
    const expectedStart = new Date(2026, 4, 15, 14).getTime() - (HEATMAP_DAY_COUNT * HEATMAP_HOUR_COUNT - 1) * 60 * 60 * 1000
    const firstDate = new Date(expectedStart)
    expect(first.hour).toBe(firstDate.getHours())
  })

  it('buckets usage tokens by local hour and tracks provider totals', () => {
    const now = new Date(2026, 4, 15, 14, 0).getTime()
    const sameHour = new Date(2026, 4, 15, 12, 25).getTime()
    const records: UsageRecord[] = [
      baseRecord({ id: 'a', timestamp: sameHour, provider: 'codex', totalTokens: 200 }),
      baseRecord({ id: 'b', timestamp: sameHour + 60_000, provider: 'gemini', totalTokens: 400 }),
    ]
    const data = buildWelcomeUsageDashboardData(records, [], 'all', now)
    const hourCell = data.hourlyHeatmap.find((cell) => cell.hour === 12 && cell.dayKey === '2026-05-15')
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
      baseRecord({ id: 'high', timestamp: new Date(2026, 4, 15, 11, 0).getTime(), totalTokens: 4000 }),
    ]
    const data = buildWelcomeUsageDashboardData(records, [], 'all', now)
    const lowCell = data.hourlyHeatmap.find((cell) => cell.hour === 10 && cell.dayKey === '2026-05-15')
    const highCell = data.hourlyHeatmap.find((cell) => cell.hour === 11 && cell.dayKey === '2026-05-15')
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
      provider: 'claude',
    })
    const data = buildWelcomeUsageDashboardData([record], [], 'all', now)
    const cell = data.hourlyHeatmap.find((c) => c.hour === 9 && c.dayKey === '2026-05-15')
    expect(cell!.totalTokens).toBe(1)
    expect(cell!.providerTotals.claude).toBe(1)
  })
})

describe('mixProviderColors', () => {
  const palette = {
    gemini: '#2563EB',
    codex: '#6366F1',
    claude: '#D97706',
    kimi: '#84A33B',
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
