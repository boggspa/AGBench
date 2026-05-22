export const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const

/** Pure helper: turn a value into the digit list rendered in slots.
 * Negative values are flipped to positive; the caller controls sign
 * via the `sign` prop. Extracted so the model is unit-testable
 * without a DOM. */
export function digitSlotsForValue(value: number): number[] {
  const abs = Math.abs(Math.trunc(Number.isFinite(value) ? value : 0))
  return String(abs)
    .split('')
    .map((c) => Number.parseInt(c, 10))
}
