import { formatCost, type DisplayCurrency } from './formatCost'
import { formatContextTokens } from './contextWindows'
import { extractUsageCostUsd, extractUsageCountsFromCandidate } from './usageStats'
import type { ChatRun, EnsembleParticipant } from '../../../main/store/types'

type ChatTokenTally = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  explicitCostUsd: number
}

const buildChatTokenTally = (runs: ChatRun[] = []): ChatTokenTally => {
  return runs.reduce<ChatTokenTally>(
    (total, run) => {
      const counts = extractUsageCountsFromCandidate(run?.stats)
      return {
        inputTokens: total.inputTokens + counts.inputTokens,
        outputTokens: total.outputTokens + counts.outputTokens,
        totalTokens: total.totalTokens + counts.totalTokens,
        explicitCostUsd: total.explicitCostUsd + extractUsageCostUsd(run?.stats)
      }
    },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, explicitCostUsd: 0 }
  )
}
// 1.0.5-EW25 — Routes through `formatCost` so the user's selected
// display currency wins. Pre-EW25 this hard-coded the `$` symbol +
// `<$0.01` floor; the floor logic now lives in `formatCost.ts` and
// is per-currency aware. Callers that previously didn't pass a
// currency get USD by default — backward-compatible.
//
// 1.0.5-EW34 — Threads the user's conservative-overestimate bias
// percent (sub-slice e) into the same call. Default 0 keeps the
// behaviour identical for callers that don't pass a bias.
const formatExplicitCostUsd = (
  costUsd: number,
  currency: DisplayCurrency = 'USD',
  overestimatePercent: number = 0
): string => formatCost(costUsd, currency, undefined, overestimatePercent)
const formatThreadTokenTally = (
  _providerLabel: string,
  tally: ChatTokenTally,
  currency: DisplayCurrency = 'USD',
  overestimatePercent: number = 0
): string | null => {
  if (tally.totalTokens <= 0) return null
  const cost = formatExplicitCostUsd(tally.explicitCostUsd, currency, overestimatePercent)
  // Provider label dropped — the user already knows which provider
  // they're talking to (the provider chip is right next to this
  // tally), and the inline real-estate is tight. `_providerLabel`
  // kept as a positional arg so the call site doesn't change shape.
  return `${formatContextTokens(tally.inputTokens)} in / ${formatContextTokens(tally.outputTokens)} out${cost ? ` · ${cost}` : ''}`
}

/**
 * B1 (1.0.3) — per-participant breakdown for the ensemble tally
 * footer's hover tooltip. The footer chip itself keeps the compact
 * aggregate format (`Σin / Σout · $total`) so the visual budget
 * stays tight; the breakdown surfaces on hover via the `title`
 * attribute for users who want to see "where did the cost come
 * from?" without leaving the composer.
 *
 * Groups `runs` by `ensembleParticipantId` and matches each group
 * to the participant's role for the tooltip label. Participants
 * with no runs are omitted so the tooltip doesn't list zeros.
 */
const formatEnsembleTokenBreakdown = (
  runs: ChatRun[],
  participants: EnsembleParticipant[],
  currency: DisplayCurrency = 'USD',
  overestimatePercent: number = 0
): string | null => {
  if (!runs.length || !participants.length) return null
  const byParticipant = new Map<string, ChatTokenTally>()
  for (const run of runs) {
    const pid = run.ensembleParticipantId
    if (!pid) continue
    const counts = extractUsageCountsFromCandidate(run.stats)
    const cost = extractUsageCostUsd(run.stats)
    const existing = byParticipant.get(pid) || {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      explicitCostUsd: 0
    }
    byParticipant.set(pid, {
      inputTokens: existing.inputTokens + counts.inputTokens,
      outputTokens: existing.outputTokens + counts.outputTokens,
      totalTokens: existing.totalTokens + counts.totalTokens,
      explicitCostUsd: existing.explicitCostUsd + cost
    })
  }
  if (byParticipant.size === 0) return null
  const lines: string[] = []
  for (const participant of participants) {
    const tally = byParticipant.get(participant.id)
    if (!tally || tally.totalTokens <= 0) continue
    const label = participant.role || participant.provider
    const cost = formatExplicitCostUsd(tally.explicitCostUsd, currency, overestimatePercent)
    lines.push(
      `${label}: ${formatContextTokens(tally.inputTokens)} in / ${formatContextTokens(tally.outputTokens)} out${cost ? ` · ${cost}` : ''}`
    )
  }
  return lines.length > 0 ? lines.join('\n') : null
}

export type { ChatTokenTally }
export {
  buildChatTokenTally,
  formatExplicitCostUsd,
  formatThreadTokenTally,
  formatEnsembleTokenBreakdown
}
