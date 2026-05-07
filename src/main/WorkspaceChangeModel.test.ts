import { describe, expect, it } from 'vitest'
import {
  createWorkspaceChangeSetFromEditorWrite,
  createWorkspaceChangeSetFromRunDiff,
  estimateTextEditLineDelta,
  filterWorkspaceChangeSets
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
