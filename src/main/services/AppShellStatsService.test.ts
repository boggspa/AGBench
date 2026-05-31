import { describe, expect, it, vi } from 'vitest'
import {
  AppShellStatsService,
  collectAppShellStatsSnapshot,
  type AppShellProcessMetric
} from './AppShellStatsService'

const NOW = Date.parse('2026-05-31T12:00:00.000Z')

describe('collectAppShellStatsSnapshot', () => {
  it('aggregates Electron app CPU and working-set RAM without process-tree data', async () => {
    const metrics: AppShellProcessMetric[] = [
      {
        cpu: { percentCPUUsage: 1.26 },
        memory: { workingSetSize: 128 * 1024 }
      },
      {
        cpu: { percentCPUUsage: 2.51 },
        memory: { workingSetSize: 256 * 1024 }
      }
    ]

    const snapshot = await collectAppShellStatsSnapshot(
      {
        getAppMetrics: () => metrics,
        getTotalMemoryBytes: () => 1024 * 1024 * 1024,
        getActiveThreadCount: () => 2,
        now: () => NOW
      },
      NOW - 2_000
    )

    expect(snapshot).toEqual({
      schemaVersion: 1,
      sampledAt: NOW,
      sampleWindowMs: 2_000,
      cpuPercent: 3.8,
      ramPercent: 37.5,
      ramUsedMB: 384,
      activeThreadCount: 2,
      processCount: 2
    })
  })

  it('keeps unavailable CPU/RAM metrics null instead of fabricating values', async () => {
    const snapshot = await collectAppShellStatsSnapshot({
      getAppMetrics: () => [{}, { cpu: {}, memory: {} }],
      getTotalMemoryBytes: () => 0,
      getActiveThreadCount: () => 1,
      now: () => NOW
    })

    expect(snapshot.cpuPercent).toBeNull()
    expect(snapshot.ramPercent).toBeNull()
    expect(snapshot.ramUsedMB).toBeNull()
    expect(snapshot.activeThreadCount).toBe(1)
    expect(snapshot.processCount).toBe(2)
  })
})

describe('AppShellStatsService', () => {
  it('injects the active AGBench thread count into published snapshots', async () => {
    const service = new AppShellStatsService({
      getAppMetrics: () => [],
      getTotalMemoryBytes: () => 1,
      getActiveThreadCount: () => 4,
      now: () => NOW
    })

    const published: number[] = []
    service.onChange((snapshot) => published.push(snapshot.activeThreadCount))

    await service.refresh()

    expect(published).toEqual([4])
  })

  it('does not overlap polling refreshes', async () => {
    const resolverRef: { current?: (metrics: AppShellProcessMetric[]) => void } = {}
    const getAppMetrics = vi.fn(
      () =>
        new Promise<AppShellProcessMetric[]>((resolve) => {
          resolverRef.current = resolve
        })
    )
    const service = new AppShellStatsService({
      getAppMetrics,
      getTotalMemoryBytes: () => 1024,
      getActiveThreadCount: () => 0,
      now: () => NOW
    })

    const first = service.refresh()
    const second = service.refresh()

    expect(getAppMetrics).toHaveBeenCalledTimes(1)
    const resolveMetrics = resolverRef.current
    if (!resolveMetrics) throw new Error('metrics resolver was not captured')
    resolveMetrics([])
    await Promise.all([first, second])
    expect(getAppMetrics).toHaveBeenCalledTimes(1)
  })

  it('publishes only when rounded displayed values change', async () => {
    let cpuPercent = 1.21
    const service = new AppShellStatsService({
      getAppMetrics: () => [
        { cpu: { percentCPUUsage: cpuPercent }, memory: { workingSetSize: 1 } }
      ],
      getTotalMemoryBytes: () => 1024 * 1024,
      getActiveThreadCount: () => 0,
      now: () => NOW
    })
    const published: number[] = []
    service.onChange((snapshot) => published.push(snapshot.cpuPercent ?? -1))

    await service.refresh()
    cpuPercent = 1.24
    await service.refresh()
    cpuPercent = 1.31
    await service.refresh()

    expect(published).toEqual([1.2, 1.3])
  })
})
