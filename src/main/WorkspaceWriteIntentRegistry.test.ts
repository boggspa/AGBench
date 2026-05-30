import { beforeEach, describe, expect, it } from 'vitest'

import {
  WorkspaceWriteIntentRegistry,
  type WriteIntentRequest,
  type WriteIntentToken
} from './WorkspaceWriteIntentRegistry'

const WORKSPACE = '/Users/test/project'
const FILE_A = '/Users/test/project/src/a.ts'
const FILE_B = '/Users/test/project/src/b.ts'

function req(
  overrides: Partial<WriteIntentRequest> & Pick<WriteIntentRequest, 'mode' | 'laneId'>
): WriteIntentRequest {
  return {
    workspacePath: WORKSPACE,
    resourcePath: FILE_A,
    nowIso: '2026-05-27T22:00:00.000Z',
    ...overrides
  }
}

describe('WorkspaceWriteIntentRegistry', () => {
  let registry: WorkspaceWriteIntentRegistry

  beforeEach(() => {
    registry = new WorkspaceWriteIntentRegistry()
  })

  describe('input validation', () => {
    it('rejects acquisitions missing workspacePath', () => {
      const result = registry.acquire({
        workspacePath: '',
        resourcePath: FILE_A,
        laneId: 'lane-1',
        mode: 'write',
        nowIso: '2026-05-27T22:00:00Z'
      })
      expect(result.ok).toBe(false)
      expect(result.conflict?.reason).toMatch(/workspacePath/)
    })

    it('rejects acquisitions missing resourcePath', () => {
      const result = registry.acquire({
        workspacePath: WORKSPACE,
        resourcePath: '',
        laneId: 'lane-1',
        mode: 'write',
        nowIso: '2026-05-27T22:00:00Z'
      })
      expect(result.ok).toBe(false)
    })

    it('rejects acquisitions missing laneId', () => {
      const result = registry.acquire({
        workspacePath: WORKSPACE,
        resourcePath: FILE_A,
        laneId: '',
        mode: 'write',
        nowIso: '2026-05-27T22:00:00Z'
      })
      expect(result.ok).toBe(false)
    })
  })

  describe('write acquisition', () => {
    it('grants a fresh write on an unheld resource', () => {
      const result = registry.acquire(req({ laneId: 'lane-1', mode: 'write' }))
      expect(result.ok).toBe(true)
      expect(result.token?.mode).toBe('write')
      expect(result.conflict).toBeUndefined()
    })

    it('rejects a second write on the same resource', () => {
      registry.acquire(req({ laneId: 'lane-1', mode: 'write' }))
      const result = registry.acquire(req({ laneId: 'lane-2', mode: 'write' }))
      expect(result.ok).toBe(false)
      expect(result.conflict?.holders).toHaveLength(1)
      expect(result.conflict?.holders[0].laneId).toBe('lane-1')
    })

    it('rejects a write when readers are holding', () => {
      registry.acquire(req({ laneId: 'lane-r1', mode: 'read' }))
      registry.acquire(req({ laneId: 'lane-r2', mode: 'read' }))
      const result = registry.acquire(req({ laneId: 'lane-w', mode: 'write' }))
      expect(result.ok).toBe(false)
      expect(result.conflict?.holders).toHaveLength(2)
    })

    it('is idempotent for the same (laneId, write) acquisition', () => {
      const first = registry.acquire(req({ laneId: 'lane-1', mode: 'write' }))
      const second = registry.acquire(req({ laneId: 'lane-1', mode: 'write' }))
      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      expect(second.token?.acquiredAt).toBe(first.token?.acquiredAt) // same lock, not refreshed
    })
  })

  describe('read acquisition', () => {
    it('grants a fresh read on an unheld resource', () => {
      const result = registry.acquire(req({ laneId: 'lane-1', mode: 'read' }))
      expect(result.ok).toBe(true)
      expect(result.token?.mode).toBe('read')
    })

    it('grants multiple concurrent reads', () => {
      const a = registry.acquire(req({ laneId: 'lane-a', mode: 'read' }))
      const b = registry.acquire(req({ laneId: 'lane-b', mode: 'read' }))
      const c = registry.acquire(req({ laneId: 'lane-c', mode: 'read' }))
      expect(a.ok).toBe(true)
      expect(b.ok).toBe(true)
      expect(c.ok).toBe(true)
    })

    it('rejects a read when a write is held', () => {
      registry.acquire(req({ laneId: 'lane-w', mode: 'write' }))
      const result = registry.acquire(req({ laneId: 'lane-r', mode: 'read' }))
      expect(result.ok).toBe(false)
      expect(result.conflict?.holders).toHaveLength(1)
      expect(result.conflict?.holders[0].laneId).toBe('lane-w')
      expect(result.conflict?.reason).toMatch(/exclusive write/)
    })
  })

  describe('write under same lane that holds a write', () => {
    it('returns the existing write lock (idempotent)', () => {
      const first = registry.acquire(req({ laneId: 'lane-1', mode: 'write' }))
      const second = registry.acquire(req({ laneId: 'lane-1', mode: 'read' }))
      // Lane already holds the stronger write — read request gets the write back.
      expect(second.ok).toBe(true)
      expect(second.token?.mode).toBe('write')
      expect(second.token?.acquiredAt).toBe(first.token?.acquiredAt)
    })
  })

  describe('read → write upgrade', () => {
    it('upgrades when this lane is the sole reader', () => {
      registry.acquire(req({ laneId: 'lane-1', mode: 'read', nowIso: 'T0' }))
      const upgrade = registry.acquire(req({ laneId: 'lane-1', mode: 'write', nowIso: 'T1' }))
      expect(upgrade.ok).toBe(true)
      expect(upgrade.token?.mode).toBe('write')
      expect(upgrade.token?.acquiredAt).toBe('T1')
      // Snapshot confirms the read was replaced, not appended.
      const snap = registry.snapshot(WORKSPACE)
      expect(snap).toHaveLength(1)
      expect(snap[0].holders).toHaveLength(1)
      expect(snap[0].holders[0].mode).toBe('write')
    })

    it('refuses upgrade when other lanes still hold reads', () => {
      registry.acquire(req({ laneId: 'lane-1', mode: 'read' }))
      registry.acquire(req({ laneId: 'lane-2', mode: 'read' }))
      const result = registry.acquire(req({ laneId: 'lane-1', mode: 'write' }))
      expect(result.ok).toBe(false)
      expect(result.conflict?.holders.map((h) => h.laneId)).toEqual(['lane-2'])
      expect(result.conflict?.reason).toMatch(/upgrade read/)
    })
  })

  describe('release', () => {
    it('frees a held intent', () => {
      const acquired = registry.acquire(req({ laneId: 'lane-1', mode: 'write' }))
      const released = registry.release(acquired.token!)
      expect(released).toBe(true)
      // Fresh write should now succeed.
      const next = registry.acquire(req({ laneId: 'lane-2', mode: 'write' }))
      expect(next.ok).toBe(true)
    })

    it('returns false for a stale token (already released)', () => {
      const acquired = registry.acquire(req({ laneId: 'lane-1', mode: 'write' }))
      registry.release(acquired.token!)
      const secondRelease = registry.release(acquired.token!)
      expect(secondRelease).toBe(false)
    })

    it('returns false for a token never held', () => {
      const token: WriteIntentToken = {
        workspacePath: WORKSPACE,
        resourcePath: FILE_A,
        laneId: 'never-held',
        mode: 'write',
        acquiredAt: '2026-05-27T22:00:00Z'
      }
      expect(registry.release(token)).toBe(false)
    })

    it('removes the workspace entry entirely when the last holder is released', () => {
      const acquired = registry.acquire(req({ laneId: 'lane-1', mode: 'write' }))
      registry.release(acquired.token!)
      expect(registry.snapshot(WORKSPACE)).toEqual([])
    })

    it('keeps other readers alive when releasing one reader', () => {
      const a = registry.acquire(req({ laneId: 'lane-a', mode: 'read' }))
      registry.acquire(req({ laneId: 'lane-b', mode: 'read' }))
      registry.release(a.token!)
      const snap = registry.snapshot(WORKSPACE)
      expect(snap).toHaveLength(1)
      expect(snap[0].holders.map((h) => h.laneId)).toEqual(['lane-b'])
    })
  })

  describe('releaseAllForLane', () => {
    it('returns empty array when lane held nothing', () => {
      const released = registry.releaseAllForLane('lane-never')
      expect(released).toEqual([])
    })

    it('releases every intent the lane held across resources + workspaces', () => {
      // lane-1 holds:
      //   - write on FILE_A
      //   - read on FILE_B
      //   - write on /other/workspace/c.ts
      // lane-2 holds:
      //   - read on FILE_B (compatible with lane-1's read on FILE_B)
      // After releaseAllForLane('lane-1'), only lane-2's read on FILE_B remains.
      registry.acquire(req({ laneId: 'lane-1', resourcePath: FILE_A, mode: 'write' }))
      registry.acquire(req({ laneId: 'lane-1', resourcePath: FILE_B, mode: 'read' }))
      registry.acquire(
        req({
          workspacePath: '/other/workspace',
          laneId: 'lane-1',
          resourcePath: '/other/workspace/c.ts',
          mode: 'write'
        })
      )
      registry.acquire(req({ laneId: 'lane-2', resourcePath: FILE_B, mode: 'read' }))

      const released = registry.releaseAllForLane('lane-1')
      expect(released).toHaveLength(3)
      const snap = registry.snapshot()
      const remaining = snap.flatMap((entry) => entry.holders.map((h) => h.laneId))
      expect(remaining).toEqual(['lane-2'])
    })
  })

  describe('snapshot', () => {
    it('returns empty array when nothing held', () => {
      expect(registry.snapshot()).toEqual([])
    })

    it('scopes to a single workspace when supplied', () => {
      registry.acquire(req({ laneId: 'lane-1', mode: 'write' }))
      registry.acquire(
        req({
          workspacePath: '/other/workspace',
          resourcePath: '/other/workspace/x.ts',
          laneId: 'lane-2',
          mode: 'read'
        })
      )
      const scoped = registry.snapshot(WORKSPACE)
      expect(scoped).toHaveLength(1)
      expect(scoped[0].workspacePath).toBe(WORKSPACE)
    })

    it('returns empty when scoped to an unknown workspace', () => {
      registry.acquire(req({ laneId: 'lane-1', mode: 'write' }))
      expect(registry.snapshot('/no/such/workspace')).toEqual([])
    })

    it('returns defensive copies — mutating result does not affect registry', () => {
      registry.acquire(req({ laneId: 'lane-1', mode: 'write' }))
      const snap = registry.snapshot()
      snap[0].holders[0].laneId = 'mutated'
      const second = registry.snapshot()
      expect(second[0].holders[0].laneId).toBe('lane-1')
    })
  })

  describe('cross-resource isolation', () => {
    it('locks on FILE_A do not block FILE_B', () => {
      registry.acquire(req({ laneId: 'lane-1', resourcePath: FILE_A, mode: 'write' }))
      const result = registry.acquire(
        req({ laneId: 'lane-2', resourcePath: FILE_B, mode: 'write' })
      )
      expect(result.ok).toBe(true)
    })
  })

  describe('cross-workspace isolation', () => {
    it('locks in workspace A do not block workspace B', () => {
      registry.acquire(req({ laneId: 'lane-1', mode: 'write' }))
      const result = registry.acquire(
        req({
          workspacePath: '/other/workspace',
          resourcePath: '/other/workspace/x.ts',
          laneId: 'lane-2',
          mode: 'write'
        })
      )
      expect(result.ok).toBe(true)
    })
  })
})
