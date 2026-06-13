import { describe, expect, it } from 'vitest'
import type { ChatRecord, UsageRecord } from '../../../main/store/types'
import {
  buildOllamaMemoryModelTable,
  buildOllamaMemorySpend,
  deriveOllamaMemoryUsageFromChats,
  formatOllamaMemoryAvgCell,
  formatOllamaSampleAvgCell,
  mergeOllamaMemoryUsageRecords
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

  it('derives memory rows from persisted Ollama chat run stats', () => {
    const chats: ChatRecord[] = [
      {
        appChatId: 'chat-1',
        workspaceId: 'ws-1',
        title: 'Ollama thread',
        createdAt: 1_780_000_000_000,
        updatedAt: 1_781_000_000_000,
        archived: false,
        messages: [],
        runs: [
          {
            runId: 'run-ollama-1',
            provider: 'ollama',
            startedAt: '2026-06-13T11:00:00.000Z',
            endedAt: '2026-06-13T11:05:00.000Z',
            actualModel: 'qwen3:4b-instruct',
            stats: { ollamaMemoryPeakRssGb: 14, ollamaMemorySampleCount: 5 }
          }
        ]
      } as ChatRecord
    ]
    const derived = deriveOllamaMemoryUsageFromChats(chats)
    expect(derived).toHaveLength(1)
    expect(derived[0]?.runId).toBe('run-ollama-1')
    expect(derived[0]?.ollamaMemoryPeakRssGb).toBe(14)
    expect(buildOllamaMemorySpend(derived, NOW)?.month.avgPeakRssGb).toBe(14)
  })

  it('patches historical usage rows that lack memory fields from chat stats', () => {
    const usage: UsageRecord[] = [
      makeRecord({
        runId: 'run-ollama-1',
        timestamp: NOW - 1000,
        ollamaMemoryPeakRssGb: 0
      })
    ]
    const chats: ChatRecord[] = [
      {
        appChatId: 'chat-1',
        workspaceId: 'ws-1',
        title: 'Ollama thread',
        createdAt: 1_780_000_000_000,
        updatedAt: 1_781_000_000_000,
        archived: false,
        messages: [],
        runs: [
          {
            runId: 'run-ollama-1',
            provider: 'ollama',
            startedAt: '2026-06-13T11:00:00.000Z',
            endedAt: '2026-06-13T11:05:00.000Z',
            actualModel: 'qwen3:4b-instruct',
            stats: { ollamaMemoryPeakRssGb: 9, ollamaMemorySampleCount: 3 }
          }
        ]
      } as ChatRecord
    ]
    const merged = mergeOllamaMemoryUsageRecords(usage, chats)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.ollamaMemoryPeakRssGb).toBe(9)
    expect(merged[0]?.ollamaMemorySampleCount).toBe(3)
  })
})
