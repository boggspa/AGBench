import { describe, expect, it } from 'vitest'
import type { ChatRun } from '../../../main/store/types'
import { buildChatTokenTally, formatTallySuffix } from './threadTokenTally'

function run(stats: Record<string, unknown>): ChatRun {
  return {
    runId: 'r1',
    provider: 'ollama',
    stats
  } as ChatRun
}

describe('buildChatTokenTally', () => {
  it('tracks the latest Ollama peak RAM across runs', () => {
    const tally = buildChatTokenTally([
      run({ inputTokens: 100, outputTokens: 20, ollamaMemoryPeakRssGb: 2.4 }),
      run({ inputTokens: 50, outputTokens: 10, ollamaMemoryPeakRssGb: 17.2 })
    ])
    expect(tally.inputTokens).toBe(150)
    expect(tally.outputTokens).toBe(30)
    expect(tally.peakMemoryRssGb).toBeCloseTo(17.2)
  })
})

describe('formatTallySuffix', () => {
  it('shows compact peak RAM for Ollama instead of currency', () => {
    const suffix = formatTallySuffix(
      'ollama',
      {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        explicitCostUsd: 0,
        peakMemoryRssGb: 17.2
      },
      'GBP',
      0
    )
    expect(suffix).toBe(' · 17.2GB')
  })

  it('keeps currency suffix for non-Ollama providers', () => {
    const suffix = formatTallySuffix(
      'codex',
      {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        explicitCostUsd: 1.79,
        peakMemoryRssGb: 0
      },
      'GBP',
      0
    )
    expect(suffix).toContain('£')
  })

  it('shows cost and peak RAM together for ensemble/guest dual telemetry', () => {
    const suffix = formatTallySuffix(
      'codex',
      {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        explicitCostUsd: 1.79,
        peakMemoryRssGb: 41.4
      },
      'GBP',
      0,
      { dualCostAndRam: true }
    )
    expect(suffix).toContain('£')
    expect(suffix).toContain('41.4GB')
  })
})
