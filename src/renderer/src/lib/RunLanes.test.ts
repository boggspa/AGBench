import { describe, expect, it } from 'vitest'
import type { ChatRecord, RunQueueJob, ScheduledTask, RuntimeProfile } from '../../../main/store/types'
import { buildRunLanes } from './RunLanes'

const now = '2026-05-12T10:00:00.000Z'

const chat = (overrides: Partial<ChatRecord> = {}): ChatRecord => ({
  appChatId: 'chat-1',
  title: 'Workspace thread',
  workspaceId: 'workspace-1',
  workspacePath: '/repo',
  createdAt: 1,
  updatedAt: 1,
  archived: false,
  messages: [],
  runs: [],
  ...overrides
})

const runtimeProfile = (overrides: Partial<RuntimeProfile> = {}): RuntimeProfile => ({
  id: 'profile-1',
  name: 'Codex worktree',
  provider: 'codex',
  scope: 'workspace',
  workspaceMode: 'worktree',
  env: {},
  networkPolicy: 'inherit',
  persistence: 'reusable',
  createdAt: now,
  updatedAt: now,
  ...overrides
})

const queuedJob = (overrides: Partial<RunQueueJob> = {}): RunQueueJob => ({
  id: 'run-1',
  runId: 'run-1',
  provider: 'codex',
  scope: 'workspace',
  workspaceId: 'workspace-1',
  workspacePath: '/repo',
  chatId: 'chat-1',
  source: 'manual',
  status: 'queued',
  priority: 0,
  attempt: 1,
  promptPreview: 'queued prompt',
  runtimeProfileId: 'profile-1',
  handoffSourceRunId: 'source-run',
  createdAt: now,
  updatedAt: now,
  ...overrides
})

const scheduledTask = (overrides: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: 'task-1',
  workspaceId: 'workspace-1',
  workspacePath: '/repo',
  chatId: 'chat-1',
  provider: 'gemini',
  prompt: 'scheduled prompt',
  selectedModelType: 'flash-lite',
  customModel: '',
  approvalMode: 'default',
  sessionTrust: false,
  imageAttachments: [],
  runtimeProfileId: 'profile-2',
  runAt: '2026-05-12T11:00:00.000Z',
  timezone: 'Europe/London',
  status: 'due',
  createdAt: now,
  updatedAt: now,
  ...overrides
})

describe('buildRunLanes', () => {
  it('normalizes queued, scheduled, and completed runs into one lane model', () => {
    const sourceChat = chat({
      messages: [{ id: 'msg-1', role: 'user', content: 'completed prompt', timestamp: now }],
      runs: [{
        runId: 'completed-1',
        provider: 'codex',
        startedAt: now,
        endedAt: now,
        promptMessageId: 'msg-1',
        status: 'success',
        runtimeProfileId: 'profile-1',
        runDiff: {
          createdFiles: [],
          modifiedFiles: [{ path: 'src/app.ts' }],
          deletedFiles: []
        } as any
      }]
    })

    const lanes = buildRunLanes(
      [queuedJob()],
      [sourceChat],
      [scheduledTask()],
      [runtimeProfile(), runtimeProfile({ id: 'profile-2', name: 'Gemini local', provider: 'gemini', workspaceMode: 'local' })]
    )

    expect(lanes.map((lane) => lane.id)).toEqual(['job:run-1', 'task:task-1', 'run:completed-1'])
    expect(lanes[0]).toMatchObject({
      phase: 'queued',
      runtimeProfileName: 'Codex worktree',
      handoffSourceRunId: 'source-run',
      blockedReason: 'Waiting for this chat to finish its active run.'
    })
    expect(lanes[1]).toMatchObject({ phase: 'scheduled', blockedReason: 'Due and waiting for this chat to become idle.' })
    expect(lanes[2].touchedFiles).toEqual(['src/app.ts'])
  })

  it('flags live lanes sharing the same workspace before launch', () => {
    const lanes = buildRunLanes(
      [
        queuedJob({ runId: 'active-1', id: 'active-1', status: 'active', provider: 'gemini', runtimeProfileId: undefined }),
        queuedJob({ runId: 'queued-2', id: 'queued-2', provider: 'codex' })
      ],
      [chat()],
      [],
      [runtimeProfile()]
    )

    expect(lanes[0].conflictSummary).toBe('Shares workspace with 1 other live lane.')
    expect(lanes[1].conflictSummary).toBe('Shares workspace with 1 other live lane.')
  })
})
