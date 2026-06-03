import type { ChatRecord, ChatRun, EnsembleRoundParticipantState } from '../../../main/store/types'
import { formatContextTokens } from './contextWindows'
import { extractUsageCount, extractUsageCountsFromCandidate } from './usageStats'

export type RunCompleteSummaryRow = {
  label: string
  value: string
}

export const formatWorkDuration = (startedAt?: string, completedAt?: string): string | null => {
  if (!startedAt || !completedAt) {
    return null
  }

  const started = new Date(startedAt).getTime()
  const completed = new Date(completedAt).getTime()
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    return null
  }

  let remainingSeconds = Math.max(1, Math.round((completed - started) / 1000))
  const hours = Math.floor(remainingSeconds / 3600)
  remainingSeconds -= hours * 3600
  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds - minutes * 60
  const parts: string[] = []

  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`)
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`)

  return `Worked for ${parts.slice(0, 2).join(' ')}`
}

const formatCompactDurationMs = (durationMs: number): string => {
  const ms = Math.max(0, Math.round(durationMs))
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

const formatRunStatusLabel = (status?: string): string => {
  if (!status) return 'Unknown'
  if (status === 'success' || status === 'completed') return 'Complete'
  if (status === 'success_with_warnings') return 'Warnings'
  if (status === 'failed') return 'Failed'
  if (status === 'cancelled') return 'Cancelled'
  return status
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

const formatApprovalModeLabel = (mode?: string): string => {
  if (!mode) return 'Unknown'
  if (mode === 'plan') return 'Read-only'
  if (mode === 'auto_edit') return 'Auto edit'
  return formatRunStatusLabel(mode)
}

const getRunDurationMs = (run: ChatRun): number => {
  const statsDuration = extractUsageCount(run.stats, [['duration_ms'], ['durationMs']])
  if (statsDuration > 0) return statsDuration

  const started = run.startedAt ? Date.parse(run.startedAt) : NaN
  const ended = run.endedAt ? Date.parse(run.endedAt) : NaN
  if (Number.isFinite(started) && Number.isFinite(ended) && ended >= started) {
    return ended - started
  }
  return 0
}

export const buildRunCompleteSummaryRows = (run?: ChatRun | null): RunCompleteSummaryRow[] => {
  if (!run) return []

  const rows: RunCompleteSummaryRow[] = []
  const model = run.actualModel || run.requestedModel
  if (model) rows.push({ label: 'Model', value: model })
  rows.push({ label: 'Mode', value: formatApprovalModeLabel(run.approvalMode) })
  rows.push({ label: 'Status', value: formatRunStatusLabel(run.status) })

  const durationMs = getRunDurationMs(run)
  if (durationMs > 0) rows.push({ label: 'Duration', value: formatCompactDurationMs(durationMs) })

  const counts = extractUsageCountsFromCandidate(run.stats)
  if (counts.totalTokens > 0) {
    rows.push({
      label: 'Tokens',
      value: `${formatContextTokens(counts.inputTokens)} in / ${formatContextTokens(counts.outputTokens)} out`
    })
    rows.push({ label: 'Total', value: `${formatContextTokens(counts.totalTokens)} tokens` })
  }

  return rows
}

/**
 * Per-participant outcome rollup for a finished ensemble round — the panel's
 * round-close "who passed, who skipped, who failed" ask. Reads the terminal
 * status on each `activeRound.participants[]` entry (finishRound resolves every
 * participant to a terminal status by round close):
 *
 *   - Contributed: answered | yielded   (mirrors ComplexityEscalation's
 *   - Failed:      failed | unreachable   ANSWER_STATUSES / FAILURE_STATUSES)
 *   - Skipped:     anything else (user-skipped, produced-no-content,
 *                  cancelled, or paused/sleeping)
 *
 * Returned as label/value rows so they slot straight into the existing
 * run-complete summary grid. Empty buckets are omitted; participant labels
 * prefer the role, falling back to the provider id.
 */
export const buildRoundOutcomeRows = (chat: ChatRecord | null): RunCompleteSummaryRow[] => {
  const participants = chat?.ensemble?.activeRound?.participants || []
  if (participants.length === 0) return []
  const label = (p: EnsembleRoundParticipantState): string => p.role?.trim() || p.provider
  const contributed = participants.filter((p) => p.status === 'answered' || p.status === 'yielded')
  const failed = participants.filter((p) => p.status === 'failed' || p.status === 'unreachable')
  const skipped = participants.filter(
    (p) => !['answered', 'yielded', 'failed', 'unreachable'].includes(p.status)
  )
  const rows: RunCompleteSummaryRow[] = []
  if (contributed.length > 0) {
    rows.push({ label: 'Contributed', value: contributed.map(label).join(', ') })
  }
  if (skipped.length > 0) {
    rows.push({ label: 'Skipped', value: skipped.map(label).join(', ') })
  }
  if (failed.length > 0) {
    rows.push({ label: 'Failed', value: failed.map(label).join(', ') })
  }
  return rows
}

/**
 * Ensemble variant of {@link buildRunCompleteSummaryRows}. Aggregates
 * across every participant run that belongs to the round so the user
 * sees ALL models that contributed, not just the last speaker's.
 *
 * Model list: each participant's model joined by `·` for compact
 * single-line display. Status: 'Complete' if every run reports
 * success (and the round itself completed), else the worst-case
 * status. Tokens sum across all runs. Duration uses the round's
 * `startedAt` → `endedAt` envelope rather than any individual run's
 * timing.
 */
export const buildEnsembleRoundSummaryRows = (
  chat: ChatRecord | null,
  cancelled: boolean
): RunCompleteSummaryRow[] => {
  const round = chat?.ensemble?.activeRound
  if (!round) return []
  const roundRuns = (chat?.runs || []).filter((run) => run.ensembleRoundId === round.roundId)
  const rows: RunCompleteSummaryRow[] = []

  // Collect each participant's actual (or requested) model, dedup +
  // preserve insertion order so the display follows speaker order.
  const seenModels = new Set<string>()
  const models: string[] = []
  for (const run of roundRuns) {
    const model = run.actualModel || run.requestedModel
    if (model && !seenModels.has(model)) {
      seenModels.add(model)
      models.push(model)
    }
  }
  if (models.length > 0) {
    rows.push({
      label: models.length === 1 ? 'Model' : 'Models',
      value: models.join(' · ')
    })
  }

  // Mode: take from the first run with an approval mode — every
  // participant in a round currently shares the chat-level preset, so
  // varying values would indicate per-participant overrides worth
  // surfacing too. Keep it simple for now and show the first.
  const firstApprovalMode = roundRuns.find((run) => run.approvalMode)?.approvalMode
  if (firstApprovalMode) {
    rows.push({ label: 'Mode', value: formatApprovalModeLabel(firstApprovalMode) })
  }

  rows.push({
    label: 'Status',
    value: cancelled ? 'Cancelled' : 'Complete'
  })

  // Per-participant outcome rollup (who contributed / skipped / failed) — the
  // panel's round-close "who passed / skipped / failed" ask.
  rows.push(...buildRoundOutcomeRows(chat))

  // Round-envelope duration.
  const startedAtMs = round.startedAt ? new Date(round.startedAt).getTime() : NaN
  const endedAtMs = round.endedAt ? new Date(round.endedAt).getTime() : Date.now()
  if (Number.isFinite(startedAtMs) && endedAtMs > startedAtMs) {
    rows.push({
      label: 'Duration',
      value: formatCompactDurationMs(endedAtMs - startedAtMs)
    })
  }

  // Token totals — sum across all participant runs.
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  for (const run of roundRuns) {
    const counts = extractUsageCountsFromCandidate(run.stats)
    inputTokens += counts.inputTokens
    outputTokens += counts.outputTokens
    totalTokens += counts.totalTokens
  }
  if (totalTokens > 0) {
    rows.push({
      label: 'Tokens',
      value: `${formatContextTokens(inputTokens)} in / ${formatContextTokens(outputTokens)} out`
    })
    rows.push({ label: 'Total', value: `${formatContextTokens(totalTokens)} tokens` })
  }

  return rows
}
