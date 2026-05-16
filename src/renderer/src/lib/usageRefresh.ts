// Helpers for the sidebar "MODEL USAGE" background refresh loop. Pulled out
// of App.tsx so the cheap "did the usage payload change?" check is unit
// testable without a full React render. The companion refresh effect calls
// these helpers, but the loop itself lives in App.tsx because it needs to
// invoke the existing `refreshUsageSummary` closure.

import type { ProviderId } from '../../../main/store/types'

export interface UsageRefreshWindowFingerprint {
  id: string
  label: string
  limitLabel: string
  resetAt: string
  usedPercent: number | null
  remainingPercent: number | null
}

export interface UsageRefreshEntryFingerprint {
  provider: ProviderId
  model: string
  windows: UsageRefreshWindowFingerprint[]
}

export interface UsageSummaryLike {
  provider: ProviderId
  model: string
  windows?: Array<{
    id: string
    label: string
    limitLabel: string
    resetAt?: string
    usedPercent?: number
    remainingPercent?: number
  }>
}

/**
 * Produce a compact, stable fingerprint of the usage summary payload — only
 * the fields the sidebar meters actually render. Equal payloads (regardless
 * of object identity) produce equal strings, so consumers can `===` the
 * results to decide whether `setState` would be a no-op.
 */
export function fingerprintUsageSummary(summary: ReadonlyArray<UsageSummaryLike>): string {
  const ordered: UsageRefreshEntryFingerprint[] = summary.map((entry) => ({
    provider: entry.provider,
    model: entry.model,
    windows: (entry.windows || []).map((windowEntry) => ({
      id: windowEntry.id,
      label: windowEntry.label,
      limitLabel: windowEntry.limitLabel,
      resetAt: windowEntry.resetAt || '',
      usedPercent: typeof windowEntry.usedPercent === 'number' ? windowEntry.usedPercent : null,
      remainingPercent:
        typeof windowEntry.remainingPercent === 'number' ? windowEntry.remainingPercent : null
    }))
  }))
  return JSON.stringify(ordered)
}

/**
 * Returns true when the new payload differs from the previous one in a way
 * the sidebar would actually render. Used by the autonomous refresh loop to
 * avoid re-rendering when the provider snapshots came back identical.
 */
export function hasUsageSummaryChanged(
  prev: ReadonlyArray<UsageSummaryLike>,
  next: ReadonlyArray<UsageSummaryLike>
): boolean {
  return fingerprintUsageSummary(prev) !== fingerprintUsageSummary(next)
}

export interface UsageRefreshDecisionInput {
  /** Wall-clock ms since the last refresh kicked off; null/undefined when no prior run. */
  msSinceLastRefresh: number | null | undefined
  /** Refresh cadence in ms (e.g. 90_000). */
  intervalMs: number
  /** A previous refresh is still in flight. */
  inFlight: boolean
  /** The Electron window is currently focused. */
  windowFocused: boolean
  /** `navigator.onLine` value. */
  online: boolean
}

/**
 * Decide whether the autonomous refresh loop should fire right now. Pure
 * function so the policy can be unit-tested without setting up timers.
 *
 * The loop skips when:
 *   - a previous request is still in flight (avoid hammering IPC);
 *   - the window is blurred (no one is watching);
 *   - the user is offline (the data would be stale anyway);
 *   - too little wall-clock time has elapsed since the last attempt
 *     (cheap guard against jittery `setInterval` + focus-resume races).
 */
export function shouldRunUsageRefresh(input: UsageRefreshDecisionInput): boolean {
  if (input.inFlight) return false
  if (!input.windowFocused) return false
  if (!input.online) return false
  if (input.msSinceLastRefresh !== null && input.msSinceLastRefresh !== undefined) {
    // Guard against the focus-resume path racing the heartbeat fire — only
    // skip if we *just* refreshed. We still want hand-rolled focus refreshes
    // to win when they precede the interval tick.
    if (input.msSinceLastRefresh < Math.min(intervalFloor(input.intervalMs), 5_000)) {
      return false
    }
  }
  return true
}

function intervalFloor(intervalMs: number): number {
  // Allow at most one in-flight refresh per ~third of the cadence so a
  // focus-resume immediately after a heartbeat doesn't double-fire.
  return Math.max(1_000, Math.floor(intervalMs / 3))
}
