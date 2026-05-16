/**
 * Pure helpers for the transcript auto-follow ("stick to bottom") scroll
 * behaviour in App.tsx. Extracted so the threshold logic can be unit
 * tested without spinning up the renderer.
 *
 * Background — the bug this module exists to address:
 *
 * Long Kimi runs streamed many `update_topic`/`intent`/`summary`/
 * `progress` events through `emitVisibleProgress` (see GeminiAdapter).
 * Each event produced both a `tool_use` and a paired `tool_result`,
 * which flipped the corresponding ActivityStack row from `running` to
 * `success`. ActivityStack's local `useEffect` then collapsed the row
 * (`setExpanded(false)`), shrinking the transcript content height in
 * the frame _after_ the parent's `useLayoutEffect`-driven snap-to-bottom
 * already ran. The browser clamped `scrollTop`, the visible content
 * shifted upward, and the user perceived the transcript "snapping" away
 * from the bottom. Code blocks rendered through CodeMirror exhibit the
 * same late-mount height growth and caused the equivalent symptom.
 *
 * The fix has two parts and both are deliberately conservative — the
 * earlier history of this code path (a ResizeObserver feedback loop)
 * is documented in App.tsx and must not be reintroduced:
 *
 *   1. Widen the engage/disengage thresholds so token-streaming jitter
 *      and one-frame layout shifts cannot drag the user out of the
 *      sticky zone. `shouldEngageAutoFollow` / `shouldDisengageAutoFollow`
 *      below encode the policy.
 *   2. After every snap-to-bottom write, schedule one extra rAF re-pin
 *      so late-mount layout growth/shrink (CodeMirror, ActivityStack
 *      collapse) can settle and we re-anchor the visible bottom. The
 *      re-pin is gated on `autoFollow` _and_ a flag that goes false the
 *      moment we observe a real user-initiated upward scroll, so the
 *      compensation pass never fights a deliberate scroll-up.
 */

/**
 * Distance, in CSS pixels, within which a scroll position counts as
 * "essentially at the bottom" — used both for the initial engagement
 * heuristic on `scroll` events and to decide whether a post-frame
 * re-pin should fire.
 *
 * 64px was chosen empirically: it's larger than a typical token
 * streaming height tick (~20-40px of new content per frame) but small
 * enough that a deliberate user scroll past one full message bubble
 * still disengages auto-follow.
 */
export const STICK_ENGAGE_PX = 64

/**
 * Distance beyond which auto-follow disengages. Wider than the engage
 * threshold to provide hysteresis: programmatic re-pin writes and
 * layout-shift echoes don't bounce us between engaged/disengaged.
 */
export const STICK_DISENGAGE_PX = 160

/**
 * Decide whether the transcript is close enough to the bottom that a
 * scroll event should re-engage auto-follow.
 *
 * Returns `true` only when the user has stopped scrolling so close to
 * the bottom that any further streamed content should keep the bottom
 * pinned. Defensive against negative or NaN inputs (which can occur if
 * the scroll container is detached or the layout has briefly produced
 * inconsistent metrics during a reflow).
 */
export function shouldEngageAutoFollow(distanceFromBottom: number): boolean {
  if (!Number.isFinite(distanceFromBottom)) return false
  return distanceFromBottom <= STICK_ENGAGE_PX
}

/**
 * Decide whether the user has scrolled far enough away from the bottom
 * that auto-follow should disengage.
 */
export function shouldDisengageAutoFollow(distanceFromBottom: number): boolean {
  if (!Number.isFinite(distanceFromBottom)) return false
  return distanceFromBottom > STICK_DISENGAGE_PX
}

/**
 * Decide whether a post-frame re-pin should fire after a messages
 * update. Re-pinning is only valuable when auto-follow is still
 * engaged _and_ we have not observed a deliberate user scroll-away
 * since the last paint. The latter guard is critical: without it, a
 * legitimate scroll-up could be fought by the rAF callback writing
 * `scrollTop = scrollHeight` and snapping the user back down.
 */
export function shouldRepinAfterFrame(input: {
  autoFollow: boolean
  userScrolledAwayInThisFrame: boolean
}): boolean {
  if (!input.autoFollow) return false
  if (input.userScrolledAwayInThisFrame) return false
  return true
}
