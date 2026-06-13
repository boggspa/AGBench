import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModelUsageProviderTableBlock, ModelUsageSettingsTable } from './ModelUsageSettingsTable'
import { buildModelUsageTable } from '../lib/modelUsageTable'
import type { RendererProviderRates } from '../lib/providerRateEstimate'
import type { UsageRecord } from '../../../main/store/types'

const NOW = new Date('2026-06-13T12:00:00.000Z').getTime()

const RATES: RendererProviderRates = {
  codex: [{ modelId: 'gpt-5.5', inputUsdPerMillion: 1, outputUsdPerMillion: 10 }],
  claude: [{ modelId: 'opus', inputUsdPerMillion: 5, outputUsdPerMillion: 25 }]
}

function makeRecord(overrides: Partial<UsageRecord> & { timestamp: number }): UsageRecord {
  return {
    id: Math.random().toString(36).slice(2),
    workspaceId: 'ws',
    chatId: 'c',
    runId: 'run',
    model: 'gpt-5.5',
    provider: 'codex',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    durationMs: 0,
    ...overrides
  } as UsageRecord
}

describe('ModelUsageSettingsTable (SSR — effects do not fire)', () => {
  it('renders the empty state when no records have loaded yet', () => {
    // Under renderToStaticMarkup the getUsage/getExternalUsage effects never
    // run, so the aggregator sees empty record sets → honest empty state.
    const html = renderToStaticMarkup(<ModelUsageSettingsTable currency="USD" />)
    expect(html).toContain('No tracked usage in the last 90 days')
    // The "this app only" empty-state copy (toggle defaults OFF).
    expect(html).toContain('turn on External Usage')
  })

  it('renders the External Usage toggle, unchecked by default', () => {
    const html = renderToStaticMarkup(<ModelUsageSettingsTable currency="USD" />)
    expect(html).toContain('External Usage')
    expect(html).toContain('this app only')
    // Default OFF → checkbox not checked.
    expect(html).not.toContain('checked=""')
  })

  it('seeds the toggle ON from the persisted default and shows provider-wide copy', () => {
    const html = renderToStaticMarkup(
      <ModelUsageSettingsTable currency="USD" externalUsageDefault />
    )
    expect(html).toContain('checked=""')
    expect(html).toContain('provider-wide')
    // Empty-state copy switches to the external-on variant.
    expect(html).toContain('use a provider CLI')
  })

  it('always badges cost as estimated, never billed (header + footnote framing)', () => {
    const html = renderToStaticMarkup(<ModelUsageSettingsTable currency="USD" />)
    // Subtitle present even in the empty state — frames cost as estimated.
    expect(html).toContain('estimated API-equivalent cost · not billed')
  })
})

describe('ModelUsageProviderTableBlock (populated render)', () => {
  it('renders a provider summary row + per-model rows with ~-badged costs across 5 windows', () => {
    const records: UsageRecord[] = [
      // gpt-5.5 fresh: 2M in ($2) + 0.5M out ($5) = $7
      makeRecord({
        provider: 'codex',
        model: 'gpt-5.5',
        timestamp: NOW - 60_000,
        inputTokens: 2_000_000,
        outputTokens: 500_000,
        totalTokens: 2_500_000
      }),
      // A second model for the same provider, older (45d → 90d only).
      makeRecord({
        provider: 'codex',
        model: 'gpt-5.5-mini',
        timestamp: NOW - 45 * 24 * 60 * 60 * 1000,
        inputTokens: 1_000_000,
        totalTokens: 1_000_000
      })
    ]
    const [group] = buildModelUsageTable(records, [], RATES, { currency: 'USD' }, NOW)
    const html = renderToStaticMarkup(
      <table>
        <ModelUsageProviderTableBlock group={group} />
      </table>
    )

    // Provider heading + model-count chip.
    expect(html).toContain('Codex')
    expect(html).toContain('2 models')
    // Both model rows present (humanised label falls back to raw id).
    expect(html).toContain('gpt-5.5')
    // Cost is badged with ~ and the fresh model's 1H cost is $7.00.
    expect(html).toContain('~$7.00')
    // Token chips rendered.
    expect(html).toContain('tok')
  })

  it('projects Cursor cost via the Composer 2.5 Fast proxy rate', () => {
    const ratesWithCursor: RendererProviderRates = {
      ...RATES,
      cursor: [{ modelId: 'composer-2.5-fast', inputUsdPerMillion: 3, outputUsdPerMillion: 15 }]
    }
    const records: UsageRecord[] = [
      makeRecord({
        provider: 'cursor',
        model: 'composer-2.5-fast',
        timestamp: NOW - 60_000,
        inputTokens: 10_000,
        outputTokens: 5_000,
        totalTokens: 15_000
      })
    ]
    const [group] = buildModelUsageTable(records, [], ratesWithCursor, { currency: 'USD' }, NOW)
    const html = renderToStaticMarkup(
      <table>
        <ModelUsageProviderTableBlock group={group} />
      </table>
    )
    expect(html).toContain('Cursor')
    expect(html).toContain('tok')
    expect(html).toContain('~$0.11')
  })
})
