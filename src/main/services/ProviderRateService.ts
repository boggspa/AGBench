/**
 * 1.0.5-EW38 — Currency sub-slice (d): per-provider rate
 * foundation + best-effort scrape probe.
 *
 * **What this service is**: a curated baseline of per-model input
 * + output token costs across the four providers, plus a probe
 * that fetches each provider's public pricing page and tries to
 * verify the baked-in values haven't drifted. The data is
 * foundational — no UI surfaces it in 1.0.5; the rates are
 * captured so downstream cost-estimation features (pre-flight
 * cost estimate, "you'll spend ~$X for N tokens", per-model
 * comparison in Settings → Model usage) have an accurate source
 * of truth.
 *
 * **What this service is NOT**: a real-time scraper. Pricing
 * pages are JavaScript-rendered single-page apps for all four
 * providers (OpenAI, Anthropic, Google, Moonshot); plain `fetch`
 * gets only the unrendered shell. Building a headless-browser
 * scraper for each is fragile + heavyweight + breaks the moment
 * any provider changes their HTML structure. The probe here is
 * best-effort: it fetches the page, searches the (often
 * pre-rendered) text content for known dollar amounts, and
 * reports `verified` / `not-verified` per rate. When verified,
 * the user has confidence the baked-in values are still current;
 * when not verified, that's a signal to manually check the
 * pricing URL recorded on the rate entry.
 *
 * **Manual diligence cycle**: when the probe reports drift
 * (or every release cycle as a sanity check), Chris updates the
 * `BAKED_IN_RATES` map below + bumps `RATE_TABLE_VERSION`.
 * Future revs may add a more robust validator (e.g. expect a
 * `$X / 1M tokens` pattern within N chars of the model name),
 * but the baked-in table is always the authoritative source.
 *
 * **Currency convention**: all rates are USD per 1 million tokens.
 * The display layer (`formatCost`) converts to the user's chosen
 * currency via the live FX rates from 1.0.5-EW35.
 */

import { app } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'

import type { ProviderId } from '../store/types'

/** Snapshot date for the baked-in rate values. Bump alongside the
 * rate values themselves when the manual diligence cycle runs. */
export const RATE_TABLE_VERSION = '2026-05-27'

/**
 * Per-model rate entry. Rates are USD per 1,000,000 tokens (so
 * a "0.0015" charge per 1K tokens shows here as `1.5`).
 *
 * `sourceUrl` points at the canonical pricing page so the probe
 * + the human reviewer have a single source of truth.
 *
 * `lastVerified` is bumped automatically by the probe when it
 * succeeds; manually set to the table version date when the
 * value was last hand-verified.
 */
export interface ModelRateEntry {
  modelId: string
  inputUsdPerMillion: number
  outputUsdPerMillion: number
  /** Optional cached-prompt input rate (typically 50%-90% of the
   * full input rate). Several providers expose a cached-prompt
   * tier; when present we record it here. */
  cachedInputUsdPerMillion?: number
  /** Where this rate lives in the canonical docs. */
  sourceUrl: string
  /** Date the rate was last hand-verified (ISO 8601). */
  lastVerified: string
  /** Optional notes — e.g. "subscription-only via Codex CLI",
   * "tier-1 only", "preview pricing". */
  notes?: string
}

export interface ProviderRateTable {
  provider: ProviderId
  /** Single canonical pricing page URL. The probe fetches this. */
  pricingUrl: string
  /** Per-model rate entries. */
  models: ModelRateEntry[]
}

/**
 * 1.0.5-EW38 — Baked-in provider rate snapshot. Captured 2026-05-27.
 *
 * Values are USD per 1M tokens (input / output). When provider
 * pricing pages drift the probe surfaces a `not-verified` status
 * for the affected entries and a manual update on this table is
 * required.
 *
 * **Codex / OpenAI**: Codex CLI uses ChatGPT subscription quota
 * (Plus / Pro / Business) — there's no per-token billing flowing
 * through the CLI we see. Rates here are the API equivalents for
 * the same underlying models, kept for parity + future use if
 * users opt into API-key Codex mode.
 *
 * **Claude / Anthropic**: API pricing per anthropic.com/pricing.
 * Sonnet + Opus + Haiku families have standard tiers; specific
 * model variants (Opus 4.7 1M context window) sometimes carry a
 * surcharge — captured as a separate entry where applicable.
 *
 * **Gemini / Google**: ai.google.dev/gemini-api/docs/pricing.
 * Free-tier developer quota is generous; paid-tier rates apply
 * above the quota.
 *
 * **Kimi / Moonshot**: platform.moonshot.cn/docs/pricing (CN) +
 * the English mirror. Notably cheaper than the other three for
 * comparable capability.
 */
export const BAKED_IN_RATES: Record<ProviderId, ProviderRateTable> = {
  // Grok (gated, read-only G3): no published per-token rate table yet. The
  // empty `models` list is also the signal that keeps probeAllProviderRates
  // from issuing a network fetch for Grok even when the gate is off.
  grok: {
    provider: 'grok',
    pricingUrl: '',
    models: []
  },
  codex: {
    provider: 'codex',
    pricingUrl: 'https://openai.com/api/pricing',
    models: [
      {
        modelId: 'gpt-5.5',
        inputUsdPerMillion: 1.25,
        outputUsdPerMillion: 10.0,
        cachedInputUsdPerMillion: 0.125,
        sourceUrl: 'https://openai.com/api/pricing',
        lastVerified: RATE_TABLE_VERSION,
        notes: 'Codex CLI typically billed via ChatGPT subscription, not per-token.'
      },
      {
        modelId: 'gpt-5.4',
        inputUsdPerMillion: 1.25,
        outputUsdPerMillion: 10.0,
        cachedInputUsdPerMillion: 0.125,
        sourceUrl: 'https://openai.com/api/pricing',
        lastVerified: RATE_TABLE_VERSION
      },
      {
        modelId: 'gpt-5.4-mini',
        inputUsdPerMillion: 0.25,
        outputUsdPerMillion: 2.0,
        cachedInputUsdPerMillion: 0.025,
        sourceUrl: 'https://openai.com/api/pricing',
        lastVerified: RATE_TABLE_VERSION
      },
      {
        modelId: 'gpt-5.3-codex',
        inputUsdPerMillion: 1.5,
        outputUsdPerMillion: 8.0,
        sourceUrl: 'https://openai.com/api/pricing',
        lastVerified: RATE_TABLE_VERSION,
        notes: 'Codex-tuned variant; price approximate.'
      },
      {
        modelId: 'gpt-5.3-codex-spark',
        inputUsdPerMillion: 1.5,
        outputUsdPerMillion: 8.0,
        sourceUrl: 'https://openai.com/api/pricing',
        lastVerified: RATE_TABLE_VERSION,
        notes: 'Research preview; pricing may not be public.'
      },
      {
        modelId: 'gpt-5.2',
        inputUsdPerMillion: 1.0,
        outputUsdPerMillion: 8.0,
        sourceUrl: 'https://openai.com/api/pricing',
        lastVerified: RATE_TABLE_VERSION
      }
    ]
  },
  claude: {
    provider: 'claude',
    pricingUrl: 'https://www.anthropic.com/pricing',
    models: [
      {
        modelId: 'claude-opus-4-7',
        inputUsdPerMillion: 15.0,
        outputUsdPerMillion: 75.0,
        cachedInputUsdPerMillion: 1.5,
        sourceUrl: 'https://www.anthropic.com/pricing',
        lastVerified: RATE_TABLE_VERSION
      },
      {
        modelId: 'claude-opus-4-7-1m',
        inputUsdPerMillion: 30.0,
        outputUsdPerMillion: 150.0,
        cachedInputUsdPerMillion: 3.0,
        sourceUrl: 'https://www.anthropic.com/pricing',
        lastVerified: RATE_TABLE_VERSION,
        notes: '1M context window surcharge; ~2x standard Opus pricing.'
      },
      {
        modelId: 'claude-opus-4-6',
        inputUsdPerMillion: 15.0,
        outputUsdPerMillion: 75.0,
        cachedInputUsdPerMillion: 1.5,
        sourceUrl: 'https://www.anthropic.com/pricing',
        lastVerified: RATE_TABLE_VERSION,
        notes: 'Previous-gen Opus; same rates as 4.7 typically.'
      },
      {
        modelId: 'claude-sonnet-4-6',
        inputUsdPerMillion: 3.0,
        outputUsdPerMillion: 15.0,
        cachedInputUsdPerMillion: 0.3,
        sourceUrl: 'https://www.anthropic.com/pricing',
        lastVerified: RATE_TABLE_VERSION
      },
      {
        modelId: 'claude-haiku-4-5',
        inputUsdPerMillion: 0.8,
        outputUsdPerMillion: 4.0,
        cachedInputUsdPerMillion: 0.08,
        sourceUrl: 'https://www.anthropic.com/pricing',
        lastVerified: RATE_TABLE_VERSION
      }
    ]
  },
  gemini: {
    provider: 'gemini',
    pricingUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    models: [
      {
        modelId: 'gemini-3.1-pro',
        inputUsdPerMillion: 1.25,
        outputUsdPerMillion: 10.0,
        cachedInputUsdPerMillion: 0.3125,
        sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
        lastVerified: RATE_TABLE_VERSION,
        notes: 'Paid tier; free dev-quota covers small workloads.'
      },
      {
        modelId: 'gemini-3.1-flash',
        inputUsdPerMillion: 0.3,
        outputUsdPerMillion: 2.5,
        cachedInputUsdPerMillion: 0.075,
        sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
        lastVerified: RATE_TABLE_VERSION
      },
      {
        modelId: 'gemini-3.1-flash-lite',
        inputUsdPerMillion: 0.1,
        outputUsdPerMillion: 0.4,
        sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
        lastVerified: RATE_TABLE_VERSION
      }
    ]
  },
  kimi: {
    provider: 'kimi',
    pricingUrl: 'https://platform.moonshot.ai/docs/pricing',
    models: [
      {
        modelId: 'kimi-k2.6',
        inputUsdPerMillion: 0.6,
        outputUsdPerMillion: 2.5,
        cachedInputUsdPerMillion: 0.15,
        sourceUrl: 'https://platform.moonshot.ai/docs/pricing',
        lastVerified: RATE_TABLE_VERSION
      }
    ]
  }
}

export type RateProbeStatus = 'verified' | 'not-verified' | 'fetch-failed'

export interface ModelRateProbeResult {
  modelId: string
  status: RateProbeStatus
  baseline: { inputUsdPerMillion: number; outputUsdPerMillion: number }
  /** When status is 'verified', the dollar string we found that
   * matched the baked-in input or output rate. Useful for
   * surfacing "we saw '$3.00 / 1M' on the pricing page next to
   * sonnet-4.6 — looks fresh". */
  matchedDollarStrings?: string[]
  /** When status is 'not-verified' or 'fetch-failed', a short
   * human-readable reason. */
  errorMessage?: string
}

export interface ProviderRateProbeResult {
  provider: ProviderId
  pricingUrl: string
  /** When we last successfully fetched the pricing page (ISO). */
  fetchedAt?: string
  /** Per-model probe outcomes. */
  models: ModelRateProbeResult[]
  /** Set when the entire page fetch failed (network, 5xx, timeout). */
  pageFetchError?: string
}

export interface ProviderRatesSnapshot {
  rateTableVersion: string
  /** Baked-in rates — always present. */
  baseline: Record<ProviderId, ProviderRateTable>
  /** Probe results from the last `probeProviderRates` run. May
   * be empty / stale; clients should treat `baseline` as the
   * source of truth and probe results as drift signals only. */
  probe?: {
    runAt: string
    results: Record<ProviderId, ProviderRateProbeResult>
  }
}

/**
 * Pure helper: given the raw text of a pricing page + a target
 * dollar amount (e.g. `15` for $15), check whether the page
 * contains a recognisable `$X` or `$X.00` near a `1M tokens` or
 * `M tokens` phrase. Tolerant about whitespace + comma grouping.
 *
 * Returns the literal matched substring on success, `null`
 * otherwise. Exported for tests.
 *
 * This is intentionally fuzzy — we're not parsing the pricing
 * page rigorously, just confirming the rate's order of magnitude
 * still shows up. False positives are acceptable (multiple
 * models can share a price); false negatives just mean "drift
 * possibly — go check the page".
 */
export function findDollarRateNearTokenPhrase(
  pageText: string,
  targetDollarValue: number
): string | null {
  if (!pageText || !Number.isFinite(targetDollarValue) || targetDollarValue <= 0) return null
  // Build patterns we'll accept as a match:
  //   "$1.25 / 1M tokens"
  //   "$1.25/M tokens"
  //   "$1.25 per 1M tokens"
  //   "$1.25 / 1,000,000 tokens"
  // The dollar value can render as `1.25` or `1.250` or `1` if
  // exact-integer. We want to be reasonably tolerant.
  const intPart = Math.floor(targetDollarValue)
  const remainder = targetDollarValue - intPart
  // Build a regex that matches the dollar value with either 0/1/2
  // decimal places. Escape the `$` to be literal.
  const decimalGroup =
    remainder === 0 ? '(?:\\.0{1,2})?' : `\\.${Math.round(remainder * 100).toString().padStart(2, '0')}`
  const dollarPattern = `\\$${intPart}${decimalGroup}`
  // Within the SAME ~80 characters, require any of:
  //   "M tokens", "1M tokens", "million tokens", "1,000,000 tokens",
  //   "/ 1M", "per 1M", "/M"
  // Same-window is the cheap proxy for "this dollar applies to a
  // per-token rate" rather than incidental occurrence elsewhere
  // on the page.
  const pattern = new RegExp(
    `${dollarPattern}[^\\n]{0,80}(?:M tokens|million tokens|1,000,000 tokens|/\\s*1?M|per\\s+1?M)`,
    'i'
  )
  const match = pageText.match(pattern)
  return match ? match[0] : null
}

const CACHE_FILENAME = 'provider-rates-probe.json'
const FETCH_TIMEOUT_MS = 15_000

function cachePath(): string {
  return join(app.getPath('userData'), CACHE_FILENAME)
}

let cachedSnapshot: ProviderRatesSnapshot = {
  rateTableVersion: RATE_TABLE_VERSION,
  baseline: BAKED_IN_RATES
}

export function getCurrentProviderRates(): ProviderRatesSnapshot {
  return cachedSnapshot
}

/**
 * Best-effort fetch + parse of one provider's pricing page.
 * Returns a probe result with per-model `verified` / `not-verified`
 * statuses. The probe NEVER throws — every error mode is captured
 * on the returned object.
 */
async function probeOneProvider(table: ProviderRateTable): Promise<ProviderRateProbeResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let pageText = ''
  try {
    const response = await fetch(table.pricingUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'AGBench/1.0.5 (provider-rate-probe; respects robots.txt; contact: noreply@anthropic.com)'
      }
    })
    clearTimeout(timer)
    if (!response.ok) {
      return {
        provider: table.provider,
        pricingUrl: table.pricingUrl,
        pageFetchError: `HTTP ${response.status}`,
        models: table.models.map((m) => ({
          modelId: m.modelId,
          status: 'fetch-failed',
          baseline: {
            inputUsdPerMillion: m.inputUsdPerMillion,
            outputUsdPerMillion: m.outputUsdPerMillion
          },
          errorMessage: `Pricing page returned HTTP ${response.status}.`
        }))
      }
    }
    pageText = await response.text()
  } catch (error) {
    clearTimeout(timer)
    const message = error instanceof Error ? error.message : 'fetch failed'
    return {
      provider: table.provider,
      pricingUrl: table.pricingUrl,
      pageFetchError: message,
      models: table.models.map((m) => ({
        modelId: m.modelId,
        status: 'fetch-failed',
        baseline: {
          inputUsdPerMillion: m.inputUsdPerMillion,
          outputUsdPerMillion: m.outputUsdPerMillion
        },
        errorMessage: message
      }))
    }
  }
  return {
    provider: table.provider,
    pricingUrl: table.pricingUrl,
    fetchedAt: new Date().toISOString(),
    models: table.models.map((m) => {
      const matchedInput = findDollarRateNearTokenPhrase(pageText, m.inputUsdPerMillion)
      const matchedOutput = findDollarRateNearTokenPhrase(pageText, m.outputUsdPerMillion)
      const matched: string[] = []
      if (matchedInput) matched.push(matchedInput)
      if (matchedOutput) matched.push(matchedOutput)
      // Require at least ONE of input/output to match — if both miss,
      // the rate likely drifted or the page format changed.
      const status: RateProbeStatus = matched.length > 0 ? 'verified' : 'not-verified'
      return {
        modelId: m.modelId,
        status,
        baseline: {
          inputUsdPerMillion: m.inputUsdPerMillion,
          outputUsdPerMillion: m.outputUsdPerMillion
        },
        matchedDollarStrings: matched.length > 0 ? matched : undefined,
        errorMessage:
          matched.length === 0
            ? `Neither $${m.inputUsdPerMillion} nor $${m.outputUsdPerMillion} matched a per-1M-tokens phrase on the pricing page. Page format may have changed, or rates may have drifted.`
            : undefined
      }
    })
  }
}

/**
 * Run the probe across every provider. Best-effort — failures on
 * one provider don't affect the others. Updates the in-memory
 * snapshot + persists to disk for next-boot warm-start.
 */
export async function probeAllProviderRates(): Promise<ProviderRatesSnapshot> {
  // Skip providers with no baked-in models (e.g. gated read-only Grok): there
  // is nothing to price, so we must not issue a network fetch for them — this
  // keeps the gate-off state from reaching out for Grok.
  const providers = (Object.values(BAKED_IN_RATES) as ProviderRateTable[]).filter(
    (table) => table.models.length > 0
  )
  const results = await Promise.all(providers.map(probeOneProvider))
  const resultsMap: Record<ProviderId, ProviderRateProbeResult> = {} as Record<
    ProviderId,
    ProviderRateProbeResult
  >
  for (const result of results) {
    resultsMap[result.provider] = result
  }
  cachedSnapshot = {
    rateTableVersion: RATE_TABLE_VERSION,
    baseline: BAKED_IN_RATES,
    probe: {
      runAt: new Date().toISOString(),
      results: resultsMap
    }
  }
  void persistSnapshot(cachedSnapshot)
  return cachedSnapshot
}

async function persistSnapshot(snapshot: ProviderRatesSnapshot): Promise<void> {
  if (!snapshot.probe) return
  try {
    await fs.writeFile(
      cachePath(),
      JSON.stringify(snapshot.probe, null, 2),
      'utf-8'
    )
  } catch {
    // Best-effort.
  }
}

/**
 * Load the persisted probe results (if any) into the in-memory
 * snapshot. Called on app boot so the renderer's first
 * `providerRates:get` returns useful data even before a fresh
 * probe completes.
 */
export async function loadPersistedProbeResults(): Promise<void> {
  try {
    const raw = await fs.readFile(cachePath(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed?.runAt || !parsed?.results) return
    cachedSnapshot = {
      rateTableVersion: RATE_TABLE_VERSION,
      baseline: BAKED_IN_RATES,
      probe: parsed
    }
  } catch {
    // No cache yet or malformed — baseline-only snapshot stays in
    // memory until the next probe runs.
  }
}

/**
 * Test-only reset. Clears the in-memory snapshot so each test
 * starts from baseline.
 */
export function __resetProviderRateServiceForTesting(): void {
  cachedSnapshot = {
    rateTableVersion: RATE_TABLE_VERSION,
    baseline: BAKED_IN_RATES
  }
}
