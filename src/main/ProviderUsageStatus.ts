import type {
  NormalizedProviderUsageSnapshot,
  NormalizedProviderUsageWindow
} from './ProviderQuotaSnapshots'
import type { ProviderId } from './store/types'

/**
 * 1.0.4-AR9 — Coarse quota-band view used by the
 * `provider_usage_status` MCP tool.
 *
 * Pre-AR9 agents had `provider_auth_status` to know whether they
 * were authenticated, but no way to know whether the underlying
 * window had headroom. That gap nudged panels into churning
 * heavy-context turns right up to a hard rate-limit cliff, then
 * getting kicked out with a 429 mid-round.
 *
 * The tool returns a `band` per usage window — one of:
 *   - `'low'`      (< 30% used)
 *   - `'medium'`   (30–69%)
 *   - `'high'`     (70–89%)
 *   - `'critical'` (>= 90%)
 *   - `'unknown'`  (no usage data yet, or stale snapshot
 *                   without numeric usedPercent)
 *
 * Bands are intentionally chunky — the agent shouldn't be
 * micro-tuning behaviour on percent deltas; this is a "should I
 * pick a cheaper model for the next turn?" signal, not a
 * cost-precise budget. Per the AT spec / panel-review item:
 * "coarse quota bands".
 *
 * Pure module; the actual snapshot fetch happens in the caller
 * (`index.ts:executeProviderUsageStatus`) because that lives
 * inside Electron's main process and needs `AppStore`.
 */

export type ProviderUsageBand = 'low' | 'medium' | 'high' | 'critical' | 'unknown'

export interface ProviderUsageWindowSummary {
  /** Window id from the underlying snapshot (preserved so the
   * agent can correlate with raw usage panels). */
  id: string
  /** Human-readable label, e.g. "5h", "Weekly", "Pro". */
  label: string
  band: ProviderUsageBand
  /** Underlying usedPercent (0–100). Included for agents that
   * want a sharper signal than the band; `undefined` when the
   * snapshot didn't carry one. */
  usedPercent?: number
  /** ISO timestamp when the window resets, if known. */
  resetAt?: string
}

export interface ProviderUsageSummary {
  provider: ProviderId
  /** When false, the provider has no usage data (auth missing,
   * snapshot never fetched, etc). Bands are all `'unknown'`. */
  configured: boolean
  /** Source identifier from the underlying snapshot (e.g.
   * `"codex-account"`, `"gemini-pro"`). May be null when the
   * fetch path didn't tag a source. */
  source: string | null
  /** True when the snapshot we're surfacing was the cached one
   * (auth stale, last refresh failed) — agents may want to weight
   * this lower. */
  stale: boolean
  /** ISO timestamp of the underlying snapshot fetch, if known. */
  fetchedAt?: string
  /** The "worst" band across all windows — useful for agents that
   * only want one summary signal. `'unknown'` when no windows
   * carry usage data. */
  worstBand: ProviderUsageBand
  windows: ProviderUsageWindowSummary[]
}

const BAND_ORDER: Record<ProviderUsageBand, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
}

/**
 * Map a 0–100 usedPercent to a coarse band. The bins are
 * deliberately wide so a small movement (49 → 51) doesn't flip
 * the agent's behaviour. `undefined` / non-finite → `'unknown'`.
 */
export function bandForUsedPercent(usedPercent: number | undefined): ProviderUsageBand {
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) return 'unknown'
  if (usedPercent >= 90) return 'critical'
  if (usedPercent >= 70) return 'high'
  if (usedPercent >= 30) return 'medium'
  if (usedPercent >= 0) return 'low'
  return 'unknown'
}

function summarizeWindow(window: NormalizedProviderUsageWindow): ProviderUsageWindowSummary {
  const usedPercent =
    typeof window.usedPercent === 'number' && Number.isFinite(window.usedPercent)
      ? Math.max(0, Math.min(100, window.usedPercent))
      : undefined
  return {
    id: window.id,
    label: window.label,
    band: bandForUsedPercent(usedPercent),
    ...(usedPercent !== undefined ? { usedPercent } : {}),
    ...(window.resetAt ? { resetAt: window.resetAt } : {})
  }
}

export function summarizeProviderUsage(
  provider: ProviderId,
  snapshot: NormalizedProviderUsageSnapshot | null | undefined
): ProviderUsageSummary {
  if (!snapshot) {
    return {
      provider,
      configured: false,
      source: null,
      stale: false,
      worstBand: 'unknown',
      windows: []
    }
  }
  const windows = Array.isArray(snapshot.windows) ? snapshot.windows.map(summarizeWindow) : []
  const worstBand: ProviderUsageBand = windows.reduce<ProviderUsageBand>(
    (worst, w) => (BAND_ORDER[w.band] > BAND_ORDER[worst] ? w.band : worst),
    'unknown'
  )
  return {
    provider,
    configured: Boolean(snapshot.configured),
    source: snapshot.source ?? null,
    stale: Boolean(snapshot.stale),
    ...(snapshot.fetchedAt ? { fetchedAt: snapshot.fetchedAt } : {}),
    worstBand,
    windows
  }
}
