import { describe, expect, it } from 'vitest'
import {
  createRunQueueJob,
  filterRunQueueJobs,
  recoverInterruptedRunQueueJobs,
  sortRunQueueJobs,
  updateRunQueueJobRecord
} from './RunQueue'

describe('RunQueue', () => {
  it('creates a durable queued job with a compact request preview', () => {
    const job = createRunQueueJob(
      {
        id: 'run-1',
        runId: 'run-1',
        provider: 'gemini',
        workspaceId: 'workspace-1',
        workspacePath: '/workspace',
        chatId: 'chat-1',
        source: 'manual',
        request: {
          prompt: '  Inspect   this workspace and summarize the next step.  ',
          selectedModelType: 'flash-lite',
          customModel: '',
          approvalMode: 'default',
          sessionTrust: false,
          imageAttachments: []
        }
      },
      '2026-05-06T00:00:00.000Z'
    )

    expect(job.status).toBe('queued')
    expect(job.enqueuedAt).toBe('2026-05-06T00:00:00.000Z')
    expect(job.promptPreview).toBe('Inspect this workspace and summarize the next step.')
    expect(job.attempt).toBe(1)
  })

  it('creates global queued jobs without workspace fields', () => {
    const job = createRunQueueJob(
      {
        id: 'global-run-1',
        runId: 'global-run-1',
        provider: 'codex',
        scope: 'global',
        chatId: 'global-chat-1',
        source: 'manual',
        request: {
          scope: 'global',
          prompt: 'Search online and sketch options.',
          selectedModelType: 'gpt-5.5',
          customModel: '',
          approvalMode: 'default',
          sessionTrust: false,
          imageAttachments: []
        }
      },
      '2026-05-06T00:00:00.000Z'
    )

    expect(job.scope).toBe('global')
    expect(job.workspacePath).toBeUndefined()
    expect(job.workspaceId).toBeUndefined()
    expect(job.status).toBe('queued')
  })

  it('persists active and terminal timestamps during transitions', () => {
    const queued = createRunQueueJob(
      {
        id: 'run-1',
        runId: 'run-1',
        provider: 'codex',
        workspacePath: '/workspace',
        source: 'manual'
      },
      '2026-05-06T00:00:00.000Z'
    )
    const active = updateRunQueueJobRecord(
      queued,
      { status: 'active', processPid: 123 },
      '2026-05-06T00:01:00.000Z'
    )
    const failed = updateRunQueueJobRecord(
      active,
      { status: 'failed', lastError: 'Process exited 1' },
      '2026-05-06T00:02:00.000Z'
    )

    expect(active.startedAt).toBe('2026-05-06T00:01:00.000Z')
    expect(active.processPid).toBe(123)
    expect(failed.failedAt).toBe('2026-05-06T00:02:00.000Z')
    expect(failed.endedAt).toBe('2026-05-06T00:02:00.000Z')
    expect(failed.lastError).toBe('Process exited 1')
  })

  it('preserves the first terminal job status when late updates arrive', () => {
    const cancelled = createRunQueueJob(
      {
        id: 'run-1',
        runId: 'run-1',
        provider: 'gemini',
        workspacePath: '/workspace',
        source: 'manual',
        status: 'cancelled'
      },
      '2026-05-06T00:02:00.000Z'
    )

    const lateFailure = updateRunQueueJobRecord(
      cancelled,
      { status: 'failed', lastError: 'Late process close' },
      '2026-05-06T00:03:00.000Z'
    )

    expect(lateFailure.status).toBe('cancelled')
    expect(lateFailure.cancelledAt).toBe('2026-05-06T00:02:00.000Z')
    expect(lateFailure.failedAt).toBeUndefined()
    expect(lateFailure.lastError).toBe('Late process close')
  })

  it('recovers active jobs as failed on startup while leaving queued jobs alone', () => {
    const queued = createRunQueueJob({
      id: 'queued',
      runId: 'queued',
      provider: 'gemini',
      workspacePath: '/workspace',
      source: 'manual'
    })
    const active = createRunQueueJob({
      id: 'active',
      runId: 'active',
      provider: 'codex',
      workspacePath: '/workspace',
      source: 'manual',
      status: 'active'
    })

    const recovered = recoverInterruptedRunQueueJobs([queued, active], '2026-05-06T00:03:00.000Z')

    expect(recovered.find((job) => job.id === 'queued')?.status).toBe('queued')
    const recoveredActive = recovered.find((job) => job.id === 'active')
    expect(recoveredActive?.status).toBe('failed')
    expect(recoveredActive?.recoveryReason).toBe('marked_failed_on_startup')
    expect(recoveredActive?.failedAt).toBe('2026-05-06T00:03:00.000Z')
  })

  it('filters and sorts jobs by active work before queued and terminal history', () => {
    const jobs = [
      createRunQueueJob({
        id: 'done',
        runId: 'done',
        provider: 'gemini',
        workspacePath: '/a',
        source: 'manual',
        status: 'completed'
      }),
      createRunQueueJob({
        id: 'queued',
        runId: 'queued',
        provider: 'gemini',
        workspacePath: '/a',
        source: 'manual',
        status: 'queued'
      }),
      createRunQueueJob({
        id: 'active',
        runId: 'active',
        provider: 'codex',
        workspacePath: '/b',
        source: 'manual',
        status: 'active'
      })
    ]

    expect(sortRunQueueJobs(jobs).map((job) => job.id)).toEqual(['active', 'queued', 'done'])
    expect(filterRunQueueJobs(jobs).map((job) => job.id)).toEqual(['queued', 'active'])
    expect(filterRunQueueJobs(jobs, { statuses: ['completed'] }).map((job) => job.id)).toEqual([
      'done'
    ])
  })
})
