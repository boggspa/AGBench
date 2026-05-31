// Grok SUBSCRIPTION-CREDITS usage — distinct from token/cost usage.
//
// SuperGrok/grok.com CLI auth bills by a subscription credit pool (a percent +
// reset window), NOT per-token. There is NO noninteractive command for it
// (`grok inspect --json` is config-only; no `usage`/`account` subcommand), so
// the only safe source is the interactive `/usage` → "Show Usage" screen,
// captured via PTY. This module keeps the PARSER pure + fully unit-tested and
// isolates the impure PTY capture behind an injected `spawnPty` (testable for
// timeout/failure with a fake terminal). No prompt is ever sent (no model call
// / credit consumption); we never touch ~/.grok or credential files.

export interface GrokUsageSnapshot {
  provider: 'grok'
  source: 'grok-cli-usage'
  usageKind: 'subscription_credits'
  /** Parsed percent (0–100). null when only a coarse band like "<1%" is known. */
  creditsUsedPercent: number | null
  /** Raw display, preserved exactly (e.g. "1.05%", "0%", "<1%"). */
  creditsUsedDisplay: string
  /** Reset window text exactly as shown (e.g. "May 31, 16:00 PT", "1 Jun"). */
  resetAtText: string | null
  /** ISO timestamp when robustly parseable; null otherwise (we trust the text). */
  resetAt: string | null
  /** Grok subscription credits reset on a monthly credit window when parseable. */
  limitWindowSeconds: number | null
  /** Plan label when shown (e.g. "Free credits with SuperGrok"). */
  planLabel: string | null
  payAsYouGoEnabled: boolean | null
  refreshedAt: string
  /** 'observed' = captured from the live CLI; 'unavailable' = probe found nothing. */
  confidence: 'observed' | 'unavailable'
}

export const GROK_CREDIT_WINDOW_SECONDS = 30 * 24 * 60 * 60

/** Strip ANSI/VT control sequences while preserving printable text + spaces. */
export function stripGrokAnsi(input: string): string {
  return (
    input
      // OSC (operating system command) sequences, BEL- or ST-terminated.
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      // CSI sequences (colors, cursor moves, etc.).
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      // Single-char escapes.
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b[@-Z\\-_]/g, '')
      // Carriage returns (TUI redraws) → newlines so line scans still work.
      .replace(/\r/g, '\n')
  )
}

function parsePercentDisplay(text: string): { display: string; percent: number | null } | null {
  // "Credits used: 1.05%" / "Credits used: 0%" / "Credits used: <1%"
  const labelled = text.match(/Credits?\s*used:?\s*(<\s*)?(\d[\d.]*)\s*%/i)
  if (labelled) {
    const isBand = Boolean(labelled[1])
    const num = Number(labelled[2])
    return {
      display: isBand ? `<${labelled[2]}%` : `${labelled[2]}%`,
      percent: isBand || !Number.isFinite(num) ? null : num
    }
  }
  // Status-line form: "<1% used" / "12% used"
  const used = text.match(/(<\s*)?(\d[\d.]*)\s*%\s*used/i)
  if (used) {
    const isBand = Boolean(used[1])
    const num = Number(used[2])
    return {
      display: isBand ? `<${used[2]}%` : `${used[2]}%`,
      percent: isBand || !Number.isFinite(num) ? null : num
    }
  }
  return null
}

function parseResetText(text: string): string | null {
  // Capture the reset window, stopping before trailing fields on the same line.
  const match = text.match(/Resets:?\s*(.+?)\s*(?:Pay\s*as\s*you\s*go|Credits?\s*used|·|\||\n|$)/i)
  if (!match) return null
  const value = match[1].trim()
  return value || null
}

function monthIndex(name: string): number | null {
  const key = name.slice(0, 3).toLowerCase()
  const index = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec'
  ].indexOf(key)
  return index >= 0 ? index : null
}

function nthSundayOfMonth(year: number, month: number, nth: number): number {
  let seen = 0
  for (let day = 1; day <= 31; day += 1) {
    const date = new Date(Date.UTC(year, month, day))
    if (date.getUTCMonth() !== month) break
    if (date.getUTCDay() === 0) {
      seen += 1
      if (seen === nth) return day
    }
  }
  return 1
}

function pacificUtcOffsetHours(year: number, month: number, day: number): number {
  if (month < 2 || month > 10) return -8
  if (month > 2 && month < 10) return -7
  if (month === 2) return day >= nthSundayOfMonth(year, 2, 2) ? -7 : -8
  return day < nthSundayOfMonth(year, 10, 1) ? -7 : -8
}

function parseResetAt(text: string | null, refreshedAt: string): string | null {
  if (!text) return null
  const refreshed = new Date(refreshedAt)
  if (Number.isNaN(refreshed.getTime())) return null
  const match = text.match(/^([A-Za-z]+)\s*(\d{1,2}),?\s*(\d{1,2}):(\d{2})\s*(PT|PST|PDT)$/i)
  if (!match) return null
  const month = monthIndex(match[1])
  const day = Number(match[2])
  const hour = Number(match[3])
  const minute = Number(match[4])
  if (
    month === null ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31 ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    return null
  }
  const timezone = match[5].toUpperCase()
  const year = refreshed.getUTCFullYear()
  const offsetHours =
    timezone === 'PDT' ? -7 : timezone === 'PST' ? -8 : pacificUtcOffsetHours(year, month, day)
  const makeDate = (targetYear: number) =>
    new Date(Date.UTC(targetYear, month, day, hour - offsetHours, minute))
  let parsed = makeDate(year)
  if (parsed.getTime() <= refreshed.getTime() - 60 * 60 * 1000) {
    parsed = makeDate(year + 1)
  }
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function parsePlanLabel(text: string): string | null {
  const sup = text.match(/((?:Free\s*credits\s*with\s*)?SuperGrok(?:\s*Heavy)?)/i)
  if (sup) return sup[1].replace(/\s+/g, ' ').trim()
  return null
}

function parsePayAsYouGo(text: string): boolean | null {
  const match = text.match(/Pay\s*as\s*you\s*go:?\s*(enabled|disabled|on|off)/i)
  if (!match) return null
  const value = match[1].toLowerCase()
  return value === 'enabled' || value === 'on'
}

/**
 * Parse the captured `/usage` text into a snapshot. `text` may be raw (with
 * ANSI) or pre-stripped; we strip defensively. Returns an 'unavailable'
 * snapshot when no credit signal is found.
 */
export function parseGrokUsage(
  rawText: string,
  refreshedAt: string = new Date().toISOString()
): GrokUsageSnapshot {
  const text = stripGrokAnsi(rawText || '')
  const credit = parsePercentDisplay(text)
  const resetAtText = parseResetText(text)
  const resetAt = parseResetAt(resetAtText, refreshedAt)
  const planLabel = parsePlanLabel(text)
  const payAsYouGoEnabled = parsePayAsYouGo(text)

  const base: GrokUsageSnapshot = {
    provider: 'grok',
    source: 'grok-cli-usage',
    usageKind: 'subscription_credits',
    creditsUsedPercent: credit ? credit.percent : null,
    creditsUsedDisplay: credit ? credit.display : '',
    resetAtText,
    resetAt,
    limitWindowSeconds: resetAt ? GROK_CREDIT_WINDOW_SECONDS : null,
    planLabel,
    payAsYouGoEnabled,
    refreshedAt,
    confidence: credit ? 'observed' : 'unavailable'
  }
  return base
}

// ── PTY probe (impure; injected terminal keeps it testable) ──────────────────

export interface GrokPtyLike {
  onData(listener: (data: string) => void): void
  onExit(listener: (event: { exitCode: number }) => void): void
  write(data: string): void
  kill(): void
}

export interface GrokUsageProbeDeps {
  /** Spawns `grok --no-auto-update --no-alt-screen` in a throwaway cwd. */
  spawnPty: () => GrokPtyLike
  /** Hard ceiling for the whole probe. */
  timeoutMs?: number
  /** ms to wait for the TUI before sending `/usage` (overridable for tests). */
  readyDelayMs?: number
  /** ms after `/usage` before pressing Enter to pick "Show Usage". */
  selectDelayMs?: number
  now?: () => string
  setTimer?: (cb: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/**
 * Capture `/usage` → "Show Usage" via PTY and parse it. Resolves as soon as a
 * credit signal is seen (early-out), or with an 'unavailable' snapshot on
 * timeout / clean-exit-without-data. Always kills the child. Never sends a
 * prompt.
 */
export function probeGrokUsage(deps: GrokUsageProbeDeps): Promise<GrokUsageSnapshot> {
  const timeoutMs = deps.timeoutMs ?? 12_000
  const readyDelayMs = deps.readyDelayMs ?? 2200
  const selectDelayMs = deps.selectDelayMs ?? 2000
  const now = deps.now ?? (() => new Date().toISOString())
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms))
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))

  return new Promise<GrokUsageSnapshot>((resolve) => {
    let settled = false
    let buffer = ''
    const timers: unknown[] = []
    let child: GrokPtyLike | null = null

    const finish = (snapshot: GrokUsageSnapshot): void => {
      if (settled) return
      settled = true
      for (const t of timers) clearTimer(t)
      try {
        child?.kill()
      } catch {
        // already gone
      }
      resolve(snapshot)
    }

    try {
      child = deps.spawnPty()
    } catch (error) {
      resolve(parseGrokUsage('', now()))
      void error
      return
    }

    child.onData((data) => {
      buffer += data
      // Early-out once a full credit line has streamed in.
      if (/Credits?\s*used:?\s*<?\s*\d/i.test(stripGrokAnsi(buffer))) {
        // Give one more beat for the reset/pay-as-you-go lines, then parse.
        timers.push(setTimer(() => finish(parseGrokUsage(buffer, now())), 250))
      }
    })

    child.onExit(() => finish(parseGrokUsage(buffer, now())))

    timers.push(setTimer(() => child?.write('/usage\r'), readyDelayMs))
    timers.push(setTimer(() => child?.write('\r'), readyDelayMs + selectDelayMs))
    timers.push(setTimer(() => finish(parseGrokUsage(buffer, now())), timeoutMs))
  })
}
