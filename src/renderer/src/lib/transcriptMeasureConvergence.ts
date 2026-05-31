/**
 * 1.0.7 — transcript measurement convergence guard.
 *
 * `useTranscriptVirtualization`'s pre-paint measurement effect runs on every
 * commit (no dep array) and calls `bumpMeasure()` (a setState) whenever a
 * mounted row's measured slot height differs from the cached value. Normally
 * this converges in 1–2 passes and stops. But a row whose measured height
 * *oscillates* between two values for the SAME measurement key — which happens
 * mid-chat in Ensemble (several participants streaming at once, scrollbar
 * appear/disappear feedback, sub-pixel reflow) — makes the effect bump on every
 * synchronous pass forever. That spins React's nested-update limit and crashes
 * the transcript surface with "Maximum update depth exceeded".
 *
 * The guard distinguishes two reasons a pass wants to re-measure:
 *   - a NEW key (first measurement of a row/version) → always legit; converge it
 *     and reset the budget. New keys only appear with genuinely new content,
 *     which arrives on yielded commits, so this path can't form a synchronous
 *     loop.
 *   - a REWRITE of an existing key → normal for a pass or two while heights
 *     settle, but a sustained run is the oscillation pathology. Cap consecutive
 *     rewrite-only passes well below React's ~50 limit.
 *
 * Any fully-converged pass (nothing changed) resets the budget, so a legitimate
 * settle followed by a later one each get a fresh allowance — only true
 * never-settling oscillation hits the cap.
 */

/** Max consecutive rewrite-only passes before heights are frozen. Far below
 * React's nested-update limit (~50); a real settle is 1–2 passes. */
export const MAX_MEASURE_REWRITE_PASSES = 12

export interface MeasurePassInput {
  /** A row/version was measured for the first time this pass. */
  sawNewKey: boolean
  /** An already-measured key changed height this pass. */
  sawRewrite: boolean
  /** Consecutive rewrite-only passes so far (caller-held ref). */
  rewritePasses: number
  /** Whether the non-convergence warning has already been emitted this episode. */
  alreadyWarned: boolean
  /** Override the cap (tests). Defaults to MAX_MEASURE_REWRITE_PASSES. */
  maxPasses?: number
}

export interface MeasurePassDecision {
  /** Call bumpMeasure() to request another measurement pass. */
  bump: boolean
  /** New value for the caller's rewrite-pass counter. */
  nextRewritePasses: number
  /** Emit the one-shot non-convergence warning. */
  shouldWarn: boolean
  /** New value for the caller's already-warned flag. */
  nextAlreadyWarned: boolean
}

/**
 * Decide whether the measurement effect should bump again this pass. Pure: the
 * caller owns the `rewritePasses` + `alreadyWarned` state (in refs) and applies
 * the returned next-values.
 */
export function decideMeasurePass(input: MeasurePassInput): MeasurePassDecision {
  const max = input.maxPasses ?? MAX_MEASURE_REWRITE_PASSES

  // Genuine new content/growth: always converge it, reset the oscillation budget
  // and the warning latch.
  if (input.sawNewKey) {
    return { bump: true, nextRewritePasses: 0, shouldWarn: false, nextAlreadyWarned: false }
  }

  // Only existing keys moved — could be normal settling or pathological
  // oscillation. Allow it up to the cap, then freeze.
  if (input.sawRewrite) {
    if (input.rewritePasses < max) {
      return {
        bump: true,
        nextRewritePasses: input.rewritePasses + 1,
        shouldWarn: false,
        nextAlreadyWarned: input.alreadyWarned
      }
    }
    // Cap hit — stop bumping (accept current heights; a sub-pixel oscillation is
    // visually negligible) and warn once so the episode is diagnosable.
    return {
      bump: false,
      nextRewritePasses: input.rewritePasses,
      shouldWarn: !input.alreadyWarned,
      nextAlreadyWarned: true
    }
  }

  // Fully converged — nothing changed. Reset the budget + warning latch so a
  // later legitimate settle gets a fresh allowance.
  return { bump: false, nextRewritePasses: 0, shouldWarn: false, nextAlreadyWarned: false }
}
