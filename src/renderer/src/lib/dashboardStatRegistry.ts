/**
 * 1.0.5-EW49 — Single source-of-truth for the welcome dashboard's
 * dense stat grid. Keeps the Settings UI (show/hide + reset),
 * the dashboard builder (per-stat reset filter), and the
 * renderer chip list in lockstep — adding a new stat means
 * touching ONLY this file + the builder's compute path.
 *
 * The dense grid renders 12 stats after EW49 (was 9). Each stat
 * declares:
 *   - `key`         — stable id used in AppSettings + as the
 *                     dictionary key in resetAt / visibility.
 *                     Snake-case for parity with the
 *                     `WelcomeUsageDashboardData` field names.
 *   - `label`       — human-readable chip label
 *                     ("Current streak", "Longest thread", etc.).
 *   - `group`       — semantic family for the grid's grouped-row
 *                     layout (calendar · duration · volume ·
 *                     spend). Drives both the chip ordering and
 *                     the section grouping in the Settings UI.
 *   - `supportsReset` — false for derived-only metrics where
 *                     "reset" doesn't have a clear semantic (e.g.
 *                     Peak hour is a histogram derivation; the
 *                     user resets its contributing records via
 *                     other stats).
 */

export type DashboardStatGroup = 'calendar' | 'duration' | 'volume' | 'spend'

export interface DashboardStatDescriptor {
  key: string
  label: string
  group: DashboardStatGroup
  supportsReset: boolean
}

export const DASHBOARD_STAT_REGISTRY: DashboardStatDescriptor[] = [
  // ── Calendar family (days-based, always lifetime) ─────────
  {
    key: 'currentStreak',
    label: 'Current streak',
    group: 'calendar',
    supportsReset: true
  },
  {
    key: 'longestStreak',
    label: 'Longest streak',
    group: 'calendar',
    supportsReset: true
  },
  {
    key: 'activeDays',
    label: 'Active days',
    group: 'calendar',
    supportsReset: true
  },
  // ── Duration family (time-based; longest + cumulative are
  // lifetime; peak hour is range-scoped derivation) ─────────
  {
    key: 'longestThreadMs',
    label: 'Longest thread',
    group: 'duration',
    supportsReset: true
  },
  {
    key: 'totalWallTimeMs',
    label: 'Cumulative wall time',
    group: 'duration',
    supportsReset: true
  },
  {
    key: 'peakHour',
    label: 'Peak hour',
    group: 'duration',
    // Histogram derivation — "reset" doesn't have a clear
    // semantic distinct from resetting the contributing
    // records via the volume stats.
    supportsReset: false
  },
  // ── Volume family (count-based, range-scoped to 30 days
  // unless overridden by reset) ─────────────────────────────
  {
    key: 'sessions',
    label: 'Sessions',
    group: 'volume',
    supportsReset: true
  },
  {
    key: 'messages',
    label: 'Messages',
    group: 'volume',
    supportsReset: true
  },
  {
    key: 'totalTokens',
    label: 'Total tokens',
    group: 'volume',
    supportsReset: true
  },
  // ── Spend family (1.0.5-EW49 new additions) ───────────────
  {
    key: 'totalCostUsd',
    label: 'Total cost',
    group: 'spend',
    supportsReset: true
  },
  {
    key: 'avgSessionMs',
    label: 'Avg session',
    group: 'spend',
    supportsReset: true
  },
  {
    key: 'tokensPerSession',
    label: 'Tokens / session',
    group: 'spend',
    supportsReset: true
  }
]

/**
 * Convenience accessor for renderers that need to filter the
 * registry by group (e.g. the Settings UI lists each family in
 * its own sub-section). Returns descriptors in registry order.
 */
export function getDashboardStatsByGroup(group: DashboardStatGroup): DashboardStatDescriptor[] {
  return DASHBOARD_STAT_REGISTRY.filter((stat) => stat.group === group)
}

/**
 * Returns `true` when the stat key is visible per the user's
 * settings. Defaults to `true` (visible) when no preference
 * exists, so a freshly installed app shows the full grid.
 */
export function isDashboardStatVisible(
  visibility: Record<string, boolean> | undefined,
  key: string
): boolean {
  if (!visibility) return true
  const explicit = visibility[key]
  return explicit !== false
}

/**
 * Returns the configured reset timestamp for a stat (epoch ms).
 * `0` means "no reset, include all history". Used by the
 * dashboard builder to filter records per-stat — only records
 * with `record.timestamp >= resetAt` contribute.
 */
export function getDashboardStatResetAt(
  resetAt: Record<string, number> | undefined,
  key: string
): number {
  if (!resetAt) return 0
  const value = Number(resetAt[key])
  return Number.isFinite(value) && value > 0 ? value : 0
}
