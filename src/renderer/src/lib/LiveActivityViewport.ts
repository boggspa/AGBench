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

/** Minimum overflow (px) before an edge fade is shown — avoids flicker at rest. */
export const EDGE_FADE_OVERFLOW_PX = 4

/**
 * Whether top/bottom edge fades should show for a collapsed live viewport.
 * Fades are overflow-aware: the top fade only appears when the user has
 * scrolled up, and the bottom fade only when content extends below the window.
 */
export function edgeFadeState(metrics: {
  scrollHeight: number
  clientHeight: number
  scrollTop: number
}): { top: boolean; bottom: boolean } {
  const { scrollHeight, clientHeight, scrollTop } = metrics
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight) || !Number.isFinite(scrollTop)) {
    return { top: false, bottom: false }
  }
  const overflow = scrollHeight - clientHeight
  if (overflow <= EDGE_FADE_OVERFLOW_PX) {
    return { top: false, bottom: false }
  }
  const distance = distanceFromBottom(metrics)
  return {
    top: scrollTop > EDGE_FADE_OVERFLOW_PX,
    bottom: distance > EDGE_FADE_OVERFLOW_PX
  }
}
