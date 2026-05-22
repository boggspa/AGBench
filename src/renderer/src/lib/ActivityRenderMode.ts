import type { ToolActivity } from '../../../main/store/types'

/**
 * Pure helper that decides whether an activity has enough substantive content
 * to justify the full rectangular "card" rendering, or should collapse to a
 * slim inline chip.
 *
 * Rules — escalate to card ONLY when at least one of these is true:
 *   1. A preview body is multi-line OR ≥ 120 chars (real persistent content).
 *   2. The activity carries a diff with one or more affected files.
 *   3. Raw debug event must be shown (unknown tool with raw payload).
 *
 * Everything else — pending tool calls, completed tool calls with empty/short
 * bodies, status-only summaries (e.g. "Shell command: `ls`" with no output) —
 * stays inline. The caller still gates on the user's expand/collapse state so
 * a sticky expansion can opt back into the card view when there *is* detail.
 */

export interface ActivityRenderInputs {
  /** Whether the user has expanded the row (sticky disclosure state). */
  expanded: boolean
  /** Detail rows produced by `buildSanitizedDetail` (parameter/file rows). */
  detailRowCount: number
  /** Previews produced by `buildSanitizedDetail` (output / diff / terminal blocks). */
  previews: Array<{ content: string }>
  /** Number of files in any computed diff summary. */
  diffFileCount: number
  /** Whether the activity is missing-name and we must dump the raw event. */
  shouldShowRawEvent: boolean
}

/** Long enough on its own that a preview block carries real content. */
const PREVIEW_CARD_CHAR_THRESHOLD = 120

/** True when at least one preview is multi-line or carries ≥ threshold chars. */
export function hasSubstantivePreview(previews: ActivityRenderInputs['previews']): boolean {
  for (const preview of previews) {
    if (!preview || typeof preview.content !== 'string') continue
    const content = preview.content
    if (content.includes('\n')) return true
    if (content.trim().length >= PREVIEW_CARD_CHAR_THRESHOLD) return true
  }
  return false
}

/** True when there is *any* persistent body the card mode would expose. */
export function hasCardContent(
  inputs: Pick<ActivityRenderInputs, 'previews' | 'diffFileCount' | 'shouldShowRawEvent'>
): boolean {
  if (inputs.shouldShowRawEvent) return true
  if (inputs.diffFileCount > 0) return true
  return hasSubstantivePreview(inputs.previews)
}

/**
 * Final render-mode gate consumed by `ActivityRow`:
 *   - card when the user has expanded AND there is genuine detail to show
 *     (or the raw event must be surfaced regardless).
 *   - inline otherwise — including the trivial "running but no output yet" and
 *     "succeeded with no body" cases that previously left an empty rectangle.
 */
export function shouldRenderAsCard(inputs: ActivityRenderInputs): boolean {
  if (inputs.shouldShowRawEvent) return true
  if (!inputs.expanded) return false
  return hasCardContent(inputs)
}

/**
 * Decides whether the inline chip should advertise a clickable expansion
 * affordance (the chevron). When nothing would expand into the card, the chip
 * stays a passive label.
 *
 * Mirrors `hasCardContent` so the affordance only appears when toggling the
 * expanded state would actually swap inline → card; rows that just carry a
 * single-line label have nothing extra to reveal.
 */
export function hasExpandableDetail(
  activity: Pick<ToolActivity, 'rawUseEvent' | 'rawResultEvent'>,
  inputs: Pick<
    ActivityRenderInputs,
    'detailRowCount' | 'previews' | 'diffFileCount' | 'shouldShowRawEvent'
  >
): boolean {
  if (inputs.shouldShowRawEvent) return Boolean(activity.rawUseEvent || activity.rawResultEvent)
  if (inputs.diffFileCount > 0) return true
  return hasSubstantivePreview(inputs.previews)
}
