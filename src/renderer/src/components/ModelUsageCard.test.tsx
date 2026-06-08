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

  it('renders the existing four providers and does NOT add a Grok meter when Grok is unavailable', () => {
    // Regression for 1.0.6-GU: the gated Grok subscription-credit meter
    // must not leak into the card. Under SSR the availability effect never
    // runs, so `grokAvailable` stays false and the meter is absent — exactly
    // the gate-off behaviour. The four token/quota meters render unchanged.
    const summary = [
      quotaEntry({ provider: 'gemini' }),
      quotaEntry({ provider: 'codex' }),
      quotaEntry({ provider: 'claude' }),
      quotaEntry({ provider: 'kimi' })
    ]
    const html = renderToStaticMarkup(<ModelUsageCard usageSummary={summary} />)

    expect(html).toContain('Gemini')
    expect(html).toContain('Codex')
    expect(html).toContain('Claude')
    expect(html).toContain('Kimi')
    // Grok credits meter stays out unless the gated adapter is registered.
    expect(html).not.toContain('Subscription credits')
  })

  it('renders the sidebar resize grip band when expanded', () => {
    const html = renderToStaticMarkup(
      <ModelUsageCard usageSummary={[quotaEntry()]} variant="sidebar" />
    )

    expect(html).toContain('model-usage-resize-handle')
    expect(html).toContain('model-usage-resize-grip')
  })
})
