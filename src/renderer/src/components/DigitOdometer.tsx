import { useMemo, type JSX } from 'react'

/**
 * DigitOdometer — skeuomorphic per-digit rolling counter, matching the
 * "secret-sauce" approach used by OpenAI's Codex client.
 *
 * Trick: each digit position renders a CSS-clipped window (height: 1em,
 * overflow: hidden) containing a vertical column with all ten digits
 * stacked (0..9). The column is translated by `-digit * 1em` so the
 * clipped window reveals exactly one digit. When the digit prop
 * changes, React diffs the inline style; CSS transitions the
 * `transform` smoothly and the digit "rolls" to the new value. Only
 * the changing digit moves — leading digits that didn't change stay
 * visually static.
 *
 * Side effect (intentional, cute): copy-pasting the rendered text
 * yields the full "0123456789" column per digit slot, which is why
 * Codex's UI also reveals this when you select-and-copy. The visual
 * frame is the illusion.
 *
 * When the value grows in length (9 → 10), the outer component
 * re-renders with one more slot. CSS layout shifts; we don't try to
 * animate the slot-count change (a future polish if anyone cares).
 *
 * Accessibility: the outer span carries an `aria-label` with the
 * spoken value (e.g. "+47"). The digit slots are aria-hidden because
 * the per-digit DOM (0-9 columns) is meaningless to screen readers.
 *
 * Reduce-motion: respects `:root[data-reduce-motion="true"]` via CSS
 * (transitions are nulled out at the root selector).
 */

export interface DigitOdometerProps {
  /** Non-negative number to display. Negative values get the `-` sign
   * automatically; for "+N" prepend with `sign="+"`. */
  value: number
  /** Optional leading sign ('+' or '-'). When omitted, no sign is
   * rendered. When `sign="+"` and value is 0, renders "+0". */
  sign?: '+' | '-'
  /** Optional ARIA label override; falls back to `${sign ?? ''}${value}`. */
  ariaLabel?: string
  /** Forward an extra class for layout / colour treatments. */
  className?: string
}

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

export function DigitOdometer({
  value,
  sign,
  ariaLabel,
  className
}: DigitOdometerProps): JSX.Element {
  const digits = useMemo(() => digitSlotsForValue(value), [value])
  const label = ariaLabel ?? `${sign ?? ''}${digits.join('')}`

  return (
    <span className={`digit-odometer${className ? ' ' + className : ''}`} aria-label={label}>
      {sign && (
        <span className="digit-odometer__sign" aria-hidden>
          {sign}
        </span>
      )}
      {digits.map((d, i) => (
        // Slot key includes the total digit count so a length change
        // (e.g. 9 → 10) cleanly remounts the slot rather than
        // attempting to animate from the prior digit at a different
        // visual position. Within a stable length, the digit prop
        // changes and CSS transitions handle the roll.
        <DigitSlot key={`slot-${digits.length}-${i}`} digit={d} />
      ))}
    </span>
  )
}

function DigitSlot({ digit }: { digit: number }): JSX.Element {
  // CSS handles the transition: the column's translateY is the only
  // thing that changes per render. Critical that this inline style
  // is an inline `style` attribute (not a CSS variable) so the
  // browser's transition engine actually interpolates the value.
  const transform = `translateY(-${digit}em)`
  return (
    <span className="digit-odometer__slot" aria-hidden>
      <span className="digit-odometer__column" style={{ transform }}>
        {DIGITS.map((d) => (
          <span key={d} className="digit-odometer__cell">
            {d}
          </span>
        ))}
      </span>
    </span>
  )
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const
