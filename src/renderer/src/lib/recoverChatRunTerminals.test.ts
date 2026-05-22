import { describe, expect, it } from 'vitest'

import {
  applyRecoveryRecordsToChatRuns,
  mapRecoveryStatusToRunStatus
} from './recoverChatRunTerminals'
import type { ChatRecord, RunRecoveryRecord } from '../../../main/store/types'

function makeChat(overrides: Partial<ChatRecord> & Pick<ChatRecord, 'appChatId'>): ChatRecord {
  return {
    title: 'Test chat',
    createdAt: 0,
    updatedAt: 0,
    archived: false,
    messages: [],
    runs: [],
    ...overrides
  }
}

function makeRecord(
  overrides: Partial<RunRecoveryRecord> & Pick<RunRecoveryRecord, 'runId' | 'chatId'>
): RunRecoveryRecord {
  return {
    schemaVersion: 1,
    id: `${overrides.runId}-record`,
    jobId: overrides.runId,
    provider: 'kimi',
    previousStatus: 'active',
    recoveredStatus: 'failed',
    action: 'marked_failed',
    reason: 'Run was active when AGBench last exited.',
    recoveredAt: '2026-05-16T12:00:00.000Z',
    resumeAvailable: false,
    resumeHint: '',
    jobSnapshot: {},
    ...overrides
  }
}

describe('applyRecoveryRecordsToChatRuns', () => {
  it('returns the original chats untouched when there are no recovery records', () => {
    const chats = [makeChat({ appChatId: 'chat-1' })]
    expect(applyRecoveryRecordsToChatRuns([], chats)).toBe(chats)
  })

  it('returns the original chats untouched when no records match any chat', () => {
    const chats = [makeChat({ appChatId: 'chat-1' })]
    const records = [makeRecord({ runId: 'run-1', chatId: 'unrelated' })]
    expect(applyRecoveryRecordsToChatRuns(records, chats)).toBe(chats)
  })

  it('regression: backfills endedAt and status on a Kimi run that was force-quit mid-stream', () => {
    // This is the exact shape the user hit on disk: chat 011285d5's
    // last Kimi run has `status=undefined` and `endedAt=undefined`,
    // but `run-queue.json` recorded a recovery with status='failed'.
    // Before this helper, the Sidebar painted "Running" forever.
    const chats = [
      makeChat({
        appChatId: 'chat-stuck',
        provider: 'kimi',
        runs: [
          {
            runId: 'run-finished',
            startedAt: '2026-05-14T17:12:48.826Z',
            endedAt: '2026-05-14T17:15:42.424Z',
            status: 'success'
          },
          {
            runId: 'run-orphan',
            startedAt: '2026-05-14T17:15:48.968Z'
            // No `endedAt`, no `status` — this is the stuck row.
          }
        ]
      })
    ]
    const records = [
      makeRecord({
        runId: 'run-orphan',
        chatId: 'chat-stuck',
        recoveredStatus: 'failed',
        recoveredAt: '2026-05-14T17:23:45.597Z'
      })
    ]
    const result = applyRecoveryRecordsToChatRuns(records, chats)
    expect(result[0].runs).toHaveLength(2)
    expect(result[0].runs[0]).toEqual(chats[0].runs[0]) // earlier completed run untouched
    expect(result[0].runs[1]).toMatchObject({
      runId: 'run-orphan',
      startedAt: '2026-05-14T17:15:48.968Z',
      endedAt: '2026-05-14T17:23:45.597Z',
      status: 'failed'
    })
  })

  it('does not overwrite a chat run that already has its terminal endedAt', () => {
    // Defensive: a recovery record might exist for a runId that
    // actually completed cleanly between captures. The renderer's
    // live `run_finished` handler is the source of truth — keep it.
    const chats = [
      makeChat({
        appChatId: 'chat-1',
        runs: [
          {
            runId: 'run-done',
            startedAt: 'start',
            endedAt: 'end',
            status: 'success'
          }
        ]
      })
    ]
    const records = [
      makeRecord({
        runId: 'run-done',
        chatId: 'chat-1',
        recoveredStatus: 'failed',
        recoveredAt: 'later'
      })
    ]
    expect(applyRecoveryRecordsToChatRuns(records, chats)).toBe(chats)
  })

  it('prefers the latest recovery record when multiple target the same run', () => {
    const chats = [
      makeChat({
        appChatId: 'chat-1',
        runs: [{ runId: 'run-x', startedAt: 'start' }]
      })
    ]
    const records = [
      makeRecord({
        runId: 'run-x',
        chatId: 'chat-1',
        recoveredStatus: 'failed',
        recoveredAt: '2026-05-14T10:00:00.000Z'
      }),
      makeRecord({
        runId: 'run-x',
        chatId: 'chat-1',
        recoveredStatus: 'completed',
        recoveredAt: '2026-05-14T11:00:00.000Z'
      })
    ]
    const result = applyRecoveryRecordsToChatRuns(records, chats)
    expect(result[0].runs[0]).toMatchObject({
      runId: 'run-x',
      endedAt: '2026-05-14T11:00:00.000Z',
      status: 'success'
    })
  })

  it('only touches chats whose appChatId is referenced by a record', () => {
    const chats = [
      makeChat({
        appChatId: 'chat-1',
        runs: [{ runId: 'run-1', startedAt: 'start' }]
      }),
      makeChat({
        appChatId: 'chat-2',
        runs: [{ runId: 'run-2', startedAt: 'start' }]
      })
    ]
    const records = [makeRecord({ runId: 'run-2', chatId: 'chat-2', recoveredAt: 'later' })]
    const result = applyRecoveryRecordsToChatRuns(records, chats)
    expect(result[0]).toBe(chats[0]) // chat-1 reference-equal
    expect(result[1]).not.toBe(chats[1])
    expect(result[1].runs[0]).toMatchObject({ endedAt: 'later', status: 'failed' })
  })

  it('skips records without a chatId', () => {
    const chats = [
      makeChat({
        appChatId: 'chat-1',
        runs: [{ runId: 'run-1', startedAt: 'start' }]
      })
    ]
    const records = [makeRecord({ runId: 'run-1', chatId: undefined })]
    expect(applyRecoveryRecordsToChatRuns(records, chats)).toBe(chats)
  })

  it('returns chats unchanged if every matching run already has an endedAt', () => {
    const chats = [
      makeChat({
        appChatId: 'chat-1',
        runs: [
          { runId: 'run-1', startedAt: 'a', endedAt: 'b', status: 'success' },
          { runId: 'run-2', startedAt: 'c', endedAt: 'd', status: 'success' }
        ]
      })
    ]
    const records = [
      makeRecord({ runId: 'run-1', chatId: 'chat-1' }),
      makeRecord({ runId: 'run-2', chatId: 'chat-1' })
    ]
    expect(applyRecoveryRecordsToChatRuns(records, chats)).toBe(chats)
  })
})

describe('mapRecoveryStatusToRunStatus', () => {
  it("maps 'completed' to 'success'", () => {
    expect(mapRecoveryStatusToRunStatus('completed')).toBe('success')
  })

  it("passes 'failed' through unchanged", () => {
    expect(mapRecoveryStatusToRunStatus('failed')).toBe('failed')
  })

  it("passes 'cancelled' through unchanged", () => {
    expect(mapRecoveryStatusToRunStatus('cancelled')).toBe('cancelled')
  })

  it("falls back to 'failed' for a non-terminal status", () => {
    expect(mapRecoveryStatusToRunStatus('active')).toBe('failed')
  })

  it('prefers the existing fallback when one is provided for a non-terminal status', () => {
    expect(mapRecoveryStatusToRunStatus('queued', 'success_with_warnings')).toBe(
      'success_with_warnings'
    )
  })
})
