import { describe, expect, it } from 'vitest'

import { formatCost, formatCostAlwaysOn } from './formatCost'

/**
 * 1.0.5-EW34 — Tests for the conservative-overestimate bias
 * (sub-slice e). The baseline EW25 behaviour (currency selection,
 * floor labels, locale fallback) is covered indirectly by these
 * tests when `overestimatePercent` is 0 or omitted.
 *
 * The math is straightforward — `usd * (1 + percent/100)` before
 * FX conversion — but we want to pin the edge cases:
 *
 *   - 0 / undefined → identical to pre-EW34
 *   - negative / NaN / Infinity → clamped to 0 (defensive)
 *   - above-cap values (>25) → clamped to 25
 *   - bias applied BEFORE the per-currency floor check so a tiny
 *     biased amount that crosses the floor renders as the real
 *     number rather than the `<$0.01` label
 *   - currency conversion happens AFTER the bias so the bias is
 *     uniformly "+N% more cost" regardless of which currency the
 *     user is viewing in
 */

// Helper to strip locale-specific characters so tests aren't fragile
// against different ICU rule sets (e.g. non-breaking space between
// symbol and digits in some locales). We only care that the magnitude
// is right and the currency symbol is somewhere in the output.
function digitsOnly(s: string): string {
  return s.replace(/[^\d.]/g, '')
}

describe('formatCost — overestimate sub-slice (e)', () => {
  it('returns identical output when overestimatePercent is 0 (default)', () => {
    const base = formatCost(1, 'USD')
    const withZero = formatCost(1, 'USD', undefined, 0)
    expect(withZero).toBe(base)
  })

  it('returns identical output when overestimatePercent is omitted', () => {
    const base = formatCost(1, 'USD')
    const omitted = formatCost(1, 'USD')
    expect(omitted).toBe(base)
  })

  it('applies a +10% bias to USD amounts', () => {
    // $1.00 → $1.10
    const out = formatCost(1, 'USD', undefined, 10)
    expect(digitsOnly(out)).toBe('1.10')
  })

  it('applies a +25% bias (the max) correctly', () => {
    // $4.00 → $5.00
    const out = formatCost(4, 'USD', undefined, 25)
    expect(digitsOnly(out)).toBe('5.00')
  })

  it('clamps over-cap bias values (50 → 25)', () => {
    // $4 at +50% would be $6; clamped to +25% gives $5.
    const out = formatCost(4, 'USD', undefined, 50)
    expect(digitsOnly(out)).toBe('5.00')
  })

  it('clamps negative bias values to 0 (no bias)', () => {
    const base = formatCost(1, 'USD')
    const negative = formatCost(1, 'USD', undefined, -10)
    expect(negative).toBe(base)
  })

  it('clamps NaN bias to 0', () => {
    const base = formatCost(1, 'USD')
    const nan = formatCost(1, 'USD', undefined, Number.NaN)
    expect(nan).toBe(base)
  })

  it('clamps Infinity bias to 0', () => {
    const base = formatCost(1, 'USD')
    const inf = formatCost(1, 'USD', undefined, Number.POSITIVE_INFINITY)
    expect(inf).toBe(base)
  })

  it('bias is applied in USD-space, then converted to GBP', () => {
    // $1 at +10% = $1.10. GBP rate 0.79 → £0.869 → rounds to £0.87.
    const out = formatCost(1, 'GBP', undefined, 10)
    expect(digitsOnly(out)).toBe('0.87')
  })

  it('bias is applied in USD-space, then converted to EUR', () => {
    // $1 at +10% = $1.10. EUR rate 0.92 → €1.012 → rounds to €1.01.
    const out = formatCost(1, 'EUR', undefined, 10)
    expect(digitsOnly(out)).toBe('1.01')
  })

  it('biased amount that crosses the floor renders the real number', () => {
    // $0.009 is below $0.01 floor → renders as `<$0.01`.
    // At +20% bias → $0.0108 → above floor → renders real number.
    const belowFloor = formatCost(0.009, 'USD')
    expect(belowFloor).toBe('<$0.01')
    const aboveAfterBias = formatCost(0.009, 'USD', undefined, 20)
    expect(aboveAfterBias).not.toBe('<$0.01')
    expect(digitsOnly(aboveAfterBias)).toBe('0.01')
  })

  it('biased amount still below floor renders the floor label', () => {
    // $0.001 at +25% = $0.00125 — still below $0.01.
    const out = formatCost(0.001, 'USD', undefined, 25)
    expect(out).toBe('<$0.01')
  })

  it('preserves empty-string return for non-positive / non-finite USD even with bias', () => {
    expect(formatCost(0, 'USD', undefined, 10)).toBe('')
    expect(formatCost(-1, 'USD', undefined, 10)).toBe('')
    expect(formatCost(Number.NaN, 'USD', undefined, 10)).toBe('')
    expect(formatCost(Number.POSITIVE_INFINITY, 'USD', undefined, 10)).toBe('')
  })
})

describe('formatCostAlwaysOn — overestimate threading', () => {
  it('forwards the bias to formatCost for non-zero amounts', () => {
    const a = formatCost(1, 'USD', undefined, 10)
    const b = formatCostAlwaysOn(1, 'USD', undefined, 10)
    expect(b).toBe(a)
  })

  it('still returns the zero placeholder for zero amounts regardless of bias', () => {
    const out = formatCostAlwaysOn(0, 'USD', undefined, 15)
    // Zero × anything is zero — should render the per-currency zero placeholder.
    expect(digitsOnly(out)).toBe('0.00')
  })
})
