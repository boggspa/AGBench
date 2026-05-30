import { describe, expect, it } from 'vitest'

import {
  isSnapshotStale,
  parseCachedSnapshot,
  parseFxApiPayload,
  serialiseSnapshot,
  type FxRateSnapshot
} from './FxRateService'

/**
 * 1.0.5-EW35 — Tests for the pure helpers inside FxRateService.
 *
 * The orchestrator function `refreshFxRates` is intentionally NOT
 * tested in isolation here because it touches the network + the
 * filesystem + `app.getPath('userData')` (Electron-only). Its
 * behaviour is implied by the helpers below + manually verified
 * in dev.
 */

describe('parseFxApiPayload', () => {
  it('returns null for null / undefined / non-object input', () => {
    expect(parseFxApiPayload(null)).toBeNull()
    expect(parseFxApiPayload(undefined)).toBeNull()
    expect(parseFxApiPayload('not an object')).toBeNull()
    expect(parseFxApiPayload(42)).toBeNull()
    expect(parseFxApiPayload([])).toBeNull() // arrays are typeof object but lack `.result`
  })

  it('returns null when result is not "success"', () => {
    expect(parseFxApiPayload({ result: 'error', rates: { GBP: 0.79, EUR: 0.92 } })).toBeNull()
    expect(parseFxApiPayload({ rates: { GBP: 0.79, EUR: 0.92 } })).toBeNull()
    expect(parseFxApiPayload({ result: '', rates: { GBP: 0.79, EUR: 0.92 } })).toBeNull()
  })

  it('returns null when rates missing or wrong shape', () => {
    expect(parseFxApiPayload({ result: 'success' })).toBeNull()
    expect(parseFxApiPayload({ result: 'success', rates: null })).toBeNull()
    expect(parseFxApiPayload({ result: 'success', rates: 'oops' })).toBeNull()
  })

  it('returns null when GBP or EUR missing / non-numeric / zero / negative', () => {
    expect(parseFxApiPayload({ result: 'success', rates: { GBP: 0.79 } })).toBeNull()
    expect(parseFxApiPayload({ result: 'success', rates: { EUR: 0.92 } })).toBeNull()
    expect(parseFxApiPayload({ result: 'success', rates: { GBP: '0.79', EUR: 0.92 } })).toBeNull()
    expect(parseFxApiPayload({ result: 'success', rates: { GBP: 0, EUR: 0.92 } })).toBeNull()
    expect(parseFxApiPayload({ result: 'success', rates: { GBP: -1, EUR: 0.92 } })).toBeNull()
    expect(
      parseFxApiPayload({ result: 'success', rates: { GBP: Number.NaN, EUR: 0.92 } })
    ).toBeNull()
    expect(
      parseFxApiPayload({
        result: 'success',
        rates: { GBP: Number.POSITIVE_INFINITY, EUR: 0.92 }
      })
    ).toBeNull()
  })

  it('returns a clean { USD: 1, GBP, EUR } map on valid input', () => {
    const out = parseFxApiPayload({
      result: 'success',
      rates: { GBP: 0.79, EUR: 0.92, JPY: 156.5, AUD: 1.52 }
    })
    expect(out).toEqual({ USD: 1, GBP: 0.79, EUR: 0.92 })
  })

  it('ignores extra rate keys (forward-compat with API additions)', () => {
    const out = parseFxApiPayload({
      result: 'success',
      rates: { GBP: 0.79, EUR: 0.92, CHF: 0.89, CAD: 1.36, BTC: 0.00001 }
    })
    // Only USD/GBP/EUR survive — display currencies the app supports.
    expect(out).toEqual({ USD: 1, GBP: 0.79, EUR: 0.92 })
  })
})

describe('parseCachedSnapshot', () => {
  it('returns null for malformed JSON', () => {
    expect(parseCachedSnapshot('{not json')).toBeNull()
    expect(parseCachedSnapshot('')).toBeNull()
    expect(parseCachedSnapshot('null')).toBeNull()
    expect(parseCachedSnapshot('"string"')).toBeNull()
  })

  it('returns null when fetchedAt missing or non-ISO', () => {
    expect(parseCachedSnapshot(JSON.stringify({ rates: { GBP: 0.79, EUR: 0.92 } }))).toBeNull()
    expect(
      parseCachedSnapshot(
        JSON.stringify({ rates: { GBP: 0.79, EUR: 0.92 }, fetchedAt: 'not-a-date' })
      )
    ).toBeNull()
  })

  it('returns null when rates malformed', () => {
    expect(parseCachedSnapshot(JSON.stringify({ fetchedAt: '2026-01-01T00:00:00Z' }))).toBeNull()
    expect(
      parseCachedSnapshot(
        JSON.stringify({ rates: { GBP: -1, EUR: 0.92 }, fetchedAt: '2026-01-01T00:00:00Z' })
      )
    ).toBeNull()
    expect(
      parseCachedSnapshot(
        JSON.stringify({ rates: { GBP: 'oops', EUR: 0.92 }, fetchedAt: '2026-01-01T00:00:00Z' })
      )
    ).toBeNull()
  })

  it('returns a snapshot with source="cached" on valid input', () => {
    const out = parseCachedSnapshot(
      JSON.stringify({
        rates: { GBP: 0.81, EUR: 0.94 },
        fetchedAt: '2026-05-27T12:00:00.000Z'
      })
    )
    expect(out).toEqual({
      rates: { USD: 1, GBP: 0.81, EUR: 0.94 },
      fetchedAt: '2026-05-27T12:00:00.000Z',
      source: 'cached'
    })
  })

  it('tolerates a present-but-irrelevant USD field in cached rates', () => {
    // A previous serialisation might have included USD; we should
    // always pin it to 1 in the output regardless of stored value.
    const out = parseCachedSnapshot(
      JSON.stringify({
        rates: { USD: 999, GBP: 0.81, EUR: 0.94 },
        fetchedAt: '2026-05-27T12:00:00.000Z'
      })
    )
    expect(out?.rates.USD).toBe(1)
  })
})

describe('isSnapshotStale', () => {
  const FRESH_NOW = Date.parse('2026-05-27T12:00:00Z')
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000

  function makeSnapshot(fetchedAt: string): FxRateSnapshot {
    return {
      rates: { USD: 1, GBP: 0.79, EUR: 0.92 },
      fetchedAt,
      source: 'live'
    }
  }

  it('treats null as stale', () => {
    expect(isSnapshotStale(null, FRESH_NOW)).toBe(true)
  })

  it('treats a snapshot with malformed fetchedAt as stale', () => {
    expect(isSnapshotStale(makeSnapshot('not-a-date'), FRESH_NOW)).toBe(true)
  })

  it('is not stale at age = 0', () => {
    expect(isSnapshotStale(makeSnapshot('2026-05-27T12:00:00Z'), FRESH_NOW)).toBe(false)
  })

  it('is not stale 11h 59min after fetch', () => {
    const fetchedAt = new Date(FRESH_NOW - (TWELVE_HOURS_MS - 60_000)).toISOString()
    expect(isSnapshotStale(makeSnapshot(fetchedAt), FRESH_NOW)).toBe(false)
  })

  it('is stale 12h 1min after fetch', () => {
    const fetchedAt = new Date(FRESH_NOW - (TWELVE_HOURS_MS + 60_000)).toISOString()
    expect(isSnapshotStale(makeSnapshot(fetchedAt), FRESH_NOW)).toBe(true)
  })
})

describe('serialiseSnapshot', () => {
  it('produces valid JSON with rates + fetchedAt only (drops source)', () => {
    const snapshot: FxRateSnapshot = {
      rates: { USD: 1, GBP: 0.79, EUR: 0.92 },
      fetchedAt: '2026-05-27T12:00:00.000Z',
      source: 'live'
    }
    const serialised = serialiseSnapshot(snapshot)
    const parsed = JSON.parse(serialised)
    expect(parsed).toEqual({
      rates: { USD: 1, GBP: 0.79, EUR: 0.92 },
      fetchedAt: '2026-05-27T12:00:00.000Z'
    })
    expect(parsed.source).toBeUndefined()
  })

  it('round-trips through parseCachedSnapshot to source="cached"', () => {
    const snapshot: FxRateSnapshot = {
      rates: { USD: 1, GBP: 0.81, EUR: 0.94 },
      fetchedAt: '2026-05-27T12:00:00.000Z',
      source: 'live'
    }
    const round = parseCachedSnapshot(serialiseSnapshot(snapshot))
    expect(round).toEqual({
      rates: { USD: 1, GBP: 0.81, EUR: 0.94 },
      fetchedAt: '2026-05-27T12:00:00.000Z',
      source: 'cached'
    })
  })
})
