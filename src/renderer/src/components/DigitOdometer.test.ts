import { describe, expect, it } from 'vitest'
import { digitSlotsForValue } from './DigitOdometer'

describe('digitSlotsForValue', () => {
  it('returns a single zero slot for value 0', () => {
    expect(digitSlotsForValue(0)).toEqual([0])
  })

  it('splits multi-digit positive values into digit slots', () => {
    expect(digitSlotsForValue(7)).toEqual([7])
    expect(digitSlotsForValue(46)).toEqual([4, 6])
    expect(digitSlotsForValue(100)).toEqual([1, 0, 0])
    expect(digitSlotsForValue(2025)).toEqual([2, 0, 2, 5])
  })

  it('treats negative values by absolute magnitude (sign handled separately)', () => {
    expect(digitSlotsForValue(-23)).toEqual([2, 3])
    expect(digitSlotsForValue(-1)).toEqual([1])
  })

  it('truncates fractional values to their integer part', () => {
    expect(digitSlotsForValue(3.7)).toEqual([3])
    expect(digitSlotsForValue(12.49)).toEqual([1, 2])
  })

  it('treats non-finite values as 0', () => {
    expect(digitSlotsForValue(Number.POSITIVE_INFINITY)).toEqual([0])
    expect(digitSlotsForValue(Number.NEGATIVE_INFINITY)).toEqual([0])
    expect(digitSlotsForValue(Number.NaN)).toEqual([0])
  })

  it('preserves leading zeros only in the absolute form (no leading zeros)', () => {
    // String(46) === '46', not '046' — pin we don't accidentally pad.
    expect(digitSlotsForValue(46)).toHaveLength(2)
    expect(digitSlotsForValue(5)).toHaveLength(1)
  })

  it('handles large numbers without overflow surprises', () => {
    expect(digitSlotsForValue(123456789)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})
