import { describe, expect, it } from 'vitest'
import {
  backfillRunDiffCounts,
  lookupEvidence,
  toolEvidenceFromActivities
} from './runDiffBackfill'
import type { RunDiffResult, ToolActivity, WorkspaceSnapshot } from '../main/store/types'

function activity(partial: Partial<ToolActivity>): ToolActivity {
  return {
    id: 'a',
    toolName: 'apply_patch',
    displayName: 'Apply patch',
    category: 'write',
    status: 'success',
    startedAt: '2026-06-12T00:00:00.000Z',
    ...partial
  } as ToolActivity
}

const snapshot: WorkspaceSnapshot = {
  capturedAt: '2026-06-12T00:00:00.000Z',
  isGitRepo: false,
  workspacePath: '/ws'
}

function diff(partial: Partial<RunDiffResult>): RunDiffResult {
  return {
    runId: 'run-1',
    preSnapshot: snapshot,
    postSnapshot: snapshot,
    createdFiles: [],
    modifiedFiles: [],
    deletedFiles: [],
    preExistingFiles: [],
    ...partial
  }
}

describe('toolEvidenceFromActivities', () => {
  it('prefers per-file stats, falls back to filePath totals, skips failures', () => {
    const evidence = toolEvidenceFromActivities([
      activity({
        diffSummary: {
          additions: 3,
          deletions: 1,
          files: [
            { path: 'a.txt', status: 'modified', additions: 2, deletions: 1 },
            { path: 'b.txt', status: 'created', additions: 1, deletions: 0 }
          ],
          source: 'patch_preview',
          confidence: 'exact'
        }
      }),
      activity({
        filePath: '/abs/ws/c.txt',
        diffSummary: { additions: 4, deletions: 2, source: 'string_replace', confidence: 'exact' }
      }),
      activity({
        status: 'error',
        filePath: 'rejected.txt',
        diffSummary: { additions: 40, deletions: 12, source: 'patch_preview', confidence: 'exact' }
      })
    ])
    expect(evidence.get('a.txt')).toEqual({ additions: 2, deletions: 1 })
    expect(evidence.get('b.txt')).toEqual({ additions: 1, deletions: 0 })
    expect(evidence.get('/abs/ws/c.txt')).toEqual({ additions: 4, deletions: 2 })
    expect(evidence.has('rejected.txt')).toBe(false)
  })

  it('accumulates repeated edits to the same file', () => {
    const edit = (additions: number, deletions: number): ToolActivity =>
      activity({
        filePath: 'same.swift',
        diffSummary: { additions, deletions, source: 'string_replace', confidence: 'exact' }
      })
    const evidence = toolEvidenceFromActivities([edit(1, 1), edit(2, 0)])
    expect(evidence.get('same.swift')).toEqual({ additions: 3, deletions: 1 })
  })
})

describe('lookupEvidence', () => {
  it('matches exactly, then by slash-boundary suffix in either direction', () => {
    const evidence = new Map([['/Users/x/Test 2/file.json', { additions: 0, deletions: 11 }]])
    expect(lookupEvidence(evidence, 'file.json')).toEqual({ additions: 0, deletions: 11 })
    expect(lookupEvidence(evidence, 'other.json')).toBeUndefined()
  })
})

describe('backfillRunDiffCounts', () => {
  it('fills only undefined counts on modified/deleted files', () => {
    const result = backfillRunDiffCounts(
      diff({
        modifiedFiles: [
          { path: 'counted.ts', status: 'modified', previewKind: 'git_diff', additions: 5, deletions: 2 },
          { path: 'uncounted.txt', status: 'modified', previewKind: 'none' }
        ],
        deletedFiles: [{ path: 'gone.json', status: 'deleted', previewKind: 'none' }]
      }),
      new Map([
        ['/ws/uncounted.txt', { additions: 4, deletions: 1 }],
        ['/ws/gone.json', { additions: 0, deletions: 11 }]
      ])
    )
    expect(result.modifiedFiles[0]).toMatchObject({ additions: 5, deletions: 2 })
    expect(result.modifiedFiles[1]).toMatchObject({ additions: 4, deletions: 1 })
    expect(result.deletedFiles[0]).toMatchObject({ additions: 0, deletions: 11 })
  })

  it('returns the same reference when there is nothing to fill', () => {
    const original = diff({
      modifiedFiles: [
        { path: 'counted.ts', status: 'modified', previewKind: 'git_diff', additions: 1, deletions: 1 }
      ]
    })
    expect(backfillRunDiffCounts(original, new Map([['x', { additions: 1, deletions: 1 }]]))).toBe(
      original
    )
    expect(backfillRunDiffCounts(original, new Map())).toBe(original)
  })
})
