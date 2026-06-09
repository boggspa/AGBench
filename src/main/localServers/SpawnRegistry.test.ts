import { describe, it, expect } from 'vitest'
import { SpawnRegistry } from './SpawnRegistry'

describe('SpawnRegistry', () => {
  it('tracks, looks up, lists, and untracks spawns', () => {
    const reg = new SpawnRegistry()
    reg.track({ pid: 100, startedAt: 't', runId: 'r1', workspacePath: '/ws' })
    reg.track({ pid: 200, startedAt: 't', runId: 'r2' })
    expect(reg.get(100)?.workspacePath).toBe('/ws')
    expect(reg.list()).toHaveLength(2)
    reg.untrack(100)
    expect(reg.get(100)).toBeUndefined()
    expect(reg.list()).toHaveLength(1)
  })

  it('filters by runId', () => {
    const reg = new SpawnRegistry()
    reg.track({ pid: 100, startedAt: 't', runId: 'r1' })
    reg.track({ pid: 101, startedAt: 't', runId: 'r1' })
    reg.track({ pid: 200, startedAt: 't', runId: 'r2' })
    expect(reg.byRunId('r1').map((s) => s.pid).sort()).toEqual([100, 101])
    expect(reg.byRunId('r2').map((s) => s.pid)).toEqual([200])
  })

  it('ignores spawns with a non-finite pid', () => {
    const reg = new SpawnRegistry()
    reg.track({ pid: Number.NaN, startedAt: 't' })
    expect(reg.list()).toHaveLength(0)
  })
})
