/**
 * 1.0.6-TV0 — Pure windowing model for the virtualised transcript.
 *
 * The transcript (`TranscriptPanel` in App.tsx) maps the full
 * `visibleMessages` list to `.transcript-message-block` rows today, so
 * render work + memory scale with total chat length. This module holds
 * the pure decision logic for an in-house spacer-above/spacer-below
 * virtualiser: project messages → stable virtual rows, pick the visible
 * window + overscan, size the top/bottom spacers, key a measurement
 * cache, and compute the scroll-anchor correction when rows above the
 * viewport mount or resize.
 *
 * It is deliberately renderer-free (no DOM, no React) so the window math
 * is unit-testable in isolation — the same extraction pattern as
 * `TranscriptScroll.ts`. The renderer feeds it `scrollTop` /
 * `viewportHeight` from the EXISTING scroll container + listener; this
 * module never reads or writes the DOM and never substitutes its own
 * value for the browser's real `scrollHeight` (the spacers + mounted
 * rows + sentinel still sum to the true height, so every `shouldRepin*`
 * path in `TranscriptScroll.ts` keeps working byte-for-byte).
 */

import type { ChatMessage } from '../../../main/store/types'
import { isSubThreadDelegationMessage } from '../components/SubThreadDelegationCardModel'
import { isSubThreadReturnMessage } from '../components/SubThreadReturnCardModel'

/**
 * One virtual row per transcript-message-block (the unit keyed
 * `message-block-${id}` in the renderer). NOT one per card: a block can
 * carry a RunCard boundary above its body, captured by `hasRunBoundary`.
 */
export type VirtualRowType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'error'
  | 'tool'
  | 'participantHealth'
  | 'delegation'
  | 'return'

export interface VirtualRow {
  /** Stable, persisted message id — already the React key in the
   *  renderer, so it survives reload + matches TV6 remote row ids. */
  id: string
  /** Position in the source `visibleMessages` list. */
  index: number
  rowType: VirtualRowType
  /** Cheap content-only change token (see `contentVersion`). Geometry
   *  inputs (width bucket, expansion) are folded in at `measurementKey`
   *  time, not here. */
  contentVersion: string
  /** Heuristic height used until the row mounts + reports a real one. */
  estimatedHeight: number
  /** A RunCard renders above this block (first message of a new run). */
  hasRunBoundary: boolean
}

export interface VirtualWindow {
  /** First mounted row index (inclusive). */
  startIndex: number
  /** One past the last mounted row index (exclusive). */
  endIndex: number
  /** Height of the collapsed run of rows before `startIndex`. */
  topSpacerPx: number
  /** Height of the collapsed run of rows at/after `endIndex`. */
  bottomSpacerPx: number
}

/**
 * Per-row-type height estimates (CSS px). Intentionally generous —
 * estimates only govern off-screen spacer sizing + the very first paint;
 * once a row mounts its measured height (keyed by `measurementKey`)
 * overrides the estimate, and the anchor-correction pass absorbs the
 * difference. Tuned to typical resting heights, not worst case.
 */
export const ESTIMATED_ROW_HEIGHT_PX: Record<VirtualRowType, number> = {
  user: 88,
  assistant: 220,
  system: 64,
  error: 80,
  tool: 180,
  participantHealth: 132,
  delegation: 104,
  return: 148
}

/** Extra height added when a RunCard boundary renders above a block. */
export const RUN_BOUNDARY_HEIGHT_PX = 44

/**
 * Master gate for the in-house transcript virtualiser. TV3 flips this
 * ON by default: the transcript now mounts only the visible window +
 * overscan. The non-virtualised full-list branch is intentionally kept
 * (NOT deleted) as the instant-revert path through the `virtualize`
 * prop and as the explicit `virtualize={false}` path the renderer tests
 * exercise — its deletion is deferred until after live soak confirms no
 * scroll regressions (the documented post-soak follow-up).
 */
export const TRANSCRIPT_VIRTUALIZATION_ENABLED = true

/**
 * Overscan, in CSS px, mounted above + below the strictly-visible
 * window. Pixel-based (not row-count) because transcript rows vary
 * wildly in height. ~1.5 viewports of headroom keeps fast scrolls from
 * flashing blank while keeping the mounted set bounded.
 */
export const DEFAULT_OVERSCAN_PX = 900

/**
 * Quantise the transcript content width so a resize that does NOT change
 * text wrapping reuses cached measurements, while a real reflow (column
 * width crosses a bucket boundary) invalidates them. One bucket value
 * for the whole single-column list.
 */
export const WIDTH_BUCKET_PX = 80

export function widthBucket(clientWidth: number, step: number = WIDTH_BUCKET_PX): number {
  if (!Number.isFinite(clientWidth) || clientWidth <= 0) return 0
  return Math.floor(clientWidth / step)
}

/**
 * Classify a message into its virtual row type, mirroring the renderer's
 * dispatch in `TranscriptPanel` (App.tsx ~6268). Order matters: the
 * sub-thread delegation/return cards are detected first (they reuse
 * `role: 'system'`/`'tool'` with a metadata `kind`), then plain tool
 * rows (ActivityStack), then the participant-health card, then the
 * role-based message bubbles. Uses the canonical `isSubThread*` model
 * helpers so this stays in lockstep with the renderer.
 */
export function classifyRowType(message: ChatMessage): VirtualRowType {
  if (isSubThreadDelegationMessage(message)) return 'delegation'
  if (isSubThreadReturnMessage(message)) return 'return'
  if (message.role === 'tool') return 'tool'
  if (message.metadata?.kind === 'ensembleParticipantHealth') return 'participantHealth'
  if (message.role === 'user') return 'user'
  if (message.role === 'error') return 'error'
  if (message.role === 'assistant') return 'assistant'
  return 'system'
}

/**
 * A cheap, content-derived token that changes exactly when a row's
 * rendered body would change height. Crucially this lets a streaming
 * token invalidate ONE row's cached measurement, never the whole list:
 *
 *   - text rows (user/assistant/system/error): role + content length —
 *     monotonic per streamed token, O(1).
 *   - tool rows (ActivityStack): activity count + every activity's
 *     status + total output-preview length. Captures the two things
 *     that change an ActivityStack's height: a status flip
 *     (running→success collapses the row) and output being revealed.
 *
 * Width bucket + expansion state are NOT folded in here — they are
 * geometry, added at `measurementKey` time so a content-identical row
 * at a new width/expansion gets a distinct cache slot.
 */
export function contentVersion(message: ChatMessage): string {
  if (message.role === 'tool') {
    const activities = message.toolActivities || []
    let outputLen = 0
    let statuses = ''
    for (const a of activities) {
      outputLen += a.outputPreview?.length || a.resultSummary?.length || 0
      statuses += `${a.status || '?'}|`
    }
    return `t:${activities.length}:${statuses}:${outputLen}`
  }
  const len = (message.content || '').length
  return `${message.role[0] || 'x'}:${len}`
}

export function estimatedHeightFor(rowType: VirtualRowType, hasRunBoundary: boolean): number {
  return ESTIMATED_ROW_HEIGHT_PX[rowType] + (hasRunBoundary ? RUN_BOUNDARY_HEIGHT_PX : 0)
}

/**
 * Project the (already-filtered) `visibleMessages` list into stable
 * virtual rows. `runBoundaryIds` is the set of message ids that begin a
 * new run (the renderer's `runBoundaryByMessageId` keys) — those rows
 * carry a RunCard above them, so their estimate is taller.
 *
 * Derived, never stored: the same message set always yields the same
 * ids + order, so windowing + measurement caching are stable across
 * re-renders and reloads.
 */
export function projectRows(
  messages: ChatMessage[],
  runBoundaryIds?: ReadonlySet<string> | null
): VirtualRow[] {
  if (!Array.isArray(messages)) return []
  const rows: VirtualRow[] = []
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (!message || typeof message.id !== 'string') continue
    const rowType = classifyRowType(message)
    const hasRunBoundary = runBoundaryIds ? runBoundaryIds.has(message.id) : false
    rows.push({
      id: message.id,
      index,
      rowType,
      contentVersion: contentVersion(message),
      estimatedHeight: estimatedHeightFor(rowType, hasRunBoundary),
      hasRunBoundary
    })
  }
  return rows
}

/**
 * Cache key for a row's measured height. Combines the stable id, the
 * content token, the width bucket, and the expansion bit so a cached
 * measurement is reused ONLY when the geometry is comparable. A streamed
 * token (new contentVersion), a width reflow (new bucket), or an
 * expand/collapse (new bit) each yields a fresh key → fresh measurement.
 */
export function measurementKey(
  rowId: string,
  rowContentVersion: string,
  bucket: number,
  expanded: boolean
): string {
  return `${rowId}|${rowContentVersion}|${bucket}|${expanded ? 1 : 0}`
}

/**
 * Resolve a row's height: its measured value (looked up by
 * `measurementKey`) when known, else the type estimate. The caller owns
 * the measurement `Map` (per-chat, in a ref).
 */
export function getRowHeight(
  row: VirtualRow,
  measurements: ReadonlyMap<string, number>,
  bucket: number,
  expanded: boolean
): number {
  const measured = measurements.get(measurementKey(row.id, row.contentVersion, bucket, expanded))
  if (typeof measured === 'number' && Number.isFinite(measured) && measured >= 0) return measured
  return row.estimatedHeight
}

/** Sum a slice of a heights array, defensively skipping non-finite values. */
export function sumHeights(heights: number[], start: number, end: number): number {
  let total = 0
  const lo = Math.max(0, start)
  const hi = Math.min(heights.length, end)
  for (let i = lo; i < hi; i++) {
    const h = heights[i]
    if (Number.isFinite(h) && h > 0) total += h
  }
  return total
}

export interface SelectWindowInput {
  /** Current scroll offset of the scroll container (px from top). */
  scrollTop: number
  /** Visible height of the scroll container (clientHeight, px). */
  viewportHeight: number
  /** Per-row heights (measured-or-estimated), index-aligned to the rows. */
  heights: number[]
  /** Extra px mounted above + below the visible band. */
  overscanPx?: number
}

/**
 * Choose the rows to mount (visible band + overscan) and the spacer
 * heights that stand in for the collapsed runs above + below.
 *
 * Invariants the renderer relies on:
 *   - `topSpacerPx + Σ(mounted heights) + bottomSpacerPx === Σ(all heights)`,
 *     so the browser-computed `scrollHeight` is unchanged whether a row
 *     is mounted or collapsed into a spacer. This is why
 *     `scrollTop = scrollHeight` keeps targeting the true bottom.
 *   - When the bottom is within view+overscan, `endIndex === n` and
 *     `bottomSpacerPx === 0` — so the auto-follow/streaming-pinned path
 *     mounts the last row and behaves exactly as the non-virtualised
 *     transcript did.
 *
 * Defensive against NaN / negative / detached-layout inputs.
 */
export function selectWindow(input: SelectWindowInput): VirtualWindow {
  const heights = Array.isArray(input.heights) ? input.heights : []
  const n = heights.length
  if (n === 0) return { startIndex: 0, endIndex: 0, topSpacerPx: 0, bottomSpacerPx: 0 }

  const scrollTop = Number.isFinite(input.scrollTop) ? Math.max(0, input.scrollTop) : 0
  const viewportHeight = Number.isFinite(input.viewportHeight)
    ? Math.max(0, input.viewportHeight)
    : 0
  const overscan =
    Number.isFinite(input.overscanPx) && (input.overscanPx as number) >= 0
      ? (input.overscanPx as number)
      : DEFAULT_OVERSCAN_PX

  const windowTop = scrollTop - overscan
  const windowBottom = scrollTop + viewportHeight + overscan

  // Single pass over cumulative offsets.
  let cumTop = 0
  let startIndex = -1
  let endIndex = n
  for (let i = 0; i < n; i++) {
    const h = Number.isFinite(heights[i]) && heights[i] > 0 ? heights[i] : 0
    const rowTop = cumTop
    const rowBottom = cumTop + h
    if (startIndex === -1 && rowBottom > windowTop) {
      startIndex = i
    }
    if (rowTop >= windowBottom) {
      endIndex = i
      break
    }
    cumTop = rowBottom
  }
  if (startIndex === -1) startIndex = n // everything is above the window
  if (endIndex < startIndex) endIndex = startIndex

  return {
    startIndex,
    endIndex,
    topSpacerPx: sumHeights(heights, 0, startIndex),
    bottomSpacerPx: sumHeights(heights, endIndex, n)
  }
}

/**
 * The scroll-anchor correction applied when rows ABOVE the viewport
 * mount or resize (the highest virtualisation risk). When the top spacer
 * changes from `previousTopSpacerPx` to `nextTopSpacerPx`, the caller
 * applies `scroller.scrollTop += delta` in a pre-paint layout effect so
 * the visible content does not move and no scroll event is attributed to
 * the user. The caller MUST gate this on `!autoFollow` (when pinned at
 * the bottom the top anchor is irrelevant and must not be touched).
 */
export function computeAnchorDelta(input: {
  previousTopSpacerPx: number
  nextTopSpacerPx: number
}): number {
  const prev = Number.isFinite(input.previousTopSpacerPx) ? input.previousTopSpacerPx : 0
  const next = Number.isFinite(input.nextTopSpacerPx) ? input.nextTopSpacerPx : 0
  return next - prev
}

/**
 * True when the window reaches the end of the list — i.e. the last row
 * is mounted and `bottomSpacerPx` is 0. The bottom-follow / streaming
 * path depends on this so the existing `scrollTop = scrollHeight` snap
 * keeps hitting the real bottom.
 */
export function windowReachesEnd(window: VirtualWindow, rowCount: number): boolean {
  return window.endIndex >= rowCount
}

export interface ScrollAnchor {
  /** Index of the first row intersecting the viewport top. */
  index: number
  /** How far the viewport top sits below that row's top edge (px). */
  offsetWithin: number
}

/**
 * Identify the row the viewport top currently sits on, plus the
 * sub-row offset. This is the anchor the renderer pins across height
 * changes: capture `{ rowId, offsetWithin }` from the *current*
 * scrollTop + heights on user scroll, then after a re-render whose
 * heights changed (a row above the viewport mounted/measured), restore
 * `scrollTop = Σ(heights before anchor) + offsetWithin`. Because the
 * anchor row stays visually fixed, content above it can grow/shrink
 * without the viewport jumping — the gold-standard virtualisation
 * anchor, and stronger than a bare top-spacer delta (it also absorbs
 * growth of mounted overscan rows that sit above the viewport).
 *
 * Returns the first row whose cumulative bottom is strictly past
 * `scrollTop`. Defensive against empty / non-finite inputs.
 */
export function findScrollAnchor(scrollTop: number, heights: number[]): ScrollAnchor {
  const hs = Array.isArray(heights) ? heights : []
  const n = hs.length
  if (n === 0) return { index: 0, offsetWithin: 0 }
  const target = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0
  let cum = 0
  for (let i = 0; i < n; i++) {
    const h = Number.isFinite(hs[i]) && hs[i] > 0 ? hs[i] : 0
    if (cum + h > target) {
      return { index: i, offsetWithin: target - cum }
    }
    cum += h
  }
  // Scrolled at/below the end: anchor the last row.
  const lastIndex = n - 1
  return { index: lastIndex, offsetWithin: Math.max(0, target - sumHeights(hs, 0, lastIndex)) }
}
