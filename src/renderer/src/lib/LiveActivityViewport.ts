/**
 * Pure helpers for the {@link LiveActivityViewport} auto-follow ("stick to
 * bottom") behaviour. Extracted so the threshold logic can be unit tested
 * without a DOM. Mirrors the philosophy of `TranscriptScroll.ts` but uses a
 * slightly more forgiving threshold: the live activity viewport is a small,
 * fast-streaming masked region where a 4px tolerance would flicker between
 * following / not-following as reasoning text and tool rows stream in.
 */

/**
 * Distance, in CSS pixels, within which the viewport counts as pinned to the
 * live edge. Larger than the main transcript's 4px because the viewport is
 * short and streams quickly; we want to keep following through sub-row layout
 * jitter while still releasing the moment the user deliberately scrolls up.
 */
export const VIEWPORT_STICK_PX = 24

/** Compute how far a scroll container is from its bottom edge. */
export function distanceFromBottom(metrics: {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}): number {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight
}

/**
 * Resolve the next auto-follow state from the current distance-from-bottom.
 * Symmetric around {@link VIEWPORT_STICK_PX}: the viewport follows whenever the
 * user is within the threshold of the bottom, and releases otherwise. Defensive
 * against non-finite inputs (detached container / mid-reflow metrics) — those
 * preserve the current state rather than thrashing it.
 */
export function nextAutoFollow(distance: number, current: boolean): boolean {
  if (!Number.isFinite(distance)) return current
  return distance <= VIEWPORT_STICK_PX
}

/**
 * Whether the "jump to latest" affordance should show: only when the viewport
 * is collapsed (masked, fixed-height) AND the user has scrolled away from the
 * live edge. When expanded the whole region is freely scrollable, and when
 * following the bottom is already visible — in both cases the pill is noise.
 */
export function shouldShowViewportJump(input: {
  expanded: boolean
  following: boolean
}): boolean {
  return !input.expanded && !input.following
}
