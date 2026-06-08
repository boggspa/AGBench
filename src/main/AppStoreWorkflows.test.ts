import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import { AppStore } from './store'
import type { WorkflowDefinition } from './store/types'

const userDataPath = vi.hoisted(() => `/tmp/taskwraith-workflows-test-${process.pid}`)

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataPath
  }
}))

const plannedFor = '2026-06-07T20:00:00.000Z'
const intervalMs = 15 * 60_000

function workflowInput(
  overrides: Partial<
    Omit<WorkflowDefinition, 'id' | 'createdAt' | 'updatedAt' | 'history' | 'failureStreak'>
  > &
    Partial<Pick<WorkflowDefinition, 'history' | 'failureStreak'>> = {}
) {
  return {
    name: 'Audit loop',
    workspaceId: 'ws-1',
    workspacePath: '/repo',
    enabled: true,
    trigger: {
      kind: 'interval' as const,
      intervalMs,
      startAt: plannedFor,
      timezone: 'Europe/London'
    },
    template: {
      workspaceId: 'ws-1',
      workspacePath: '/repo',
      chatId: 'chat-1',
      provider: 'codex' as const,
      prompt: 'Review the current diff.',
      selectedModelType: 'cli-default',
      customModel: '',
      approvalMode: 'default',
      sessionTrust: false,
      imageAttachments: []
    },
    missedRunPolicy: 'coalesce' as const,
    concurrencyPolicy: 'skip' as const,
    limits: {
      maxRunsPerDay: 24,
      maxConsecutiveFailures: 3
    },
    nextRunAt: plannedFor,
    ...overrides
  }
}

describe('AppStore workflows', () => {
  beforeEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true })
    fs.mkdirSync(userDataPath, { recursive: true })
  })

  it('materializes a due workflow into a scheduled task and advances the next run', () => {
    const saved = AppStore.saveWorkflowDefinition(workflowInput())
    const tasks = AppStore.materializeDueWorkflows(Date.parse(plannedFor))

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      workspaceId: 'ws-1',
      provider: 'codex',
      status: 'due',
      workflowId: saved.id,
      workflowOccurrenceAt: plannedFor
    })

    const workflow = AppStore.getWorkflowDefinition(saved.id)
    expect(workflow?.lastStatus).toBe('queued')
    expect(workflow?.activeExecutionId).toBe(tasks[0].workflowExecutionId)
    expect(workflow?.history[0]?.scheduledTaskId).toBe(tasks[0].id)
    expect(workflow?.nextRunAt).toBe(new Date(Date.parse(plannedFor) + intervalMs).toISOString())
  })

  it('advances a skipped due occurrence when an execution is already active', () => {
    const saved = AppStore.saveWorkflowDefinition(
      workflowInput({
        missedRunPolicy: 'skip',
        activeExecutionId: 'execution-active',
        history: [
          {
            id: 'execution-active',
            workflowId: 'workflow-pending',
            plannedFor: '2026-06-07T19:45:00.000Z',
            status: 'running',
            createdAt: '2026-06-07T19:45:00.000Z',
            updatedAt: '2026-06-07T19:46:00.000Z'
          }
        ]
      })
    )

    const tasks = AppStore.materializeDueWorkflows(Date.parse(plannedFor))

    expect(tasks).toHaveLength(0)
    const workflow = AppStore.getWorkflowDefinition(saved.id)
    expect(workflow?.lastStatus).toBe('skipped')
    expect(workflow?.lastError).toMatch(/previous workflow execution is still active/)
    expect(workflow?.history).toHaveLength(2)
    expect(workflow?.nextRunAt).toBe(new Date(Date.parse(plannedFor) + intervalMs).toISOString())
  })

  it('syncs scheduled task completion back into workflow history', () => {
    const saved = AppStore.saveWorkflowDefinition(workflowInput())
    const [task] = AppStore.materializeDueWorkflows(Date.parse(plannedFor))

    const running = AppStore.updateScheduledTask(task.id, {
      status: 'running',
      runId: 'run-1',
      firedAt: '2026-06-07T20:00:01.000Z'
    })
    expect(running?.status).toBe('running')
    expect(AppStore.getWorkflowDefinition(saved.id)?.lastStatus).toBe('running')

    AppStore.updateScheduledTask(task.id, {
      status: 'completed',
      completedAt: '2026-06-07T20:01:00.000Z'
    })

    const workflow = AppStore.getWorkflowDefinition(saved.id)
    expect(workflow?.lastStatus).toBe('completed')
    expect(workflow?.activeExecutionId).toBeUndefined()
    expect(workflow?.history[0]).toMatchObject({
      runId: 'run-1',
      status: 'completed',
      completedAt: '2026-06-07T20:01:00.000Z'
    })
  })
})
