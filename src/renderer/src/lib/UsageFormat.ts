/*
 * UsageFormat — Phase L6 slice 1.
 *
 * Pure formatters extracted from Sidebar.tsx so the new
 * `ModelUsageCard` and its inner blocks can render reset timestamps
 * without depending on Sidebar internals. No state, no React — safe
 * to import from any layer (renderer or shared).
 */

interface ResetSource {
  /** ISO string the provider returns when it knows a precise reset
   * timestamp (Codex / Claude / Kimi quota endpoints). */
  resetAt?: string
  /** Pre-formatted free-text fallback the provider may include
   * (e.g. "in 5 hours"). Used when `resetAt` isn't available. */
  resetText?: string
}

/**
 * Format a quota-window reset timestamp for display in the
 * Model Usage Card.
 *
 * Behaviour matches the original Sidebar implementation exactly:
 *   - Same calendar day  → 24-hour `HH:MM` (e.g. `18:28`)
 *   - Same year, different day → `23 May`
 *   - Different year → `23 May 2025`
 *   - No parseable ISO → fall through to `resetText` (or undefined)
 *
 * Returns `undefined` when no usable reset info is available so the
 * caller can decide whether to omit the "resets …" line entirely.
 */
export function formatResetShort(entry: ResetSource): string | undefined {
  if (entry.resetAt) {
    const parsed = new Date(entry.resetAt)
    if (!Number.isNaN(parsed.getTime())) {
      const now = new Date()
      const sameDay =
        parsed.getFullYear() === now.getFullYear() &&
        parsed.getMonth() === now.getMonth() &&
        parsed.getDate() === now.getDate()
      const sameYear = parsed.getFullYear() === now.getFullYear()

      if (sameDay) {
        return parsed.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        })
      }

      const dateOptions: Intl.DateTimeFormatOptions = sameYear
        ? { day: 'numeric', month: 'short' }
        : { day: 'numeric', month: 'short', year: 'numeric' }

      return parsed.toLocaleDateString('en-GB', dateOptions)
    }
  }
  return entry.resetText
}
