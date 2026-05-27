/**
 * 1.0.5-C4 — Approval budget tracker.
 *
 * Runtime counter that pairs with `PermissionEnvelope.approvalBudget`
 * to prevent delegation-loop approval spam. The envelope carries
 * the cap; this tracker holds the consumed-so-far count per
 * envelope id. When the consumed count crosses the cap, future
 * approval requests against that envelope return `'exhausted'`
 * and the orchestrator surfaces the rejection back to the
 * parent / router / user.
 *
 * In-memory only — counts reset on app restart along with the
 * lanes / envelopes they tracked. Persistence would matter for
 * cross-session budgets but envelopes themselves are tied to
 * runtime sub-thread delegations that don't survive a process
 * exit anyway.
 *
 * All methods are pure-ish (mutate the internal Map; no other
 * side effects). `getConsumed` returns a snapshot integer so
 * callers can't accidentally mutate internal state.
 */

export type ApprovalBudgetDecision = 'allowed' | 'exhausted'

export interface BudgetSnapshot {
  envelopeId: string
  consumed: number
  budget: number | undefined
}

export class ApprovalBudgetTracker {
  /** envelopeId → consumed count */
  private consumedById = new Map<string, number>()

  /**
   * Decide whether to allow + consume one approval slot for the
   * envelope. Returns `'allowed'` (and increments the consumed
   * count) or `'exhausted'` (and leaves the count untouched).
   *
   * `budget === undefined` means no cap — always allowed. `0`
   * means zero approvals permitted (the call always returns
   * `'exhausted'` and never increments).
   *
   * Negative or non-finite budgets are treated as `0` (defensive
   * — if a malformed envelope claims a negative cap we refuse
   * rather than silently allow).
   */
  tryConsume(envelopeId: string, budget: number | undefined): ApprovalBudgetDecision {
    if (!envelopeId) return 'allowed' // top-level approvals with no envelope: pass-through
    if (budget === undefined) return 'allowed'
    const cap = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0
    const consumed = this.consumedById.get(envelopeId) ?? 0
    if (consumed >= cap) return 'exhausted'
    this.consumedById.set(envelopeId, consumed + 1)
    return 'allowed'
  }

  /**
   * Read the consumed count for an envelope. Returns 0 when the
   * envelope has never registered an approval. Pure read — does
   * not affect state.
   */
  getConsumed(envelopeId: string): number {
    return this.consumedById.get(envelopeId) ?? 0
  }

  /**
   * Compute the remaining budget. Returns `Infinity` when no
   * cap is set, 0 when fully exhausted. Useful for the
   * orchestrator to surface "1 of 5 approvals remaining" in
   * the UI.
   */
  getRemaining(envelopeId: string, budget: number | undefined): number {
    if (budget === undefined) return Number.POSITIVE_INFINITY
    const cap = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0
    return Math.max(0, cap - this.getConsumed(envelopeId))
  }

  /**
   * Release one previously-consumed slot. Used when an approval
   * is cancelled / withdrawn before resolution and we want to
   * give the slot back to the envelope. Clamped at 0 — never
   * goes negative. Returns the new consumed count.
   */
  releaseOne(envelopeId: string): number {
    if (!envelopeId) return 0
    const current = this.consumedById.get(envelopeId) ?? 0
    const next = Math.max(0, current - 1)
    if (next === 0) {
      this.consumedById.delete(envelopeId)
    } else {
      this.consumedById.set(envelopeId, next)
    }
    return next
  }

  /**
   * Clear the counter for an envelope (e.g. on lane termination
   * or envelope expiry). The next `tryConsume` against this id
   * starts fresh at 0. Returns the count that was discarded.
   */
  reset(envelopeId: string): number {
    if (!envelopeId) return 0
    const prior = this.consumedById.get(envelopeId) ?? 0
    this.consumedById.delete(envelopeId)
    return prior
  }

  /**
   * Read-only snapshot of every envelope's consumed count.
   * Returned as an array of `{ envelopeId, consumed, budget }`
   * (with `budget` left undefined since the tracker doesn't
   * know the cap; callers re-attach it from the envelope). Used
   * by the orchestrator + a future debug IPC.
   */
  snapshot(): BudgetSnapshot[] {
    return Array.from(this.consumedById.entries()).map(([envelopeId, consumed]) => ({
      envelopeId,
      consumed,
      budget: undefined
    }))
  }

  /** Test-only reset of all state. */
  __reset(): void {
    this.consumedById.clear()
  }
}

/**
 * Pure helper for the simple case: would this approval be
 * allowed *if* we tried to consume? Doesn't mutate state. Used
 * for pre-flight UI affordances ("only 1 approval left — confirm
 * before sending?"). Mirrors `tryConsume`'s decision rules
 * without the side effect.
 */
export function decideApproval({
  budget,
  consumed
}: {
  budget: number | undefined
  consumed: number
}): ApprovalBudgetDecision {
  if (budget === undefined) return 'allowed'
  const cap = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0
  return consumed >= cap ? 'exhausted' : 'allowed'
}
