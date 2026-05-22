import type { ChatMessage, ChatRecord } from '../../../main/store/types'

export type DelegationCardStatus =
  | { kind: 'created' }
  | { kind: 'running' }
  | { kind: 'completed' }
  | { kind: 'failed'; reason?: string }
  | { kind: 'cancelled'; reason?: string }
  | { kind: 'returned' }
  | { kind: 'unknown' }

export function isSubThreadDelegationMessage(message: ChatMessage): boolean {
  return message.role === 'system' && message.metadata?.kind === 'subThreadDelegation'
}

/** Determine the visible status of a sub-thread based on its persisted
 * runs + the live run-queue. Pure helper so it's trivially testable + so
 * the parent transcript can re-render without per-card subscriptions. */
export function resolveDelegationStatus(
  subThread: ChatRecord | undefined,
  runningChatIds: Set<string>
): DelegationCardStatus {
  if (!subThread) return { kind: 'unknown' }
  if (runningChatIds.has(subThread.appChatId)) return { kind: 'running' }

  if (subThread.delegationContext?.dispatchError) {
    return {
      kind: 'failed',
      reason: 'Failed to start'
    }
  }

  const lastRun = subThread.runs?.[subThread.runs.length - 1]
  if (!lastRun) {
    // Sub-thread exists but no run has been recorded yet.
    return { kind: 'created' }
  }
  if (
    lastRun.status === 'running' ||
    lastRun.status === 'queued' ||
    lastRun.status === 'starting' ||
    lastRun.status === 'active' ||
    lastRun.status === 'paused'
  ) {
    return { kind: 'running' }
  }
  const resultReturnedAt = subThread.delegationContext?.resultReturnedAt
  const lastRunEndedAt = lastRun.endedAt ? Date.parse(lastRun.endedAt) : NaN
  if (
    resultReturnedAt &&
    (!Number.isFinite(lastRunEndedAt) || lastRunEndedAt <= resultReturnedAt)
  ) {
    return { kind: 'returned' }
  }
  if (lastRun.status === 'success' || lastRun.status === 'success_with_warnings') {
    return { kind: 'completed' }
  }
  if (lastRun.status === 'failed') return { kind: 'failed', reason: 'Run failed' }
  if (lastRun.status === 'cancelled') return { kind: 'cancelled', reason: 'Run cancelled' }
  if (!lastRun.endedAt) return { kind: 'running' }
  return { kind: 'unknown' }
}
