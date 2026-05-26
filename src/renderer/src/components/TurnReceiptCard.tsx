/*
 * TurnReceiptCard — Phase L3 slice 5.
 *
 * Renders a thin perforated-edge "receipt tape" at the bottom of an
 * agent turn's tool group, summarising what happened: how many tools
 * ran, how they split by family, total wall-clock duration, and how
 * many succeeded vs warned vs errored.
 *
 * Why a derived render (not a synthetic system message):
 *   - The receipt is purely a UI annotation — it never re-enters
 *     a provider's history. By deriving it from the activities it
 *     summarises (rather than persisting it as a message), we get
 *     the history-replay safety property for free: there's nothing
 *     to filter in `PromptComposition.ts`.
 *   - The summary always matches the live state of the activities.
 *     A persisted summary message could drift if an activity later
 *     reports back (Codex sometimes finalises tool_results late).
 *
 * Hidden cases (returns null):
 *   - Fewer than 2 activities (a single tool call doesn't need a
 *     summary — the card itself shows everything).
 *   - Compact-density mode (slice 6 wires the prop through).
 */
import type { ReactElement } from 'react'
import type { ToolActivity } from '../../../main/store/types'
import { toolNameToFamily, type ToolFamily } from './icons/ToolFamilyIcon'

interface TurnReceiptCardProps {
  activities: ToolActivity[]
  /** Compact-density override. When true, the card collapses to a
   * single inline line (no per-family breakdown). Slice 6 sets this
   * from `settings.compactDensity`. */
  compact?: boolean
  /** Phase L5 slice 3 — master expand/collapse-all toggle. The
   * receipt tape is the natural home for this affordance: it
   * already summarises the activity stack and sits at the foot
   * of it, so a small toggle button hugging the summary lets the
   * user open/close the whole stack with one click. When
   * `expandedCount === expandableCount` (everything open) the
   * button shows "Collapse all"; otherwise "Expand all". */
  expandedCount?: number
  expandableCount?: number
  onExpandAll?: () => void
  onCollapseAll?: () => void
}

export interface FamilyTally {
  family: ToolFamily | 'other'
  count: number
}

export function tallyByFamily(activities: ToolActivity[]): FamilyTally[] {
  const counts = new Map<ToolFamily | 'other', number>()
  for (const activity of activities) {
    const family = toolNameToFamily(activity.toolName) || 'other'
    counts.set(family, (counts.get(family) || 0) + 1)
  }
  // Descending by count, families first then 'other' on ties.
  return Array.from(counts.entries())
    .map(([family, count]) => ({ family, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      if (a.family === 'other') return 1
      if (b.family === 'other') return -1
      return 0
    })
}

/** Per-family display labels. Keep these short — they're shown
 * inline in the receipt summary like `5 reads · 2 edits · 1 test`.
 * The pluralisation is naive (just append 's') because every label
 * here pluralises that way; expand to an irregular-plural map only
 * if a new family violates it. */
const FAMILY_LABEL: Record<ToolFamily | 'other', { singular: string; plural: string }> = {
  file: { singular: 'read', plural: 'reads' },
  edit: { singular: 'edit', plural: 'edits' },
  git: { singular: 'git op', plural: 'git ops' },
  shell: { singular: 'shell', plural: 'shells' },
  search: { singular: 'search', plural: 'searches' },
  task: { singular: 'test', plural: 'tests' },
  mcp: { singular: 'mcp', plural: 'mcps' },
  browser: { singular: 'browser', plural: 'browser' },
  'window-context': { singular: 'window', plural: 'windows' },
  delegate: { singular: 'delegate', plural: 'delegates' },
  yield: { singular: 'yield', plural: 'yields' },
  subthread: { singular: 'subthread op', plural: 'subthread ops' },
  diagnostic: { singular: 'check', plural: 'checks' },
  reasoning: { singular: 'thought', plural: 'thoughts' },
  plan: { singular: 'plan', plural: 'plans' },
  handoff: { singular: 'handoff', plural: 'handoffs' },
  other: { singular: 'other', plural: 'others' }
}

export function formatFamilyTally(tally: FamilyTally): string {
  const labels = FAMILY_LABEL[tally.family]
  return `${tally.count} ${tally.count === 1 ? labels.singular : labels.plural}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
}

export interface TurnReceiptSummary {
  /** When false, the card should not render (single tool, all
   * pending/running, or empty). */
  visible: boolean
  /** The single-line tape contents. Empty string when `visible` is
   * false. */
  summary: string
}

/**
 * Pure summary builder. Extracted from `TurnReceiptCard` so it can
 * be unit-tested without spinning up React rendering machinery.
 */
export function buildTurnReceiptSummary(
  activities: ToolActivity[],
  compact: boolean
): TurnReceiptSummary {
  if (!activities || activities.length < 2) {
    return { visible: false, summary: '' }
  }
  const stillRunning = activities.filter(
    (a) => a.status === 'running' || a.status === 'pending'
  ).length
  if (stillRunning > 0) {
    return { visible: false, summary: '' }
  }

  const totalCount = activities.length
  const totalDurationMs = activities.reduce(
    (sum, activity) => sum + (typeof activity.durationMs === 'number' ? activity.durationMs : 0),
    0
  )
  const successCount = activities.filter((a) => a.status === 'success').length
  const errorCount = activities.filter((a) => a.status === 'error').length
  const warningCount = activities.filter((a) => a.status === 'warning').length

  const tallies = tallyByFamily(activities).slice(0, compact ? 0 : 4)
  const tallySegment = tallies.map(formatFamilyTally).join(' · ')

  const statusSegment = (() => {
    if (errorCount > 0) return `${successCount}/${totalCount} ✓ · ${errorCount} ✗`
    if (warningCount > 0) return `${successCount}/${totalCount} ✓ · ${warningCount} ⚠`
    return `${totalCount}/${totalCount} ✓`
  })()

  const summary = compact
    ? `${totalCount} tools · ${formatDuration(totalDurationMs)} · ${statusSegment}`
    : `${tallySegment} · ${formatDuration(totalDurationMs)} · ${statusSegment}`

  return { visible: true, summary }
}

export function TurnReceiptCard({
  activities,
  compact = false,
  expandedCount = 0,
  expandableCount = 0,
  onExpandAll,
  onCollapseAll
}: TurnReceiptCardProps): ReactElement | null {
  const { visible, summary: summaryLine } = buildTurnReceiptSummary(activities, compact)
  if (!visible) return null

  // Phase L5 slice 3 — master toggle visibility. We only show the
  // button when:
  //   - parent provided the handlers (back-compat: receipts inside
  //     `ChildAgentThreadCard` etc. don't pass them and stay
  //     toggle-less)
  //   - there are ≥2 expandable rows (single-row stacks don't need
  //     a master toggle; the row's own chevron is enough)
  const canToggle = Boolean(onExpandAll && onCollapseAll) && expandableCount >= 2
  const allOpen = canToggle && expandedCount >= expandableCount
  const buttonLabel = allOpen ? 'Collapse all' : 'Expand all'
  const buttonHandler = allOpen ? onCollapseAll : onExpandAll

  return (
    <div className="turn-receipt-card" role="note" aria-label="Turn summary">
      <div className="turn-receipt-perf turn-receipt-perf-top" aria-hidden />
      <div className="turn-receipt-body">
        <span className="turn-receipt-label">Turn</span>
        <span className="turn-receipt-summary">{summaryLine}</span>
        {canToggle && (
          <button
            type="button"
            className="turn-receipt-toggle"
            onClick={buttonHandler}
            aria-label={buttonLabel}
          >
            {buttonLabel}
          </button>
        )}
      </div>
      <div className="turn-receipt-perf turn-receipt-perf-bot" aria-hidden />
    </div>
  )
}
