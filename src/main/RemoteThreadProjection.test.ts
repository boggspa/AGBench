import { describe, it, expect } from 'vitest'
import type { ChatMessage, ChatRun, ToolActivity } from './store/types'
import {
  projectRemoteThread,
  sanitizePreview,
  classifyRemoteKind,
  buildRunSummary,
  soloSpeakerForMessage,
  type RemoteThreadSnapshot
} from './RemoteThreadProjection'

function msg(i: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `m${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message ${i} body`,
    timestamp: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
    ...overrides
  }
}

function activity(overrides: Partial<ToolActivity> & { id: string }): ToolActivity {
  return {
    toolName: 'shell',
    displayName: 'Shell',
    category: 'shell',
    status: 'success',
    ...overrides
  }
}

const THREAD = 'app-chat-123'
const FIXED = '2026-05-28T12:00:00.000Z'
const MESSAGES: ChatMessage[] = Array.from({ length: 10 }, (_, i) => msg(i))

function project(
  mode: Parameters<typeof projectRemoteThread>[2]['mode'],
  messages: ChatMessage[] = MESSAGES,
  runs: ChatRun[] = [],
  extra: Partial<Parameters<typeof projectRemoteThread>[2]> = {}
): RemoteThreadSnapshot {
  return projectRemoteThread(messages, runs, {
    threadId: THREAD,
    mode,
    generatedAt: FIXED,
    ...extra
  })
}

describe('RemoteThreadProjection', () => {
  describe('envelope', () => {
    it('stamps threadId, schemaVersion, mode, totalRows, generatedAt', () => {
      const snap = project({ kind: 'latestN', n: 3 })
      expect(snap.threadId).toBe(THREAD)
      expect(snap.schemaVersion).toBe(1)
      expect(snap.mode).toEqual({ kind: 'latestN', n: 3 })
      expect(snap.totalRows).toBe(10)
      expect(snap.generatedAt).toBe(FIXED)
    })
  })

  describe('latestN', () => {
    it('returns only the last n rows, bounded by n', () => {
      const snap = project({ kind: 'latestN', n: 3 })
      expect(snap.rows).toHaveLength(3)
      expect(snap.rows.map((r) => r.id)).toEqual(['m7', 'm8', 'm9'])
      expect(snap.windowStartIndex).toBe(7)
      expect(snap.hasMoreAbove).toBe(true)
      expect(snap.hasMoreBelow).toBe(false)
    })

    it('returns the whole thread (no more above) when n >= total', () => {
      const snap = project({ kind: 'latestN', n: 50 })
      expect(snap.rows).toHaveLength(10)
      expect(snap.windowStartIndex).toBe(0)
      expect(snap.hasMoreAbove).toBe(false)
    })

    it('row ids === desktop message ids (deep-links resolve)', () => {
      const snap = project({ kind: 'latestN', n: 4 })
      for (const row of snap.rows) {
        expect(MESSAGES.some((m) => m.id === row.id)).toBe(true)
      }
    })
  })

  describe('aroundRow', () => {
    it('windows plus/minus radius around the target, bounded to 2*radius+1', () => {
      const snap = project({ kind: 'aroundRow', rowId: 'm5', radius: 2 })
      expect(snap.rows.map((r) => r.id)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7'])
      expect(snap.windowStartIndex).toBe(3)
      expect(snap.hasMoreAbove).toBe(true)
      expect(snap.hasMoreBelow).toBe(true)
    })

    it('clamps at the ends without over-reading', () => {
      const top = project({ kind: 'aroundRow', rowId: 'm0', radius: 2 })
      expect(top.rows.map((r) => r.id)).toEqual(['m0', 'm1', 'm2'])
      expect(top.hasMoreAbove).toBe(false)
      expect(top.hasMoreBelow).toBe(true)

      const bottom = project({ kind: 'aroundRow', rowId: 'm9', radius: 2 })
      expect(bottom.rows.map((r) => r.id)).toEqual(['m7', 'm8', 'm9'])
      expect(bottom.hasMoreBelow).toBe(false)
    })

    it('returns an empty window for an unknown row id', () => {
      const snap = project({ kind: 'aroundRow', rowId: 'nope', radius: 3 })
      expect(snap.rows).toHaveLength(0)
      expect(snap.windowStartIndex).toBe(10)
    })
  })

  describe('attention', () => {
    const withAttention: ChatMessage[] = [
      msg(0),
      msg(1, { role: 'system', metadata: { kind: 'agentQuestion' }, content: 'Pick an option?' }),
      msg(2),
      msg(3, { metadata: { kind: 'planChoice' }, content: 'Plan A or B?' }),
      msg(4, { metadata: { kind: 'approval' }, content: 'Allow write to /etc?' }),
      msg(5)
    ]

    it('returns only attention rows, flagged with their attention kind', () => {
      const snap = project({ kind: 'attention' }, withAttention)
      expect(snap.rows.map((r) => r.id)).toEqual(['m1', 'm3', 'm4'])
      expect(snap.rows.every((r) => r.kind === 'attention')).toBe(true)
      expect(snap.rows.map((r) => r.attention?.kind)).toEqual([
        'agentQuestion',
        'planChoice',
        'approval'
      ])
      expect(snap.rows[0].attention?.promptPreview).toContain('Pick an option')
    })

    it('honours a caller-supplied attentionRowIds augment', () => {
      const snap = project({ kind: 'attention' }, MESSAGES, [], {
        attentionRowIds: new Set(['m4'])
      })
      expect(snap.rows.map((r) => r.id)).toEqual(['m4'])
    })

    it('bounds to maxAttentionRows and flags hasMoreBelow when capped', () => {
      const many = Array.from({ length: 8 }, (_, i) =>
        msg(i, { role: 'system', metadata: { kind: 'agentQuestion' } })
      )
      const snap = project({ kind: 'attention' }, many, [], { maxAttentionRows: 3 })
      expect(snap.rows).toHaveLength(3)
      expect(snap.hasMoreBelow).toBe(true)
    })
  })

  describe('summaryOnly', () => {
    it('returns no rows but carries the run summary', () => {
      const runs: ChatRun[] = [
        {
          runId: 'run-1',
          provider: 'claude',
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: '2026-01-01T00:00:05.000Z',
          status: 'success',
          exitCode: 0
        }
      ]
      const snap = project({ kind: 'summaryOnly' }, MESSAGES, runs)
      expect(snap.rows).toHaveLength(0)
      expect(snap.totalRows).toBe(10)
      expect(snap.runSummary?.runId).toBe('run-1')
      expect(snap.runSummary?.durationMs).toBe(5000)
    })
  })

  describe('toolSummary', () => {
    it('summarises tool activity count + status', () => {
      const toolMsg = msg(0, {
        role: 'tool',
        toolActivities: [
          activity({ id: 'a', status: 'success' }),
          activity({ id: 'b', status: 'error' })
        ]
      })
      const snap = project({ kind: 'latestN', n: 1 }, [toolMsg])
      expect(snap.rows[0].toolSummary).toEqual({ activityCount: 2, status: 'mixed' })
      expect(snap.rows[0].kind).toBe('tool')
    })

    it('reports running when any activity is in flight', () => {
      const toolMsg = msg(0, {
        role: 'tool',
        toolActivities: [activity({ id: 'a', status: 'running' })]
      })
      const snap = project({ kind: 'latestN', n: 1 }, [toolMsg])
      expect(snap.rows[0].toolSummary?.status).toBe('running')
    })
  })

  describe('buildRunSummary', () => {
    it('pulls file-change counts from real RunDiffResult arrays and tokens from stats', () => {
      const summary = buildRunSummary([
        {
          runId: 'run-9',
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: '2026-01-01T00:00:02.000Z',
          stats: { totalTokens: 4242 },
          runDiff: {
            runId: 'run-9',
            preSnapshot: {
              capturedAt: '2026-01-01T00:00:00.000Z',
              isGitRepo: true,
              workspacePath: '/repo'
            },
            postSnapshot: {
              capturedAt: '2026-01-01T00:00:02.000Z',
              isGitRepo: true,
              workspacePath: '/repo'
            },
            createdFiles: [
              { path: 'new.ts', status: 'created', additions: 10, previewKind: 'git_diff' }
            ],
            modifiedFiles: [
              {
                path: 'main.ts',
                status: 'modified',
                additions: 2,
                deletions: 3,
                previewKind: 'git_diff'
              }
            ],
            deletedFiles: [
              { path: 'old.ts', status: 'deleted', deletions: 4, previewKind: 'none' }
            ],
            preExistingFiles: [
              {
                path: 'dirty.ts',
                status: 'modified',
                additions: 99,
                deletions: 99,
                previewKind: 'none'
              }
            ]
          }
        } as unknown as ChatRun
      ])
      expect(summary?.totalTokens).toBe(4242)
      expect(summary?.fileChanges).toEqual({
        filesChanged: 3,
        additions: 12,
        deletions: 7,
        createdFiles: 1,
        modifiedFiles: 1,
        deletedFiles: 1,
        preExistingFiles: 1,
        workspaceCount: 1,
        workspaces: [
          {
            workspacePath: '/repo',
            filesChanged: 3,
            additions: 12,
            deletions: 7,
            createdFiles: 1,
            modifiedFiles: 1,
            deletedFiles: 1,
            preExistingFiles: 1
          }
        ]
      })
    })

    it('includes runDiffByPath workspace changes when available', () => {
      const summary = buildRunSummary([
        {
          runId: 'run-10',
          startedAt: '2026-01-01T00:00:00.000Z',
          runDiffByPath: {
            '/repo': [
              { path: 'a.ts', status: 'created', additions: 3, previewKind: 'git_diff' },
              {
                path: 'b.ts',
                status: 'modified',
                additions: 1,
                deletions: 2,
                previewKind: 'git_diff'
              }
            ],
            '/other': [{ path: 'c.ts', status: 'deleted', deletions: 5, previewKind: 'none' }]
          }
        } as unknown as ChatRun
      ])
      expect(summary?.fileChanges).toEqual({
        filesChanged: 3,
        additions: 4,
        deletions: 7,
        createdFiles: 1,
        modifiedFiles: 1,
        deletedFiles: 1,
        preExistingFiles: 0,
        workspaceCount: 2,
        workspaces: [
          {
            workspacePath: '/repo',
            filesChanged: 2,
            additions: 4,
            deletions: 2,
            createdFiles: 1,
            modifiedFiles: 1,
            deletedFiles: 0,
            preExistingFiles: 0
          },
          {
            workspacePath: '/other',
            filesChanged: 1,
            additions: 0,
            deletions: 5,
            createdFiles: 0,
            modifiedFiles: 0,
            deletedFiles: 1,
            preExistingFiles: 0
          }
        ]
      })
    })

    it('returns undefined for no runs', () => {
      expect(buildRunSummary([])).toBeUndefined()
      expect(buildRunSummary(undefined)).toBeUndefined()
    })
  })

  describe('sanitizePreview', () => {
    it('collapses whitespace + strips control characters', () => {
      const { preview, truncated } = sanitizePreview('a\n\n  b\tc\u0000d')
      expect(preview).toBe('a b c d')
      expect(truncated).toBe(false)
    })

    it('truncates with an ellipsis and flags truncation', () => {
      const { preview, truncated } = sanitizePreview('x'.repeat(500), 10)
      expect(preview.endsWith('...')).toBe(true)
      expect(preview.length).toBeLessThanOrEqual(10)
      expect(truncated).toBe(true)
    })

    it('handles empty / missing input', () => {
      expect(sanitizePreview(undefined)).toEqual({ preview: '', truncated: false })
      expect(sanitizePreview('')).toEqual({ preview: '', truncated: false })
    })
  })

  describe('classifyRemoteKind', () => {
    it('maps roles and sub-thread cards', () => {
      expect(classifyRemoteKind(msg(0, { role: 'user' }))).toBe('user')
      expect(classifyRemoteKind(msg(0, { role: 'assistant' }))).toBe('assistant')
      expect(classifyRemoteKind(msg(0, { role: 'tool' }))).toBe('tool')
      expect(classifyRemoteKind(msg(0, { role: 'error' }))).toBe('error')
      expect(classifyRemoteKind(msg(0, { role: 'system' }))).toBe('system')
      expect(
        classifyRemoteKind(msg(0, { role: 'system', metadata: { kind: 'subThreadDelegation' } }))
      ).toBe('system')
      expect(
        classifyRemoteKind(msg(0, { role: 'tool', metadata: { kind: 'subThreadReturn' } }))
      ).toBe('tool')
    })
  })

  describe('defensive', () => {
    it('skips malformed messages and handles empty threads', () => {
      const snap = project({ kind: 'latestN', n: 5 }, [
        msg(0),
        { role: 'user', content: '', timestamp: '' } as unknown as ChatMessage
      ])
      expect(snap.totalRows).toBe(1)
      expect(snap.rows.map((r) => r.id)).toEqual(['m0'])

      const empty = project({ kind: 'latestN', n: 5 }, [])
      expect(empty.totalRows).toBe(0)
      expect(empty.rows).toHaveLength(0)
      expect(empty.hasMoreAbove).toBe(false)
    })
  })

  describe('soloSpeakerForMessage', () => {
    it('labels solo assistant rows with provider and model', () => {
      const labeler = soloSpeakerForMessage('codex', [
        {
          runId: 'run-1',
          provider: 'codex',
          actualModel: 'gpt-5.4-medium',
          status: 'completed'
        } as import('./store/types').ChatRun
      ])
      const message = msg(1, { runId: 'run-1' })
      expect(labeler(message)).toBe('Codex · gpt-5.4-medium')
    })
  })

  describe('speakerForMessage (ensemble identity parity)', () => {
    it('stamps the labeler result on rows and omits the field when undefined', () => {
      const messages = [
        msg(0), // user
        msg(1, { metadata: { ensembleProvider: 'gemini', ensembleRole: 'Researcher' } }),
        msg(3) // assistant with no ensemble metadata (labeler returns undefined)
      ]
      const snapshot = project({ kind: 'latestN', n: 10 }, messages, [], {
        speakerForMessage: (message) =>
          message.metadata?.ensembleProvider ? 'Gemini / Researcher (2.5 Flash)' : undefined
      })
      expect(snapshot.rows[0].speaker).toBeUndefined() // user row
      expect(snapshot.rows[1].speaker).toBe('Gemini / Researcher (2.5 Flash)')
      expect(snapshot.rows[2].speaker).toBeUndefined()
      // No labeler at all → identical rows, no field (solo-chat parity).
      const solo = project({ kind: 'latestN', n: 10 }, messages)
      expect(solo.rows.every((row) => row.speaker === undefined)).toBe(true)
    })
  })
})
