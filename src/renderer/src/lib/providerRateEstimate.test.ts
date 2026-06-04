import { describe, expect, it } from 'vitest'
import {
  estimateRunCostUsd,
  normalizeProviderRates,
  resolveModelRate,
  type RendererProviderRates
} from './providerRateEstimate'

const RATES: RendererProviderRates = {
  codex: [
    { modelId: 'gpt-5.5', inputUsdPerMillion: 1.25, outputUsdPerMillion: 10.0 },
    { modelId: 'gpt-5.4-mini', inputUsdPerMillion: 0.25, outputUsdPerMillion: 2.0 }
  ],
  cursor: [] // empty list — Cursor ships no public rate
}

describe('normalizeProviderRates', () => {
  it('unwraps the ProviderRatesSnapshot baseline envelope', () => {
    const snapshot = {
      rateTableVersion: '2026-05-29',
      baseline: {
        codex: {
          provider: 'codex',
          pricingUrl: 'https://example',
          models: [
            {
              modelId: 'gpt-5.5',
              inputUsdPerMillion: 1.25,
              outputUsdPerMillion: 10.0,
              cachedInputUsdPerMillion: 0.125,
              sourceUrl: 'x',
              lastVerified: '2026-05-29'
            }
          ]
        },
        cursor: { provider: 'cursor', pricingUrl: '', models: [] }
      }
    }
    const out = normalizeProviderRates(snapshot)
    expect(out.codex).toEqual([
      { modelId: 'gpt-5.5', inputUsdPerMillion: 1.25, outputUsdPerMillion: 10.0 }
    ])
    // Empty model lists are dropped entirely.
    expect(out.cursor).toBeUndefined()
  })

  it('accepts an already-unwrapped table map', () => {
    const out = normalizeProviderRates({
      grok: { models: [{ modelId: 'grok-build', inputUsdPerMillion: 1, outputUsdPerMillion: 2 }] }
    })
    expect(out.grok).toEqual([
      { modelId: 'grok-build', inputUsdPerMillion: 1, outputUsdPerMillion: 2 }
    ])
  })

  it('returns {} for malformed / missing input and skips invalid entries', () => {
    expect(normalizeProviderRates(null)).toEqual({})
    expect(normalizeProviderRates('nope')).toEqual({})
    expect(normalizeProviderRates(undefined)).toEqual({})
    // entry missing a numeric rate is skipped, leaving the provider absent
    expect(
      normalizeProviderRates({
        codex: { models: [{ modelId: 'x', inputUsdPerMillion: 'bad', outputUsdPerMillion: 1 }] }
      })
    ).toEqual({})
  })
})

describe('resolveModelRate', () => {
  it('matches exactly, then by prefix, then falls back to the first model', () => {
    expect(resolveModelRate(RATES, 'codex', 'gpt-5.5')?.modelId).toBe('gpt-5.5')
    // dated suffix resolves to the base entry via prefix match
    expect(resolveModelRate(RATES, 'codex', 'gpt-5.5-2026-06-01')?.modelId).toBe('gpt-5.5')
    // unknown model on a known provider falls back to first listed
    expect(resolveModelRate(RATES, 'codex', 'totally-unknown')?.modelId).toBe('gpt-5.5')
  })

  it('returns null for unknown provider or empty rate list', () => {
    expect(resolveModelRate(RATES, undefined, 'gpt-5.5')).toBeNull()
    expect(resolveModelRate(RATES, 'cursor', 'composer-2.5')).toBeNull()
    expect(resolveModelRate(RATES, 'gemini', 'gemini-3.1-pro')).toBeNull()
  })
})

describe('estimateRunCostUsd', () => {
  it('projects input+output tokens at the per-million rate', () => {
    // 1,000,000 in * $1.25/M + 500,000 out * $10/M = 1.25 + 5.00 = 6.25
    const usd = estimateRunCostUsd(RATES, 'codex', 'gpt-5.5', 1_000_000, 500_000)
    expect(usd).toBeCloseTo(6.25, 6)
  })

  it('uses the resolved (prefix/fallback) model rate', () => {
    // unknown model → falls back to gpt-5.5 rate
    const usd = estimateRunCostUsd(RATES, 'codex', 'mystery', 100_000, 0)
    expect(usd).toBeCloseTo(0.125, 6)
  })

  it('returns 0 when provider/model cannot be resolved', () => {
    expect(estimateRunCostUsd(RATES, 'cursor', 'composer-2.5', 100_000, 100_000)).toBe(0)
    expect(estimateRunCostUsd(RATES, undefined, 'x', 100_000, 100_000)).toBe(0)
  })

  it('returns 0 when there are no tokens', () => {
    expect(estimateRunCostUsd(RATES, 'codex', 'gpt-5.5', 0, 0)).toBe(0)
  })

  it('treats non-finite token counts as zero', () => {
    expect(estimateRunCostUsd(RATES, 'codex', 'gpt-5.5', NaN, NaN)).toBe(0)
    // one valid count still estimates
    expect(estimateRunCostUsd(RATES, 'codex', 'gpt-5.5', 1_000_000, NaN)).toBeCloseTo(1.25, 6)
  })
})
