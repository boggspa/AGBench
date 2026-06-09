import { describe, expect, it } from 'vitest'
import { COMPOSER_ABOVE_ROW_CLEARANCE_PX, composerAboveRowClearancePx } from './composerScrollClearance'

describe('composerScrollClearance', () => {
  it('adds no extra clearance for zero or one strip', () => {
    expect(composerAboveRowClearancePx(0)).toBe(0)
    expect(composerAboveRowClearancePx(1)).toBe(0)
  })

  it('adds 20px per additional above-row strip', () => {
    expect(composerAboveRowClearancePx(2)).toBe(COMPOSER_ABOVE_ROW_CLEARANCE_PX)
    expect(composerAboveRowClearancePx(4)).toBe(COMPOSER_ABOVE_ROW_CLEARANCE_PX * 3)
  })
})
