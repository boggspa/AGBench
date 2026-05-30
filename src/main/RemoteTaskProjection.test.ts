import { describe, expect, it } from 'vitest'
import type { ChatRecord, ChatRun, DiffFileSummary } from './store/types'
import {
  buildMobileDiffSummary,
  buildMobileQuestionCard,
  buildRemoteProjectionEnvelope,
  buildRemoteTaskCard,
  buildRemoteTaskFeedSnapshot
} from './RemoteTaskProjection'

const NOW = Date.UTC(2026, 4, 30, 12, 0, 0)
const ISO = new Date(NOW).toISOString()

function chat(overrides: Partial<ChatRecord> = {}): ChatRecord {
  return {
    appChatId: 'chat-1',
    scope: 'workspace',
    provider: 'codex',
    title: 'Implement remote console',
    workspaceId: 'ws-1',
    workspacePath: '/repo',
    createdAt: NOW - 1000,
    updatedAt: NOW,
    archived: false,
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        content: 'Working on the projection path',
        timestamp: ISO
      }
    ],
    runs: [],
    ...overrides
  }
}

function file(
  path: string,
  status: DiffFileSummary['status'],
  additions = 0,
  deletions = 0
): DiffFileSummary {
  return {
    path,
    status,
    additions,
    deletions,
    previewKind: status === 'deleted' ? 'none' : 'git_diff'
  }
}

function run(overrides: Partial<ChatRun> = {}): ChatRun {
  return {
    runId: 'run-1',
    provider: 'codex',
    startedAt: '2026-05-30T11:59:00.000Z',
    status: 'running',
    ...overrides
  }
}

describe('RemoteTaskProjection', () => {
  it('wraps Mac-authored payloads in a stable projection envelope', () => {
    const payload = { promptId: 'q1' }
    const envelope = buildRemoteProjectionEnvelope({
      kind: 'questionCard',
      payload,
      generatedAt: ISO,
      threadId: 'chat-1',
      runId: 'run-1',
      workspaceId: 'ws-1',
      envelopeId: 'env-1'
    })
    expect(envelope).toEqual({
      schemaVersion: 1,
      envelopeId: 'env-1',
      source: 'mac',
      kind: 'questionCard',
      generatedAt: ISO,
      workspaceId: 'ws-1',
      threadId: 'chat-1',
      runId: 'run-1',
      payload
    })
  })

  it('builds a bounded task feed sorted by recent activity', () => {
    const question = buildMobileQuestionCard({
      questionId: 'q1',
      threadId: 'chat-2',
      workspaceId: 'ws-1',
      provider: 'codex',
      question: 'Ship this option?',
      createdAt: ISO
    })
    const snapshot = buildRemoteTaskFeedSnapshot({
      generatedAt: ISO,
      maxTasks: 2,
      questions: [question],
      chats: [
        chat({ appChatId: 'chat-1', updatedAt: NOW - 1000 }),
        chat({ appChatId: 'chat-2', updatedAt: NOW, runs: [run()] }),
        chat({ appChatId: 'chat-3', updatedAt: NOW - 2000 })
      ]
    })

    expect(snapshot.tasks.map((task) => task.threadId)).toEqual(['chat-2', 'chat-1'])
    expect(snapshot.totalTasks).toBe(3)
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.tasks[0].status).toBe('awaitingQuestion')
    expect(snapshot.totalPendingQuestions).toBe(1)
  })

  it('projects task card status, preview and latest run details', () => {
    const card = buildRemoteTaskCard(
      chat({
        runs: [
          run({ runId: 'old', startedAt: '2026-05-30T11:00:00.000Z', status: 'success' }),
          run({ runId: 'new', startedAt: '2026-05-30T12:00:00.000Z', status: 'running' })
        ]
      }),
      { pendingApprovalCount: 1 }
    )
    expect(card).toMatchObject({
      id: 'chat-1',
      runId: 'new',
      latestRunId: 'new',
      status: 'awaitingApproval',
      preview: 'Working on the projection path',
      pendingApprovalCount: 1
    })
  })

  it('summarises RunDiffResult arrays and runDiffByPath workspace changes', () => {
    const summary = buildMobileDiffSummary(
      run({
        status: 'success',
        runDiff: {
          runId: 'run-1',
          preSnapshot: { capturedAt: ISO, isGitRepo: true, workspacePath: '/repo' },
          postSnapshot: { capturedAt: ISO, isGitRepo: true, workspacePath: '/repo' },
          createdFiles: [file('new.ts', 'created', 8, 0)],
          modifiedFiles: [file('main.ts', 'modified', 3, 2)],
          deletedFiles: [file('old.ts', 'deleted', 0, 4)],
          preExistingFiles: [file('dirty.ts', 'modified', 10, 1)]
        },
        runDiffByPath: {
          '/other': [file('extra.ts', 'created', 2, 0), file('edit.ts', 'modified', 1, 1)]
        }
      })
    )

    expect(summary).toMatchObject({
      runId: 'run-1',
      filesChanged: 5,
      additions: 14,
      deletions: 7,
      createdFiles: 2,
      modifiedFiles: 2,
      deletedFiles: 1,
      preExistingFiles: 1
    })
    expect(summary?.workspaces.map((workspace) => workspace.workspacePath)).toEqual([
      '/repo',
      '/other'
    ])
  })

  it('projects active ensemble state compactly', () => {
    const card = buildRemoteTaskCard(
      chat({
        chatKind: 'ensemble',
        ensemble: {
          enabled: true,
          maxParticipants: 2,
          participants: [],
          activeRound: {
            roundId: 'round-1',
            status: 'running',
            prompt: 'Coordinate',
            startedAt: ISO,
            activeParticipantId: 'p1',
            queuedPrompts: ['next'],
            participants: [
              {
                participantId: 'p1',
                provider: 'codex',
                role: 'Implementer',
                order: 1,
                status: 'running',
                runId: 'run-1'
              }
            ]
          }
        }
      })
    )
    expect(card.ensembleState).toMatchObject({
      threadId: 'chat-1',
      roundId: 'round-1',
      status: 'running',
      queuedPromptCount: 1,
      participantCount: 1
    })
  })
})
