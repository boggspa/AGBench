import { describe, expect, it } from 'vitest'

import {
  BAKED_IN_RATES,
  findDollarRateNearTokenPhrase,
  getCurrentProviderRates,
  RATE_TABLE_VERSION
} from './ProviderRateService'

/**
 * 1.0.5-EW38 — Tests for the pure helpers + the baseline shape.
 *
 * The probe orchestrator (`probeAllProviderRates`,
 * `probeOneProvider`) hits the real network so it's deliberately
 * NOT exercised here; its behaviour is verified manually in dev.
 * The helpers it depends on (`findDollarRateNearTokenPhrase`) are
 * fully testable and bear the regex weight.
 */

describe('findDollarRateNearTokenPhrase', () => {
  it('matches a clean "$15.00 / 1M tokens" pattern', () => {
    const out = findDollarRateNearTokenPhrase('Opus rate: $15.00 / 1M tokens (output)', 15)
    expect(out).not.toBeNull()
    expect(out).toContain('$15')
  })

  it('matches "$3.00 per 1M tokens"', () => {
    const out = findDollarRateNearTokenPhrase('Sonnet input is $3.00 per 1M tokens', 3)
    expect(out).not.toBeNull()
  })

  it('matches "$0.25/M tokens"', () => {
    const out = findDollarRateNearTokenPhrase('Mini tier: $0.25/M tokens input', 0.25)
    expect(out).not.toBeNull()
    expect(out).toContain('$0.25')
  })

  it('matches the integer form without decimals', () => {
    const out = findDollarRateNearTokenPhrase('Pricing: $5 / 1M tokens output', 5)
    expect(out).not.toBeNull()
  })

  it('matches even when the price has no decimal in the page text', () => {
    const out = findDollarRateNearTokenPhrase('Cost is $10 per 1M tokens', 10)
    expect(out).not.toBeNull()
  })

  it('returns null when the dollar value is present but not near a token phrase', () => {
    // Same page, but the $15 is in an unrelated sentence about
    // monthly subscription cost.
    const out = findDollarRateNearTokenPhrase(
      'Subscription costs $15 monthly. Pricing for tokens is in the API docs.',
      15
    )
    expect(out).toBeNull()
  })

  it('returns null when the dollar amount differs', () => {
    const out = findDollarRateNearTokenPhrase('Opus is $15.00 per 1M tokens', 3)
    expect(out).toBeNull()
  })

  it('matches commas in the million-token phrasing', () => {
    const out = findDollarRateNearTokenPhrase('$2.50 / 1,000,000 tokens', 2.5)
    expect(out).not.toBeNull()
  })

  it('matches "million tokens" spelled out', () => {
    const out = findDollarRateNearTokenPhrase('$0.50 per million tokens', 0.5)
    expect(out).not.toBeNull()
  })

  it('returns null for empty input', () => {
    expect(findDollarRateNearTokenPhrase('', 5)).toBeNull()
    expect(findDollarRateNearTokenPhrase('some text', 0)).toBeNull()
    expect(findDollarRateNearTokenPhrase('some text', -1)).toBeNull()
    expect(findDollarRateNearTokenPhrase('some text', Number.NaN)).toBeNull()
  })

  it('is case-insensitive for the token phrase', () => {
    const out = findDollarRateNearTokenPhrase('$1.25 / 1M TOKENS (input)', 1.25)
    expect(out).not.toBeNull()
  })
})

describe('BAKED_IN_RATES', () => {
  it('has an entry for every provider', () => {
    expect(BAKED_IN_RATES.codex).toBeDefined()
    expect(BAKED_IN_RATES.claude).toBeDefined()
    expect(BAKED_IN_RATES.gemini).toBeDefined()
    expect(BAKED_IN_RATES.kimi).toBeDefined()
  })

  it('every entry carries a pricingUrl + at least one model', () => {
    for (const table of Object.values(BAKED_IN_RATES)) {
      expect(table.pricingUrl).toMatch(/^https?:\/\//)
      expect(table.models.length).toBeGreaterThan(0)
    }
  })

  it('every model entry has positive input/output rates + a sourceUrl', () => {
    for (const table of Object.values(BAKED_IN_RATES)) {
      for (const model of table.models) {
        expect(model.modelId).toBeTruthy()
        expect(model.inputUsdPerMillion).toBeGreaterThan(0)
        expect(model.outputUsdPerMillion).toBeGreaterThan(0)
        expect(model.sourceUrl).toMatch(/^https?:\/\//)
        expect(model.lastVerified).toBe(RATE_TABLE_VERSION)
      }
    }
  })

  it('output rates are >= input rates (typical industry pattern)', () => {
    // This is a soft invariant — most providers charge more for
    // output tokens. The test would only fail if a baked-in rate
    // got entered upside-down.
    for (const table of Object.values(BAKED_IN_RATES)) {
      for (const model of table.models) {
        expect(model.outputUsdPerMillion).toBeGreaterThanOrEqual(model.inputUsdPerMillion)
      }
    }
  })

  it('cached-input rates (when present) are < input rates', () => {
    for (const table of Object.values(BAKED_IN_RATES)) {
      for (const model of table.models) {
        if (model.cachedInputUsdPerMillion !== undefined) {
          expect(model.cachedInputUsdPerMillion).toBeLessThan(model.inputUsdPerMillion)
        }
      }
    }
  })
})

describe('getCurrentProviderRates', () => {
  it('returns the baseline immediately (no probe required)', () => {
    const snapshot = getCurrentProviderRates()
    expect(snapshot.rateTableVersion).toBe(RATE_TABLE_VERSION)
    expect(snapshot.baseline).toBe(BAKED_IN_RATES)
  })

  it('does not require the probe to have run', () => {
    // If no probe has been triggered yet, `probe` is undefined.
    // Callers must treat baseline as authoritative regardless.
    const snapshot = getCurrentProviderRates()
    expect(snapshot.baseline.claude.models.length).toBeGreaterThan(0)
  })
})
