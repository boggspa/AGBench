/**
 * 1.0.5-EW25 — Cost display formatter with user-selectable currency.
 *
 * Provider event payloads emit `cost_usd` verbatim (set in
 * `src/main/index.ts` at the run-stats accumulation site). This
 * module converts that USD value into the user's preferred display
 * currency (USD / GBP / EUR), with sensible "tiny amount" floors
 * so a $0.003 turn doesn't render as the slightly-misleading
 * `$0.00`.
 *
 * **Rates are STATIC approximations.** Live FX lookup is deferred
 * to 1.0.6 sub-slice c per Chris's release plan. The constants
 * below are accurate as of 2026-05-27 (approximate spot rates);
 * update them periodically until live-fetch lands. Hardcoded
 * single-direction rates intentionally — we only ever convert
 * USD → other, never the reverse, because providers always
 * report in USD.
 *
 * Locale handling: `Intl.NumberFormat` defaults to the user's
 * system locale for grouping/decimal separators, but the
 * currency code is always pinned. So a French user with
 * currency=USD sees `1 234,56 $US`; a UK user with currency=GBP
 * sees `£1,234.56`. Reasonable across all locales.
 */

export type DisplayCurrency = 'USD' | 'GBP' | 'EUR'

// 1.0.5-EW25 — Static FX rates, USD-relative. Update when these
// drift more than ~5%, or replace this whole module with live
// fetch when 1.0.6 sub-slice c lands. Rounded to 4 sig figs since
// we're rendering 2 decimal places anyway.
const FX_RATES_PER_USD: Record<DisplayCurrency, number> = {
  USD: 1,
  GBP: 0.79, // approx mid-2026 spot
  EUR: 0.92 // approx mid-2026 spot
}

// Per-currency floor for "tiny but non-zero" amounts. Pre-EW25
// the codebase rendered `<$0.01` to avoid a misleading `$0.00`
// when a turn cost was just below 1 cent; we mirror that floor
// in the user's chosen currency so the behaviour is consistent.
const FLOORS: Record<DisplayCurrency, { threshold: number; label: string }> = {
  USD: { threshold: 0.01, label: '<$0.01' },
  GBP: { threshold: 0.01, label: '<£0.01' },
  EUR: { threshold: 0.01, label: '<€0.01' }
}

/**
 * Format a USD amount for display in the user's chosen currency.
 *
 * Returns:
 *  - `''` for non-finite / non-positive amounts (callers depend
 *    on this falsy check to decide whether to render the cost
 *    segment at all — preserves pre-EW25 behaviour).
 *  - The per-currency "tiny" label (e.g. `<£0.01`) for
 *    positive-but-sub-floor amounts.
 *  - A properly localised currency string for everything else.
 *
 * @param usd  Original USD value from provider event payload.
 * @param currency  User's selected display currency.
 * @param locale  Optional locale override. Defaults to system locale
 *                (`undefined` → `Intl.NumberFormat` picks the
 *                browser/Electron locale).
 */
export function formatCost(
  usd: number,
  currency: DisplayCurrency = 'USD',
  locale?: string
): string {
  if (!Number.isFinite(usd) || usd <= 0) return ''
  const rate = FX_RATES_PER_USD[currency] ?? 1
  const converted = usd * rate
  const floor = FLOORS[currency]
  if (converted < floor.threshold) return floor.label
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(converted)
  } catch {
    // Fallback for environments without full ICU — render the
    // bare number with a currency-prefix symbol. Shouldn't fire
    // in normal Electron, but keeps us robust.
    const symbol = currency === 'USD' ? '$' : currency === 'GBP' ? '£' : '€'
    return `${symbol}${converted.toFixed(2)}`
  }
}

/**
 * Format a USD amount as the "always-visible" cumulative chip
 * variant — same as `formatCost` but returns the per-currency
 * `0.00` placeholder when the amount is zero/missing instead of
 * an empty string. Used by the chat-level cumulative chip
 * (1.0.5-EW26) where we want a persistent surface even before
 * any tokens have been spent, so the user knows the chip exists.
 */
export function formatCostAlwaysOn(
  usd: number,
  currency: DisplayCurrency = 'USD',
  locale?: string
): string {
  const formatted = formatCost(usd, currency, locale)
  if (formatted) return formatted
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(0)
  } catch {
    const symbol = currency === 'USD' ? '$' : currency === 'GBP' ? '£' : '€'
    return `${symbol}0.00`
  }
}
