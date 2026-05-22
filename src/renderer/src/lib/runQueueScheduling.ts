/**
 * Find the first queued job that can dispatch right now.
 *
 * Previously the signature took `isProviderBusy(provider)` and the
 * helper computed busy-ness internally. That assumed at most one run
 * per provider at a time. The user's observed regression — typing
 * into chat B while chat A is running same-provider gets queued — is
 * the symptom: provider-level busy is too coarse, multiple chats can
 * legitimately run on the same provider in parallel (Codex CLI's
 * app-server handles concurrent threads, Claude SDK is per-call,
 * Gemini/Kimi spawn fresh processes per run).
 *
 * Generalised to accept a per-job `canDispatch(job)` predicate so the
 * caller decides — per-chat busy, per-workspace busy, scheduled-task
 * windowing, etc. — without further signature churn.
 */
export function findNextRunnableQueueIndex<T>(jobs: T[], canDispatch: (job: T) => boolean): number {
  if (!jobs || jobs.length === 0) return -1
  return jobs.findIndex((job) => canDispatch(job))
}
