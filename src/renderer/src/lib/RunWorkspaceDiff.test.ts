import { describe, it, expect } from 'vitest'
import type { ChatMessage, ExternalPathGrant, ToolActivity } from '../../../main/store/types'
import { selectWriteWorkspacePaths, buildRunDiffByPath } from './RunWorkspaceDiff'

function grant(path: string, access: ExternalPathGrant['access']): ExternalPathGrant {
  return { path, access } as ExternalPathGrant
}

function editActivity(id: string, filePath: string, additions: number): ToolActivity {
  return {
    id,
    toolName: 'edit_file',
    displayName: 'Edited file',
    category: 'write',
    status: 'success',
    parameters: { changes: [{ path: filePath, kind: 'modify', additions, deletions: 0 }] }
  }
}

function messageWith(activities: ToolActivity[]): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: '',
    timestamp: '2026-01-01T00:00:00.000Z',
    toolActivities: activities
  }
}

describe('RunWorkspaceDiff', () => {
  describe('selectWriteWorkspacePaths', () => {
    it('keeps WRITE grants only, in order, de-duplicated', () => {
      const paths = selectWriteWorkspacePaths([
        grant('/repo-a', 'write'),
        grant('/repo-b', 'read'),
        grant('/repo-c', 'write'),
        grant('/repo-a', 'write') // duplicate
      ])
      expect(paths).toEqual(['/repo-a', '/repo-c'])
    })

    it('defends against missing / malformed input', () => {
      expect(selectWriteWorkspacePaths(undefined)).toEqual([])
      expect(selectWriteWorkspacePaths([{ access: 'write' } as ExternalPathGrant])).toEqual([])
    })
  })

  describe('buildRunDiffByPath', () => {
    it('returns a summary entry for each WRITE workspace that changed', () => {
      const messages = [
        messageWith([
          editActivity('t1', '/repo-a/src/app.ts', 5),
          editActivity('t2', '/repo-b/lib/util.ts', 3)
        ])
      ]
      const byPath = buildRunDiffByPath(messages, [
        grant('/repo-a', 'write'),
        grant('/repo-b', 'write')
      ])
      expect(Object.keys(byPath).sort()).toEqual(['/repo-a', '/repo-b'])
      expect(byPath['/repo-a'].length).toBeGreaterThan(0)
      expect(byPath['/repo-b'].length).toBeGreaterThan(0)
    })

    it('excludes READ workspaces from the map', () => {
      const messages = [messageWith([editActivity('t1', '/repo-a/src/app.ts', 5)])]
      const byPath = buildRunDiffByPath(messages, [
        grant('/repo-a', 'write'),
        grant('/repo-read', 'read')
      ])
      expect(byPath['/repo-read']).toBeUndefined()
      expect(byPath['/repo-a']).toBeDefined()
    })

    it('returns an empty map when there are no WRITE grants or no changes', () => {
      expect(buildRunDiffByPath([], [grant('/repo-a', 'write')])).toEqual({})
      expect(
        buildRunDiffByPath(
          [messageWith([editActivity('t1', '/repo-a/x.ts', 1)])],
          [grant('/repo-a', 'read')]
        )
      ).toEqual({})
    })
  })
})
