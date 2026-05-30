import { describe, expect, it, vi } from 'vitest'
import { RemoteQuestionRegistry, type RemoteQuestionResolution } from './RemoteQuestionRegistry'

describe('RemoteQuestionRegistry', () => {
  it('registers question metadata and lists projection cards', () => {
    let resolved: RemoteQuestionResolution | null = null
    const registry = new RemoteQuestionRegistry({
      now: () => Date.UTC(2026, 4, 30, 12, 0, 0),
      idFactory: () => 'q-generated',
      setTimer: () => 'timer',
      clearTimer: vi.fn()
    })

    const record = registry.register({
      question: 'Which path should I take?',
      options: ['Safe', 'Fast', ''],
      context: 'Need a decision before editing.',
      provider: 'codex',
      workspaceId: 'ws-1',
      workspacePath: '/repo',
      threadId: 'chat-1',
      runId: 'run-1',
      resolve: (result) => {
        resolved = result
      }
    })

    expect(record).toMatchObject({
      questionId: 'q-generated',
      promptId: 'q-generated',
      question: 'Which path should I take?',
      options: ['Safe', 'Fast'],
      provider: 'codex',
      workspaceId: 'ws-1',
      threadId: 'chat-1',
      runId: 'run-1',
      status: 'pending'
    })
    expect(registry.listProjectionCards()).toEqual([
      expect.objectContaining({
        promptId: 'q-generated',
        question: 'Which path should I take?',
        options: ['Safe', 'Fast'],
        status: 'pending'
      })
    ])
    expect(resolved).toBeNull()
  })

  it('answers a pending question exactly once', () => {
    let resolved: RemoteQuestionResolution | null = null
    const clearTimer = vi.fn()
    const registry = new RemoteQuestionRegistry({
      now: () => Date.UTC(2026, 4, 30, 12, 0, 0),
      setTimer: () => 'timer',
      clearTimer
    })
    registry.register({
      questionId: 'q1',
      question: 'Continue?',
      resolve: (result) => {
        resolved = result
      }
    })

    expect(registry.answer('q1', 'Yes', true)).toMatchObject({ ok: true })
    expect(resolved).toEqual({ answer: 'Yes', is_custom: true })
    expect(clearTimer).toHaveBeenCalledWith('timer')
    expect(registry.listPending()).toHaveLength(0)
    expect(registry.answer('q1', 'Again')).toEqual({ ok: false, reason: 'not-found' })
  })

  it('rejects and resolves as a cancellation', () => {
    let resolved: RemoteQuestionResolution | null = null
    const registry = new RemoteQuestionRegistry({
      now: () => Date.UTC(2026, 4, 30, 12, 0, 0),
      setTimer: () => 'timer',
      clearTimer: vi.fn()
    })
    registry.register({
      questionId: 'q1',
      question: 'Continue?',
      resolve: (result) => {
        resolved = result
      }
    })

    const result = registry.reject('q1', 'user-dismissed')
    expect(result.record).toMatchObject({
      questionId: 'q1',
      status: 'rejected',
      cancellationReason: 'user-dismissed'
    })
    expect(resolved).toEqual({
      answer: '',
      is_custom: false,
      cancelled: true,
      cancellation_reason: 'user-dismissed'
    })
  })

  it('sweeps stale questions by expiry', () => {
    let now = 1_000
    let resolved: RemoteQuestionResolution | null = null
    const registry = new RemoteQuestionRegistry({
      now: () => now,
      setTimer: () => 'timer',
      clearTimer: vi.fn()
    })
    registry.register({
      questionId: 'q1',
      question: 'Still there?',
      ttlMs: 50,
      resolve: (result) => {
        resolved = result
      }
    })

    now = 1_049
    expect(registry.sweepStale()).toHaveLength(0)
    now = 1_050
    const expired = registry.sweepStale()
    expect(expired).toHaveLength(1)
    expect(expired[0]).toMatchObject({ questionId: 'q1', status: 'expired' })
    expect(resolved).toEqual({
      answer: '',
      is_custom: false,
      cancelled: true,
      cancellation_reason: 'timeout'
    })
  })

  it('cancels all pending questions for a run', () => {
    const registry = new RemoteQuestionRegistry({
      now: () => Date.UTC(2026, 4, 30, 12, 0, 0),
      setTimer: () => 'timer',
      clearTimer: vi.fn()
    })
    registry.register({ questionId: 'q1', question: 'One?', runId: 'run-1', resolve: vi.fn() })
    registry.register({ questionId: 'q2', question: 'Two?', runId: 'run-2', resolve: vi.fn() })

    expect(registry.cancelForRun('run-1', 'run-cancelled').map((r) => r.questionId)).toEqual(['q1'])
    expect(registry.listPending().map((r) => r.questionId)).toEqual(['q2'])
  })
})
