import { describe, expect, it } from 'vitest'
import type { UsageRecord } from '../../../main/store/types'
import {
  buildOllamaMemoryModelTable,
  buildOllamaMemorySpend,
  formatOllamaMemoryAvgCell,
  formatOllamaSampleAvgCell
} from './ollamaMemoryAggregation'

const NOW = new Date('2026-06-13T12:00:00.000Z').getTime()

function makeRecord(
  overrides: Partial<UsageRecord> & { timestamp: number; ollamaMemoryPeakRssGb: number }
): UsageRecord {
  return {
    id: Math.random().toString(36).slice(2),
    workspaceId: 'ws-1',
    chatId: 'chat-1',
    runId: 'run-1',
    model: 'qwen3:4b-instruct',
    provider: 'ollama',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    durationMs: 0,
    ...overrides
  }
}

describe('ollamaMemoryAggregation', () => {
  it('returns null when there is no memory-bearing Ollama activity', () => {
    expect(buildOllamaMemorySpend([], NOW)).toBeNull()
    expect(
      buildOllamaMemorySpend(
        [makeRecord({ timestamp: NOW - 1000, ollamaMemoryPeakRssGb: 0 })],
        NOW
      )
    ).toBeNull()
  })

  it('averages per-run peak RSS across rolling windows', () => {
    const day = 2 * 60 * 60 * 1000
    const week = 3 * 24 * 60 * 60 * 1000
    const spend = buildOllamaMemorySpend(
      [
        makeRecord({
          timestamp: NOW - day,
          ollamaMemoryPeakRssGb: 10,
          ollamaMemorySampleCount: 4
        }),
        makeRecord({
          timestamp: NOW - week,
          ollamaMemoryPeakRssGb: 20,
          ollamaMemorySampleCount: 8
        })
      ],
      NOW
    )
    expect(spend?.day.avgPeakRssGb).toBe(10)
    expect(spend?.day.avgSampleCount).toBe(4)
    expect(spend?.month.avgPeakRssGb).toBe(15)
    expect(spend?.month.avgSampleCount).toBe(6)
  })

  it('groups per-model averages for the settings table', () => {
    const group = buildOllamaMemoryModelTable(
      [
        makeRecord({
          model: 'qwen3:4b-instruct',
          timestamp: NOW - 1000,
          ollamaMemoryPeakRssGb: 12,
          ollamaMemorySampleCount: 6
        }),
        makeRecord({
          model: 'gpt-oss:20b',
          timestamp: NOW - 2000,
          ollamaMemoryPeakRssGb: 24,
          ollamaMemorySampleCount: 10
        })
      ],
      NOW
    )
    expect(group?.provider).toBe('ollama')
    expect(group?.models).toHaveLength(2)
    expect(group?.models[0]?.model).toBe('gpt-oss:20b')
    expect(group?.totals.d90.avgPeakRssGb).toBe(18)
  })

  it('formats RAM and sample cells for display', () => {
    expect(formatOllamaMemoryAvgCell(12.4)).toBe('12 GB avg')
    expect(formatOllamaSampleAvgCell(8, 2)).toBe('8 samples avg')
    expect(formatOllamaSampleAvgCell(0, 1)).toBe('1 run')
  })
})
