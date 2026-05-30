import { describe, expect, it } from 'vitest'
import type {
  ChatMessage,
  ChildAgentInteractivity,
  ProviderId,
  ToolActivity
} from '../../../main/store/types'
import {
  deriveChildAgentThreads,
  deriveChildAgentThreadsFromActivities,
  findChildActivitiesForThread
} from './ChildAgentThreads'

function activity(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    id: 'tool-1',
    toolName: 'task',
    displayName: 'Task',
    category: 'task',
    status: 'success',
    ...overrides
  }
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    role: 'assistant',
    content: '',
    timestamp: '2026-05-30T12:00:00.000Z',
    ...overrides
  }
}

describe('deriveChildAgentThreadsFromActivities', () => {
  it('infers child-agent kind and interactivity for every provider', () => {
    const cases: Array<[ProviderId, string, ChildAgentInteractivity]> = [
      ['gemini', 'gemini-subagent', 'oneshot'],
      ['codex', 'codex-background', 'interactive'],
      ['claude', 'claude-task', 'oneshot'],
      ['kimi', 'kimi-swarm', 'observe-only'],
      ['grok', 'grok-agent', 'oneshot'],
      ['cursor', 'cursor-agent', 'interactive']
    ]

    for (const [provider, kind, interactivity] of cases) {
      const [thread] = deriveChildAgentThreadsFromActivities(provider, 'chat-1', 'run-1', [
        activity({ id: `${provider}-task` })
      ])

      expect(thread).toMatchObject({
        id: `${provider}-task`,
        provider,
        kind,
        interactivity
      })
    }
  })

  it('falls back to the Gemini subagent shape for unknown provider ids', () => {
    const [thread] = deriveChildAgentThreadsFromActivities(
      'unknown' as ProviderId,
      'chat-1',
      'run-1',
      [activity()]
    )

    expect(thread.kind).toBe('gemini-subagent')
    expect(thread.interactivity).toBe('oneshot')
  })

  it('keeps explicit task-like activities and ignores task-category progress markers', () => {
    const threads = deriveChildAgentThreadsFromActivities('claude', 'chat-1', 'run-1', [
      activity({
        id: 'plan-1',
        toolName: 'codex_plan',
        displayName: 'Plan',
        category: 'task'
      }),
      activity({
        id: 'task-1',
        toolName: 'Task',
        parameters: {
          description: 'Review the diff',
          subagent_type: 'Reviewer',
          prompt: 'Check the changed files'
        },
        status: 'running',
        startedAt: '2026-05-30T12:00:01.000Z',
        durationMs: 42
      }),
      activity({
        id: 'child-read-1',
        toolName: 'read_file',
        displayName: 'Read file',
        category: 'read',
        parentToolCallId: 'task-1'
      })
    ])

    expect(threads).toHaveLength(1)
    expect(threads[0]).toMatchObject({
      id: 'task-1',
      parentChatId: 'chat-1',
      parentRunId: 'run-1',
      parentToolCallId: 'task-1',
      provider: 'claude',
      kind: 'claude-task',
      interactivity: 'oneshot',
      name: 'Review the diff',
      role: 'Reviewer',
      state: 'running',
      startedAt: '2026-05-30T12:00:01.000Z',
      durationMs: 42,
      seedPrompt: 'Check the changed files',
      toolActivityIds: ['child-read-1']
    })
  })
})

describe('deriveChildAgentThreads', () => {
  it('walks chat messages, keeps the first run id, and finds child activities', () => {
    const child = activity({
      id: 'child-shell-1',
      toolName: 'run_shell_command',
      displayName: 'Shell',
      category: 'shell',
      parentToolCallId: 'task-1'
    })
    const messages = [
      message({
        id: 'message-1',
        runId: 'run-a',
        toolActivities: [
          activity({
            id: 'task-1',
            parameters: { task: 'Investigate failure', input: 'Look at logs' },
            outputPreview: 'Found a failing assertion.'
          })
        ]
      }),
      message({
        id: 'message-2',
        runId: 'run-b',
        toolActivities: [child]
      })
    ]

    const [thread] = deriveChildAgentThreads('codex', 'chat-1', messages)

    expect(thread).toMatchObject({
      id: 'task-1',
      parentRunId: 'run-a',
      kind: 'codex-background',
      interactivity: 'interactive',
      name: 'Investigate failure',
      seedPrompt: 'Look at logs',
      finalResult: 'Found a failing assertion.',
      state: 'completed',
      toolActivityIds: ['child-shell-1']
    })
    expect(findChildActivitiesForThread(thread, messages)).toEqual([child])
  })
})
