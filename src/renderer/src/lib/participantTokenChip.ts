import type { EnsembleParticipant } from '../../../main/store/types'

/**
 * 1.0.4-AV2 — compact per-participant token-spend chip.
 *
 * Renders a short numeric badge next to each participant's status
 * icon showing how many total tokens THAT participant has
 * consumed in THIS chat. Pre-AV2 token totals lived only in the
 * chat-level thread-token-tally pill at the bottom of the
 * composer — useful but didn't tell the user WHICH participant
 * was burning the budget.
 *
 * Format:
 *   < 1k         → omit (chip hidden — keeps the strip lean when
 *                  a participant hasn't spoken yet)
 *   1k–999k      → "Nk"   (e.g. "12k", "847k")
 *   ≥ 1,000k     → "N.Nm" (e.g. "1.2m", "14m")
 *
 * Tooltip carries the precise breakdown (input / output / total)
 * so power users can hover for the unrounded numbers.
 *
 * Cost-in-dollars is deferred — accurate $-per-token rates differ
 * by model + provider tier, and we don't currently persist
 * per-message model rates. AV2 ships the token signal first; a
 * 1.0.5 follow-up can layer $-cost on top once we have a stable
 * model-rate registry.
 */

export interface ParticipantTokenChipModel {
  /** Compact label shown on the chip, e.g. "12k" or "1.2m". Empty
   * string when the participant has no recorded tokens — caller
   * should not render the chip in that case. */
  label: string
  /** Full hover-text breakdown. Empty string when no tokens. */
  tooltip: string
}

export function buildParticipantTokenChipModel(
  participant: EnsembleParticipant
): ParticipantTokenChipModel {
  const totals = participant.tokenTotals
  const total = typeof totals?.total_tokens === 'number' ? totals.total_tokens : 0
  if (!Number.isFinite(total) || total < 1000 || !totals) {
    return { label: '', tooltip: '' }
  }
  return {
    label: formatCompactTokens(total),
    tooltip: formatTokenTooltip(totals)
  }
}

function formatCompactTokens(total: number): string {
  if (total >= 1_000_000) {
    const millions = total / 1_000_000
    // 1.2m / 12m / 124m — one decimal under 10, integer above.
    return millions < 10 ? `${millions.toFixed(1)}m` : `${Math.round(millions)}m`
  }
  const thousands = total / 1000
  return `${Math.round(thousands)}k`
}

function formatTokenTooltip(totals: NonNullable<EnsembleParticipant['tokenTotals']>): string {
  const parts: string[] = []
  if (typeof totals.input_tokens === 'number' && totals.input_tokens > 0) {
    parts.push(`${totals.input_tokens.toLocaleString()} in`)
  }
  if (typeof totals.output_tokens === 'number' && totals.output_tokens > 0) {
    parts.push(`${totals.output_tokens.toLocaleString()} out`)
  }
  if (typeof totals.total_tokens === 'number' && totals.total_tokens > 0) {
    parts.push(`${totals.total_tokens.toLocaleString()} total`)
  }
  if (typeof totals.duration_ms === 'number' && totals.duration_ms > 0) {
    const seconds = totals.duration_ms / 1000
    parts.push(seconds >= 60 ? `${(seconds / 60).toFixed(1)}m` : `${seconds.toFixed(1)}s`)
  }
  return parts.join(' · ')
}
