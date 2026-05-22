/*
 * QuotaProgressBar — Phase L6 slice 2.
 *
 * Per-window progress bar with a provider-colored fill that warms
 * through amber → red as the fill approaches the limit. Visual
 * grammar lifted from another-project's `QuotaProgressBar`
 * (`Shared/Views/QuotaCardView.swift:880-959`):
 *
 *   - Bar fill width === `fraction` (0..1).
 *   - Fill background is a left-to-right linear gradient with three
 *     stops: accent at 0, amber starting at `0.6 / fraction`, red
 *     at `0.9 / fraction`. When the fraction is below the warning
 *     thresholds those stops clamp to 1.0 (off the end of the fill),
 *     so the bar stays accent-coloured. As the fill grows past 60%
 *     of the limit the amber stop slides into view; past 90% the
 *     red stop appears. The fill therefore WARMS as it lengthens,
 *     rather than abruptly switching colour at a threshold.
 *
 * Pure presentational component. `pace` and the heatmap are wired
 * by slices 3 + 5.
 */
import type { ReactElement } from 'react'
import { paceColorHex, paceShouldSurface, type QuotaPace } from '../lib/QuotaPace'

interface QuotaProgressBarProps {
  /** Fill fraction, 0..1. Clamped to that range internally so
   * unexpected sentinel values (negative, NaN, >1) don't crash
   * the gradient calculation. */
  fraction: number
  /** CSS colour value for the accent stop at the start of the
   * gradient. Typically `var(--provider-{id}-color)`. */
  accent: string
  /** Optional className suffix for layout (e.g. nested inside a
   * differently-sized container). */
  className?: string
  /** When true, the bar takes a flatter, slightly taller treatment
   * so it reads cleanly inside heatmap headers / receipts etc.
   * Defaults to the standard 6px Model Usage Card bar. */
  emphasised?: boolean
  /** Phase L6 slice 3 — optional pace marker. When present and
   * `paceShouldSurface(pace) === true`, a small coloured tick paints
   * on the bar at `pace.expectedFraction`. Hidden silently for
   * `onTrack` windows. */
  pace?: QuotaPace | null
}

/**
 * Build the per-bar gradient. Stops are POSITIONS WITHIN THE FILL
 * (not within the track), so they only become visible when the
 * fill is wide enough to expose them. See file-level comment.
 */
function buildProgressGradient(fraction: number, accent: string): string {
  if (fraction <= 0) return 'transparent'
  const orangeStart = Math.min(1, 0.6 / fraction)
  const redStart = Math.min(1, 0.9 / fraction)
  return [
    'linear-gradient(90deg, ',
    `${accent} 0%, `,
    `var(--quota-warning-color, #F59E0B) ${(orangeStart * 100).toFixed(2)}%, `,
    `var(--quota-danger-color, #DC2626) ${(redStart * 100).toFixed(2)}%`,
    ')'
  ].join('')
}

export function QuotaProgressBar({
  fraction,
  accent,
  className,
  emphasised = false,
  pace = null
}: QuotaProgressBarProps): ReactElement {
  const clampedFraction = Number.isFinite(fraction)
    ? Math.max(0, Math.min(1, fraction))
    : 0
  // Render the fill at AT LEAST 3% width so a non-zero fraction
  // still produces a visible sliver. Pure-zero fractions render
  // an empty bar (no fill div).
  const renderFraction = clampedFraction > 0 && clampedFraction < 0.03 ? 0.03 : clampedFraction
  const widthPercent = renderFraction * 100
  const fillGradient = buildProgressGradient(clampedFraction, accent)
  const surfacePace = pace !== null && paceShouldSurface(pace)

  return (
    <div
      className={[
        'quota-progress-bar',
        emphasised ? 'quota-progress-bar-emphasised' : '',
        className ?? ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {clampedFraction > 0 && (
        <div
          className="quota-progress-fill"
          style={{
            width: `${widthPercent.toFixed(2)}%`,
            background: fillGradient
          }}
        />
      )}
      {surfacePace && pace && (
        <span
          className="quota-pace-tick"
          aria-hidden
          style={{
            left: `${(pace.expectedFraction * 100).toFixed(2)}%`,
            background: paceColorHex(pace)
          }}
        />
      )}
    </div>
  )
}
