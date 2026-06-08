import { describe, expect, it } from 'vitest'

import {
  MIN_WORKFLOW_INTERVAL_MS,
  isTerminalWorkflowExecutionStatus,
  normalizeWorkflowTrigger,
  resolveNextWorkflowRunAt
} from './WorkflowScheduler'

describe('WorkflowScheduler', () => {
  it('normalizes interval triggers to the minimum cadence', () => {
    const trigger = normalizeWorkflowTrigger(
      { kind: 'interval', intervalMs: 5_000, startAt: '2026-06-07T10:00:00.000Z' },
      Date.parse('2026-06-07T09:00:00.000Z')
    )

    expect(trigger).toEqual({
      kind: 'interval',
      intervalMs: MIN_WORKFLOW_INTERVAL_MS,
      startAt: '2026-06-07T10:00:00.000Z',
      timezone: undefined
    })
  })

  it('returns undefined for manual and cron triggers', () => {
    const now = Date.parse('2026-06-07T10:00:00.000Z')

    expect(resolveNextWorkflowRunAt({ kind: 'manual' }, now, now)).toBeUndefined()
    expect(resolveNextWorkflowRunAt({ kind: 'cron', cronExpression: '0 9 * * *' }, now, now)).toBeUndefined()
  })

  it('returns a future one-shot timestamp and drops past one-shot triggers', () => {
    const now = Date.parse('2026-06-07T10:00:00.000Z')

    expect(
      resolveNextWorkflowRunAt(
        { kind: 'once', runAt: '2026-06-07T11:00:00.000Z' },
        now,
        now
      )
    ).toBe('2026-06-07T11:00:00.000Z')
    expect(
      resolveNextWorkflowRunAt(
        { kind: 'once', runAt: '2026-06-07T09:00:00.000Z' },
        now,
        now
      )
    ).toBeUndefined()
  })

  it('advances interval triggers beyond the requested floor', () => {
    const now = Date.parse('2026-06-07T10:10:00.000Z')

    expect(
      resolveNextWorkflowRunAt(
        {
          kind: 'interval',
          intervalMs: 10 * 60_000,
          startAt: '2026-06-07T10:00:00.000Z'
        },
        now,
        now
      )
    ).toBe('2026-06-07T10:20:00.000Z')
  })

  it('classifies terminal execution statuses', () => {
    expect(isTerminalWorkflowExecutionStatus('completed')).toBe(true)
    expect(isTerminalWorkflowExecutionStatus('failed')).toBe(true)
    expect(isTerminalWorkflowExecutionStatus('cancelled')).toBe(true)
    expect(isTerminalWorkflowExecutionStatus('skipped')).toBe(true)
    expect(isTerminalWorkflowExecutionStatus('queued')).toBe(false)
    expect(isTerminalWorkflowExecutionStatus('running')).toBe(false)
  })
})
