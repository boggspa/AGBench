/**
 * 1.0.5-EW35 — Currency sub-slice (c): live FX rate refresh.
 *
 * Background service that fetches USD-base GBP/EUR rates from a
 * free public API, caches the result to `<userData>/fx-rates.json`,
 * and exposes the current snapshot via IPC. The renderer's
 * `formatCost` module reads this on app boot and hot-swaps its
 * in-memory rate table; until the first fetch lands (or as a
 * fallback if both live + cache fail) it keeps using the baked-in
 * EW25 constants.
 *
 * **API choice**: `open.er-api.com/v6/latest/USD` — no API key, no
 * rate limit beyond fair-use, returns a stable `{ result, rates }`
 * envelope. If this provider goes away we swap the URL + the
 * parser without touching the rest of the codebase. See
 * https://www.exchangerate-api.com/docs/free for the contract.
 *
 * **Cache strategy**: 12h refresh interval. The scheduler is
 * `unref`'d so it doesn't keep the Electron main process alive
 * past app quit. We also support a "force" refresh entry point
 * for the renderer to call when the user explicitly hits a
 * refresh button (not wired yet — debug surface for 1.0.7).
 *
 * **Fallback ladder** (in `refreshFxRates`):
 *   1. Try live fetch. If it succeeds + parses, that becomes the
 *      new snapshot + we persist to disk.
 *   2. If live fails, return the in-memory snapshot (if any).
 *   3. If no in-memory snapshot, try reading the cache file.
 *   4. If the cache file is missing / malformed, fall back to a
 *      synthetic snapshot built from the baked-in `FALLBACK_RATES`
 *      with `source: 'fallback'` so callers can choose to display
 *      "rates may be stale" copy.
 *
 * The pure helpers (`parseFxApiPayload`, `parseCachedSnapshot`,
 * `isSnapshotStale`, `serialiseSnapshot`) are exported so the
 * test suite can exercise them without network / filesystem.
 */

import { app } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'

export type DisplayCurrency = 'USD' | 'GBP' | 'EUR'

export interface FxRateMap {
  USD: 1
  GBP: number
  EUR: number
}

export interface FxRateSnapshot {
  rates: FxRateMap
  fetchedAt: string // ISO 8601
  source: 'live' | 'cached' | 'fallback'
  /** Optional error from the most recent failed fetch attempt.
   * Surfaced to the renderer so settings UI can show "tried to
   * refresh, network unavailable" copy without leaking the
   * underlying error string into the formatter. */
  errorMessage?: string
}

const CACHE_FILENAME = 'fx-rates.json'
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000 // 12 hours
const FETCH_TIMEOUT_MS = 10_000
const FX_ENDPOINT = 'https://open.er-api.com/v6/latest/USD'

/** 1.0.5-EW25 baked-in static rates. Kept here so the fallback path
 * doesn't depend on the renderer importing from main. Match
 * `formatCost.ts` so renderer-only smoke (no IPC) stays consistent
 * with main-driven mode. */
const FALLBACK_RATES: FxRateMap = { USD: 1, GBP: 0.79, EUR: 0.92 }

let cachedSnapshot: FxRateSnapshot | null = null
let refreshTimer: NodeJS.Timeout | null = null

function cachePath(): string {
  return join(app.getPath('userData'), CACHE_FILENAME)
}

/**
 * Pure validator/parser for the public FX API response shape.
 * Exported for tests. Returns `null` on any structural mismatch so
 * the caller can fall back cleanly.
 *
 * Contract (open.er-api.com):
 *   { result: 'success', rates: { GBP: 0.79, EUR: 0.92, ... }, ... }
 *
 * We validate:
 *   - `result === 'success'`
 *   - `rates.GBP` is a finite positive number
 *   - `rates.EUR` is a finite positive number
 *
 * Other rate keys are ignored (we only display GBP/EUR for now).
 */
export function parseFxApiPayload(payload: unknown): FxRateMap | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  if (p.result !== 'success') return null
  const rates = p.rates as Record<string, unknown> | undefined
  if (!rates) return null
  const gbp = rates.GBP
  const eur = rates.EUR
  if (
    typeof gbp !== 'number' ||
    typeof eur !== 'number' ||
    !Number.isFinite(gbp) ||
    !Number.isFinite(eur) ||
    gbp <= 0 ||
    eur <= 0
  ) {
    return null
  }
  return { USD: 1, GBP: gbp, EUR: eur }
}

/**
 * Pure parser for cache-file contents. Accepts both a complete
 * snapshot (with fetchedAt) and a minimal `{ rates, fetchedAt }`
 * envelope. Returns `null` for any structural problem so we can
 * detect a tampered / corrupted cache and fall back to fetching
 * fresh.
 */
export function parseCachedSnapshot(raw: string): FxRateSnapshot | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>
  const fetchedAt = p.fetchedAt
  if (typeof fetchedAt !== 'string') return null
  if (!Number.isFinite(Date.parse(fetchedAt))) return null
  const rates = p.rates as Record<string, unknown> | undefined
  if (!rates) return null
  const gbp = rates.GBP
  const eur = rates.EUR
  if (
    typeof gbp !== 'number' ||
    typeof eur !== 'number' ||
    !Number.isFinite(gbp) ||
    !Number.isFinite(eur) ||
    gbp <= 0 ||
    eur <= 0
  ) {
    return null
  }
  return {
    rates: { USD: 1, GBP: gbp, EUR: eur },
    fetchedAt,
    source: 'cached'
  }
}

/**
 * Returns `true` when the snapshot is older than the refresh
 * interval or is missing/unreadable timestamp. `now` is injected
 * for testability.
 */
export function isSnapshotStale(
  snapshot: FxRateSnapshot | null,
  now: number = Date.now()
): boolean {
  if (!snapshot) return true
  const fetchedAt = Date.parse(snapshot.fetchedAt)
  if (!Number.isFinite(fetchedAt)) return true
  return now - fetchedAt > REFRESH_INTERVAL_MS
}

/**
 * Pure serialiser for cache persistence. We strip the `source`
 * field on disk because it'd always be `'cached'` after a reload;
 * the live/fallback labels are reconstructed in-memory.
 */
export function serialiseSnapshot(snapshot: FxRateSnapshot): string {
  return JSON.stringify({ rates: snapshot.rates, fetchedAt: snapshot.fetchedAt }, null, 2)
}

async function loadCached(): Promise<FxRateSnapshot | null> {
  try {
    const raw = await fs.readFile(cachePath(), 'utf-8')
    return parseCachedSnapshot(raw)
  } catch {
    return null
  }
}

async function persistSnapshot(snapshot: FxRateSnapshot): Promise<void> {
  try {
    await fs.writeFile(cachePath(), serialiseSnapshot(snapshot), 'utf-8')
  } catch {
    // Best-effort. A failed write doesn't break runtime — we still
    // have the in-memory snapshot. Next refresh will retry.
  }
}

async function fetchLive(): Promise<{ rates: FxRateMap; errorMessage?: string } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(FX_ENDPOINT, { signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) {
      return { rates: FALLBACK_RATES, errorMessage: `HTTP ${response.status}` }
    }
    const payload = await response.json()
    const rates = parseFxApiPayload(payload)
    if (!rates) {
      return { rates: FALLBACK_RATES, errorMessage: 'Unexpected response shape' }
    }
    return { rates }
  } catch (error) {
    clearTimeout(timer)
    return {
      rates: FALLBACK_RATES,
      errorMessage: error instanceof Error ? error.message : 'fetch failed'
    }
  }
}

/**
 * Read-side accessor used by the IPC handler. Returns whatever is
 * currently cached in-memory, or a synthetic fallback if nothing
 * has been loaded yet (very-early boot, before the scheduler's
 * initial fetch completes).
 */
export function getCurrentFxRates(): FxRateSnapshot {
  if (cachedSnapshot) return cachedSnapshot
  return {
    rates: FALLBACK_RATES,
    fetchedAt: new Date(0).toISOString(),
    source: 'fallback'
  }
}

/**
 * Best-effort refresh. Live first; on failure, falls back to the
 * existing in-memory snapshot, then to the cache file, then to the
 * baked-in constants. Always returns a usable snapshot — never
 * throws.
 *
 * `force=true` bypasses the staleness check (use for the scheduler's
 * initial-fetch and any future "refresh now" UI).
 */
export async function refreshFxRates(force: boolean = false): Promise<FxRateSnapshot> {
  if (!force && cachedSnapshot && !isSnapshotStale(cachedSnapshot)) {
    return cachedSnapshot
  }
  const live = await fetchLive()
  if (live && !live.errorMessage) {
    cachedSnapshot = {
      rates: live.rates,
      fetchedAt: new Date().toISOString(),
      source: 'live'
    }
    void persistSnapshot(cachedSnapshot)
    return cachedSnapshot
  }
  // Live fetch failed or returned malformed data. Try cache if
  // we don't already have an in-memory snapshot.
  if (!cachedSnapshot) {
    const cached = await loadCached()
    if (cached) {
      cachedSnapshot = cached
      return cached
    }
  }
  // Still nothing — return whatever we have, or synthesise a
  // fallback snapshot. Pin the recent error message so the
  // settings UI can explain why rates are stale.
  if (cachedSnapshot) {
    cachedSnapshot = { ...cachedSnapshot, errorMessage: live?.errorMessage }
    return cachedSnapshot
  }
  cachedSnapshot = {
    rates: FALLBACK_RATES,
    fetchedAt: new Date(0).toISOString(),
    source: 'fallback',
    errorMessage: live?.errorMessage
  }
  return cachedSnapshot
}

/**
 * Start the background refresh scheduler. Idempotent — safe to call
 * multiple times; previous timer is cleared. The initial fetch
 * runs immediately (best-effort, async) so the first IPC read
 * after app ready gets live rates as soon as the network round-trip
 * resolves.
 */
export function startFxRateScheduler(): void {
  if (refreshTimer) clearInterval(refreshTimer)
  // Initial load: prefer cache (fast, offline-safe) then kick off
  // a live refresh in the background. The kickoff is fire-and-
  // forget — if it fails the cache wins; if it succeeds the next
  // IPC read gets fresh data.
  void (async () => {
    if (!cachedSnapshot) {
      const cached = await loadCached()
      if (cached) cachedSnapshot = cached
    }
    void refreshFxRates(true)
  })()
  refreshTimer = setInterval(() => {
    void refreshFxRates(false)
  }, REFRESH_INTERVAL_MS)
  refreshTimer.unref?.()
}

export function stopFxRateScheduler(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

/**
 * Test-only reset. Clears the in-memory snapshot + timer so each
 * test starts from a clean slate. Not exposed to runtime callers.
 */
export function __resetFxRateServiceForTesting(): void {
  cachedSnapshot = null
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}
