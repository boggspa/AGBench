import type {
  ChatRecord,
  ChatRun,
  RunRecoveryRecord,
  RunQueueJobStatus
} from '../../../main/store/types'

/**
 * Boot-time bridge between `run-queue.json` recovery records and the
 * per-chat `runs[]` state that the Sidebar reads to paint its
 * "Running"/"Failed"/"Done" badges.
 *
 * Root cause this guards against:
 *
 * TaskWraith was force-quit while a Kimi (or other-provider) Wire-mode
 * child was streaming. The runtime in the main process never fires
 * its terminal handler, so the renderer never receives
 * `run_finished` and never writes `endedAt`/`status` to the persisted
 * `ChatRun`. On the next launch the run queue's reconciler — see
 * `recoverRunQueueJobsAfterStartup` — marks the queue job as
 * `failed`, but the chat's `runs[]` snapshot still has an undefined
 * `endedAt` and undefined `status`. The Sidebar then renders the
 * chat as "Running" forever, even though no live process exists.
 *
 * Pure helper: given a list of recovery records and the existing chat
 * list, returns the same chats with their matching `runs[]` entries
 * backfilled. Records that already terminated normally (the chat run
 * already has `endedAt`) are left alone — the recovery record is a
 * stale historical hint in that case and we trust the renderer's
 * live-event write.
 *
 * Extracted into a standalone module so the regression can be pinned
 * by a Vitest unit test without spinning up an Electron renderer
 * or any IPC plumbing.
 */
export function applyRecoveryRecordsToChatRuns(
  records: ReadonlyArray<RunRecoveryRecord>,
  chats: ReadonlyArray<ChatRecord>
): ChatRecord[] {
  if (records.length === 0 || chats.length === 0) return chats as ChatRecord[]

  const recordsByChatId = new Map<string, RunRecoveryRecord[]>()
  for (const record of records) {
    if (!record.chatId) continue
    const existing = recordsByChatId.get(record.chatId) || []
    existing.push(record)
    recordsByChatId.set(record.chatId, existing)
  }
  if (recordsByChatId.size === 0) return chats as ChatRecord[]

  let anyChatChanged = false
  const next = chats.map((chat) => {
    const chatRecords = recordsByChatId.get(chat.appChatId)
    if (!chatRecords || chatRecords.length === 0) return chat
    const recordByRunId = new Map<string, RunRecoveryRecord>()
    for (const record of chatRecords) {
      // If multiple records target the same run, prefer the latest
      // `recoveredAt`. Older records are stale by definition.
      const existing = recordByRunId.get(record.runId)
      if (
        !existing ||
        new Date(record.recoveredAt).getTime() > new Date(existing.recoveredAt).getTime()
      ) {
        recordByRunId.set(record.runId, record)
      }
    }
    let mutated = false
    const runs = (chat.runs || []).map((run): ChatRun => {
      const record = recordByRunId.get(run.runId)
      if (!record) return run
      // Don't clobber a run that already has a terminal record from
      // the renderer's live `run_finished`/exit handlers. The recovery
      // record is a fallback for the orphan case only.
      if (run.endedAt) return run
      mutated = true
      return {
        ...run,
        endedAt: record.recoveredAt,
        status: mapRecoveryStatusToRunStatus(record.recoveredStatus, run.status)
      }
    })
    if (!mutated) return chat
    anyChatChanged = true
    return { ...chat, runs }
  })
  return anyChatChanged ? next : (chats as ChatRecord[])
}

/**
 * Map the run-queue's recovery status (a `RunQueueJobStatus`) to the
 * `ChatRun.status` string the Sidebar's `getLastRunStatus` reads.
 * Falls back to whatever the run already had if the incoming status
 * isn't one of the terminal values we know how to translate.
 */
export function mapRecoveryStatusToRunStatus(
  recoveredStatus: RunQueueJobStatus,
  fallback?: string
): string {
  switch (recoveredStatus) {
    case 'completed':
      return 'success'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    default:
      // Non-terminal statuses ('queued', 'starting', 'active',
      // 'paused', 'cancelling') should never appear on a recovery
      // record — the reconciler always normalises to a terminal
      // value. If one slips through, default to 'failed' rather than
      // leaving the chat painted as "Running".
      return fallback || 'failed'
  }
}
