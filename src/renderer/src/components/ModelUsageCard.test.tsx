import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModelUsageCard } from './ModelUsageCard'
import type { ModelUsageAggregate } from '../App'

function quotaEntry(overrides: Partial<ModelUsageAggregate> = {}): ModelUsageAggregate {
  return {
    provider: 'kimi',
    model: 'usage limits',
    runs: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    durationMs: 0,
    quotaStale: true,
    quotaError: 'Kimi usage fetch failed.',
    windows: [
      {
        id: 'kimi-5h',
        label: '5H',
        runs: 0,
        totalTokens: 0,
        limitLabel: '200 / 200 remaining',
        trackingOnly: false,
        usedPercent: 0,
        remainingPercent: 100
      },
      {
        id: 'kimi-weekly',
        label: 'Weekly',
        runs: 0,
        totalTokens: 0,
        limitLabel: '2000 / 2000 remaining',
        trackingOnly: false,
        usedPercent: 0,
        remainingPercent: 100
      }
    ],
    ...overrides
  }
}

describe('ModelUsageCard', () => {
  it('renders cached zero-usage quota windows instead of dropping the provider', () => {
    const html = renderToStaticMarkup(<ModelUsageCard usageSummary={[quotaEntry()]} />)

    expect(html).toContain('Kimi')
    expect(html).toContain('5H')
    expect(html).toContain('Weekly')
    expect(html).toContain('0%')
    expect(html).toContain('200 / 200 remaining')
    expect(html).toContain('2000 / 2000 remaining')
  })
})
