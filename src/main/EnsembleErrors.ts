/**
 * Typed error classification for ensemble participant dispatch
 * failures. Used by the orchestrator's `runRound()` self-heal path
 * so the transcript surfaces *why* a participant was skipped rather
 * than a generic "Dispatch failed." line.
 *
 * Origin: Claude/Explorer's introspective feedback in production —
 * when an `ensemble_yield` hit `ECONNREFUSED` on the Gemini MCP
 * socket, the error bubbled as a raw socket error with no hint
 * about whether the panel could self-heal vs. needed user
 * intervention. The full quote from the transcript:
 *
 *   > when my ensemble_yield call hit ECONNREFUSED on the Gemini
 *   > socket last round, the error bubbled as a raw socket error
 *   > rather than a structured "participant unreachable, panel
 *   > will route manually."
 *
 * The orchestrator was already doing the right thing structurally
 * (skip the failed participant, continue with the next in
 * `remaining`), it just wasn't telling the user that's what
 * happened. This module sharpens the diagnostic.
 *
 * Three failure shapes:
 *
 *   - `unreachable` — the participant's provider runtime or MCP
 *     socket couldn't be reached. Includes connection refused,
 *     socket not found (ENOENT), timeout (ETIMEDOUT), and pipe
 *     break (EPIPE). The panel CAN self-heal by routing around.
 *     Hint to user: re-launch the provider's CLI / wait for the
 *     socket to come back / re-enable participant from chip strip.
 *
 *   - `preflight` — runtime-profile / auth / permission gate
 *     refused the dispatch before the stream started. The
 *     participant exists and is reachable, but the configuration
 *     for THIS dispatch was rejected. Hint: check provider auth,
 *     permission preset, runtime profile.
 *
 *   - `unknown` — anything else. Generic fallback so the
 *     orchestrator can still emit a structured note even when the
 *     error doesn't match a known pattern.
 *
 * Pure functions — no React, no IPC. Easy to unit test.
 */

import type { EnsembleParticipant } from './store/types'

/**
 * Known node / posix error codes that classify as "participant
 * unreachable" — the runtime is dead or temporarily unavailable
 * but the participant config itself is sound.
 */
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOENT',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTCONN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNRESET'
])

export type DispatchFailureReason =
  | { kind: 'unreachable'; underlyingCode: string }
  | { kind: 'preflight'; message: string }
  | { kind: 'unknown'; message: string }

/**
 * Classify an arbitrary thrown value (or a `dispatched: false` shape)
 * into one of three known failure modes. Inputs we handle:
 *
 *   - `Error` instances with `.code` matching a known posix code
 *     (Node's `NodeJS.ErrnoException` shape — what `net`, `fs`,
 *     `dgram`, and most adapter-level socket / pipe errors throw)
 *   - `Error` instances whose `.message` contains a recognisable
 *     posix code substring (covers re-thrown errors that lost their
 *     `.code` field but kept the message — common when an error
 *     gets wrapped through `new Error(originalError.message)`)
 *   - Plain objects with `{ code: 'XXX' }` (some adapters wrap)
 *   - Strings (anything else)
 *
 * Defensive: a null / undefined / unrecognised input returns
 * `{ kind: 'unknown', message: '' }` rather than throwing — the
 * caller is already on an error path and shouldn't get a secondary
 * exception from the classifier itself.
 */
export function classifyDispatchError(error: unknown): DispatchFailureReason {
  if (error === null || error === undefined) {
    return { kind: 'unknown', message: '' }
  }

  // Node Errno shape: `{ message, code: 'ECONNREFUSED', errno, syscall }`.
  // The `.code` field is the most reliable signal because it
  // survives `Error.captureStackTrace` and most wrapping helpers.
  const errnoCode =
    typeof (error as { code?: unknown }).code === 'string'
      ? ((error as { code?: string }).code as string)
      : ''
  if (errnoCode && UNREACHABLE_CODES.has(errnoCode)) {
    return { kind: 'unreachable', underlyingCode: errnoCode }
  }

  // Message-substring fallback for errors that have been wrapped
  // and lost their `.code`. We only match the canonical caps form
  // (`ECONNREFUSED` not `connection refused`) to avoid false
  // positives on natural-language messages.
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  for (const code of UNREACHABLE_CODES) {
    if (message.includes(code)) {
      return { kind: 'unreachable', underlyingCode: code }
    }
  }

  // Preflight / auth / permission failures don't have a posix code
  // but DO have a meaningful message. Categorise these as preflight
  // so the user knows it's a config-side rather than runtime-side
  // failure.
  if (message) {
    return { kind: 'preflight', message }
  }

  return { kind: 'unknown', message: '' }
}

/**
 * Format the transcript system note for a participant-unreachable
 * dispatch failure. Used by the orchestrator at the failed-dispatch
 * branch in `runRound()` to surface the failure mode to the user
 * instead of a generic "Dispatch failed." line.
 *
 *   - `unreachable`: `"⚠ Codex / Worker unreachable (ECONNREFUSED).
 *     Skipping for this round — re-launch the provider CLI or
 *     re-enable from the chip strip."`
 *   - `preflight`: `"⚠ Codex / Worker dispatch failed: <message>.
 *     Skipping for this round."`
 *   - `unknown`: `"⚠ Codex / Worker dispatch failed. Skipping for
 *     this round."`
 */
export function formatDispatchFailureNote(
  participant: EnsembleParticipant,
  reason: DispatchFailureReason
): string {
  const provider = providerDisplayName(participant.provider)
  const role = (participant.role || '').trim()
  const who = role ? `${provider} / ${role}` : provider

  if (reason.kind === 'unreachable') {
    return (
      `⚠ ${who} unreachable (${reason.underlyingCode}). ` +
      `Skipping for this round — re-launch the provider CLI or ` +
      `re-enable from the chip strip when the socket is back.`
    )
  }
  if (reason.kind === 'preflight') {
    // Trim trailing punctuation so the joined sentence reads
    // cleanly — agent-emitted error messages often end with "." or
    // "!" already, and the appended ". Skipping..." would look
    // like a typo.
    const trimmed = reason.message.replace(/[.!?\s]+$/u, '')
    return `⚠ ${who} dispatch failed: ${trimmed}. Skipping for this round.`
  }
  return `⚠ ${who} dispatch failed. Skipping for this round.`
}

/**
 * Provider display name — `'codex'` → `'Codex'`. Mirrors the
 * `providerLabel` helper in `EnsemblePrompt.ts` but kept local so
 * this module doesn't take a cross-file dependency for one string.
 */
function providerDisplayName(provider: string): string {
  if (!provider) return ''
  return provider.charAt(0).toUpperCase() + provider.slice(1)
}
