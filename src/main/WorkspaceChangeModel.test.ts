import { describe, expect, it } from 'vitest'
import {
  createWorkspaceChangeSetFromEditorWrite,
  createWorkspaceChangeSetFromRunDiff,
  estimateTextEditLineDelta,
  filterWorkspaceChangeSets,
  pruneWorkspaceChangeSets,
  WORKSPACE_CHANGE_RETENTION
} from './WorkspaceChangeModel'
import type { RunDiffResult, WorkspaceChangeSet } from './store/types'

const capturedAt = '2026-05-07T13:00:00.000Z'

function runDiff(partial: Partial<RunDiffResult> = {}): RunDiffResult {
  return {
    runId: 'run-1',
    preSnapshot: {
      capturedAt,
      isGitRepo: true,
      workspacePath: '/workspace',
      gitStatus: ''
    },
    postSnapshot: {
      capturedAt: '2026-05-07T13:01:00.000Z',
      isGitRepo: true,
      workspacePath: '/workspace',
      gitStatus: '?? generated.swift\0 M src/App.tsx\0'
    },
    createdFiles: [
      {
        path: 'generated.swift',
        status: 'created',
        additions: 12,
        deletions: 0,
        previewKind: 'synthetic_new_file',
        sizeBytes: 320
      }
    ],
    modifiedFiles: [
      {
        path: 'src/App.tsx',
        status: 'modified',
        additions: 4,
        deletions: 2,
        previewKind: 'git_diff'
      }
    ],
    deletedFiles: [],
    preExistingFiles: [
      {
        path: 'README.md',
        status: 'modified',
        previewKind: 'none'
      }
    ],
    ...partial
  }
}

describe('WorkspaceChangeModel', () => {
  it('creates a provider-run change set from a run diff', () => {
    const changeSet = createWorkspaceChangeSetFromRunDiff(
      {
        runId: 'run-1',
        chatId: 'chat-1',
        workspaceId: 'workspace-1',
        workspacePath: '/workspace',
        effectiveWorkspacePath: '/workspace/.gemini/worktrees/task',
        provider: 'gemini',
        runDiff: runDiff(),
        worktree: {
          enabled: true,
          name: 'task',
          baseWorkspacePath: '/workspace',
          effectivePath: '/workspace/.gemini/worktrees/task'
        },
        checkpoint: {
          enabled: true,
          provider: 'gemini',
          checkpointId: 'checkpoint-1'
        }
      },
      capturedAt
    )

    expect(changeSet.id).toBe('run:run-1')
    expect(changeSet.source).toBe('provider_run')
    expect(changeSet.files.map((file) => `${file.origin}:${file.path}`)).toEqual([
      'run_diff:generated.swift',
      'run_diff:src/App.tsx',
      'pre_existing:README.md'
    ])
    expect(changeSet.artifacts).toHaveLength(1)
    expect(changeSet.artifacts[0]).toMatchObject({
      kind: 'file',
      path: 'generated.swift',
      source: 'provider_run'
    })
    expect(changeSet.stats).toMatchObject({
      filesCreated: 1,
      filesModified: 2,
      filesDeleted: 0,
      filesPreExisting: 1,
      artifactsGenerated: 1,
      additions: 16,
      deletions: 2
    })
    expect(changeSet.worktree?.effectivePath).toBe('/workspace/.gemini/worktrees/task')
    expect(changeSet.checkpoint?.enabled).toBe(true)
  })

  it('creates editor change sets for created and modified files', () => {
    const created = createWorkspaceChangeSetFromEditorWrite(
      {
        workspacePath: '/workspace',
        filePath: 'notes.md',
        existedBefore: false,
        nextContent: 'one\ntwo\nthree',
        sizeBytes: 13
      },
      capturedAt
    )
    const modified = createWorkspaceChangeSetFromEditorWrite(
      {
        workspacePath: '/workspace',
        filePath: 'notes.md',
        existedBefore: true,
        previousContent: 'one\ntwo\nthree',
        nextContent: 'one\nchanged\nthree\nfour',
        sizeBytes: 22
      },
      capturedAt
    )

    expect(created.source).toBe('editor')
    expect(created.files[0]).toMatchObject({
      path: 'notes.md',
      status: 'created',
      origin: 'manual_edit',
      additions: 3,
      deletions: 0
    })
    expect(created.artifacts).toHaveLength(1)
    expect(modified.files[0]).toMatchObject({
      path: 'notes.md',
      status: 'modified',
      origin: 'manual_edit',
      additions: 2,
      deletions: 1
    })
  })

  it('estimates text line deltas with shared prefix and suffix trimming', () => {
    expect(estimateTextEditLineDelta('a\nb\nc\nd', 'a\nB\nC\nd')).toEqual({
      additions: 2,
      deletions: 2
    })
    expect(estimateTextEditLineDelta('', 'a\nb')).toEqual({ additions: 2, deletions: 0 })
  })

  it('filters and sorts workspace change sets', () => {
    const first: WorkspaceChangeSet = {
      ...createWorkspaceChangeSetFromRunDiff(
        {
          runId: 'run-1',
          workspacePath: '/workspace',
          provider: 'codex',
          runDiff: runDiff()
        },
        '2026-05-07T13:00:00.000Z'
      ),
      workspaceId: 'workspace-1'
    }
    const second = createWorkspaceChangeSetFromEditorWrite(
      {
        workspaceId: 'workspace-1',
        workspacePath: '/workspace',
        filePath: 'notes.md',
        existedBefore: false,
        nextContent: 'hello'
      },
      '2026-05-07T13:02:00.000Z'
    )

    expect(filterWorkspaceChangeSets([first, second]).map((record) => record.id)).toEqual([
      second.id,
      first.id
    ])
    expect(
      filterWorkspaceChangeSets([first, second], { sources: ['provider_run'] }).map(
        (record) => record.id
      )
    ).toEqual([first.id])
    expect(filterWorkspaceChangeSets([first, second], { provider: 'codex' })).toHaveLength(1)
  })
})

describe('pruneWorkspaceChangeSets retention', () => {
  const baseMs = new Date('2026-06-01T12:00:00.000Z').getTime()

  function changeSet(partial: Partial<WorkspaceChangeSet>): WorkspaceChangeSet {
    return {
      schemaVersion: 1,
      id: `cs-${Math.random().toString(36).slice(2)}`,
      source: 'provider_run',
      status: 'captured',
      title: 'Change',
      workspacePath: '/workspace',
      createdAt: new Date(baseMs).toISOString(),
      updatedAt: new Date(baseMs).toISOString(),
      files: [],
      artifacts: [],
      stats: { fileCount: 0, additions: 0, deletions: 0 },
      ...partial
    } as WorkspaceChangeSet
  }

  it('caps record count newest-first and drops aged-out records', () => {
    const fresh = changeSet({ id: 'fresh', updatedAt: new Date(baseMs).toISOString() })
    const stale = changeSet({
      id: 'stale',
      updatedAt: new Date(baseMs - WORKSPACE_CHANGE_RETENTION.maxAgeMs - 1000).toISOString()
    })
    const bulk = Array.from({ length: WORKSPACE_CHANGE_RETENTION.maxRecords + 50 }, (_, i) =>
      changeSet({ id: `bulk-${i}`, updatedAt: new Date(baseMs - i * 1000).toISOString() })
    )
    const pruned = pruneWorkspaceChangeSets([stale, fresh, ...bulk], baseMs)
    expect(pruned).toHaveLength(WORKSPACE_CHANGE_RETENTION.maxRecords)
    expect(pruned.some((r) => r.id === 'stale')).toBe(false)
    expect(pruned[0].id).toBe('fresh')
  })

  it('strips diff bodies from noise/binary files and truncates oversized real diffs', () => {
    const record = changeSet({
      files: [
        {
          path: '.build/debug.yaml',
          status: 'modified',
          origin: 'run_diff',
          isNoise: true,
          previewKind: 'git_diff',
          diffText: 'x'.repeat(500_000)
        },
        {
          path: 'app.bin',
          status: 'modified',
          origin: 'run_diff',
          isBinary: true,
          previewKind: 'binary',
          diffText: 'y'.repeat(100_000)
        },
        {
          path: 'src/Real.swift',
          status: 'modified',
          origin: 'run_diff',
          previewKind: 'git_diff',
          diffText: 'z'.repeat(WORKSPACE_CHANGE_RETENTION.maxDiffTextChars + 5_000)
        },
        {
          path: 'src/Small.swift',
          status: 'modified',
          origin: 'run_diff',
          previewKind: 'git_diff',
          diffText: 'small diff'
        }
      ]
    })
    const [compacted] = pruneWorkspaceChangeSets([record], baseMs)
    const byPath = new Map(compacted.files.map((f) => [f.path, f]))
    expect(byPath.get('.build/debug.yaml')?.diffText).toBeUndefined()
    expect(byPath.get('app.bin')?.diffText).toBeUndefined()
    const real = byPath.get('src/Real.swift')?.diffText ?? ''
    expect(real.length).toBeLessThan(WORKSPACE_CHANGE_RETENTION.maxDiffTextChars + 200)
    expect(real).toContain('diff truncated for storage')
    expect(byPath.get('src/Small.swift')?.diffText).toBe('small diff')
    // Rows and their stats survive the strip — only bodies go.
    expect(compacted.files).toHaveLength(4)
  })

  it('sheds workspace snapshots only when a record stays over the size budget', () => {
    const hugeSnapshot = {
      capturedAt,
      isGitRepo: true,
      workspacePath: '/workspace',
      files: Array.from({ length: 12_000 }, (_, i) => ({
        path: `deep/nested/path/to/generated/file-${i}.swift`,
        sizeBytes: 1234,
        mtimeMs: baseMs,
        hash: `hash-${i}-abcdefabcdefabcdefabcdefabcdef`
      }))
    }
    const oversized = changeSet({ id: 'big', preSnapshot: hugeSnapshot })
    const modest = changeSet({
      id: 'modest',
      preSnapshot: { capturedAt, isGitRepo: true, workspacePath: '/workspace' }
    })
    const pruned = pruneWorkspaceChangeSets([oversized, modest], baseMs)
    const byId = new Map(pruned.map((r) => [r.id, r]))
    expect(byId.get('big')?.preSnapshot).toBeUndefined()
    expect(byId.get('modest')?.preSnapshot).toBeDefined()
  })
})
