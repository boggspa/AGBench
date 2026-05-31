export interface AppShellStatsSnapshot {
  schemaVersion: 1
  sampledAt: number
  sampleWindowMs: number
  cpuPercent: number | null
  ramPercent: number | null
  ramUsedMB: number | null
  activeThreadCount: number
  processCount: number
}

export interface AppShellProcessMetric {
  cpu?: {
    percentCPUUsage?: number | null
  } | null
  memory?: {
    workingSetSize?: number | null
  } | null
}

interface AppShellStatsCollectorDeps {
  getAppMetrics: () => AppShellProcessMetric[] | Promise<AppShellProcessMetric[]>
  getTotalMemoryBytes: () => number | Promise<number>
  getActiveThreadCount: () => number | Promise<number>
  now?: () => number
}

export interface AppShellStatsServiceOptions extends AppShellStatsCollectorDeps {
  activeIntervalMs?: number
  inactiveIntervalMs?: number
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}

type AppShellStatsRefreshOptions = {
  force?: boolean
  publish?: boolean
}

const DEFAULT_ACTIVE_INTERVAL_MS = 2_000
const DEFAULT_INACTIVE_INTERVAL_MS = 10_000
const KIB_PER_MIB = 1024

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10
}

function sanitizeFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sanitizeActiveThreadCount(value: unknown): number {
  const numeric = sanitizeFiniteNumber(value)
  if (numeric === null) return 0
  return Math.max(0, Math.floor(numeric))
}

async function readActiveThreadCount(
  getActiveThreadCount: AppShellStatsCollectorDeps['getActiveThreadCount']
): Promise<number> {
  try {
    return sanitizeActiveThreadCount(await getActiveThreadCount())
  } catch {
    return 0
  }
}

async function readTotalMemoryBytes(
  getTotalMemoryBytes: AppShellStatsCollectorDeps['getTotalMemoryBytes']
): Promise<number | null> {
  try {
    const totalBytes = sanitizeFiniteNumber(await getTotalMemoryBytes())
    return totalBytes !== null && totalBytes > 0 ? totalBytes : null
  } catch {
    return null
  }
}

async function readAppMetrics(
  getAppMetrics: AppShellStatsCollectorDeps['getAppMetrics']
): Promise<AppShellProcessMetric[]> {
  try {
    const metrics = await getAppMetrics()
    return Array.isArray(metrics) ? metrics : []
  } catch {
    return []
  }
}

export async function collectAppShellStatsSnapshot(
  deps: AppShellStatsCollectorDeps,
  previousSampledAt?: number
): Promise<AppShellStatsSnapshot> {
  const sampledAt = deps.now?.() ?? Date.now()
  const [metrics, totalMemoryBytes, activeThreadCount] = await Promise.all([
    readAppMetrics(deps.getAppMetrics),
    readTotalMemoryBytes(deps.getTotalMemoryBytes),
    readActiveThreadCount(deps.getActiveThreadCount)
  ])

  let cpuTotal = 0
  let cpuSampleCount = 0
  let workingSetKiB = 0
  let memorySampleCount = 0

  for (const metric of metrics) {
    const cpuPercent = sanitizeFiniteNumber(metric?.cpu?.percentCPUUsage)
    if (cpuPercent !== null) {
      cpuTotal += cpuPercent
      cpuSampleCount += 1
    }

    const workingSetSize = sanitizeFiniteNumber(metric?.memory?.workingSetSize)
    if (workingSetSize !== null && workingSetSize >= 0) {
      workingSetKiB += workingSetSize
      memorySampleCount += 1
    }
  }

  const ramUsedMB =
    memorySampleCount > 0 ? Math.round(Math.max(0, workingSetKiB / KIB_PER_MIB)) : null
  const ramPercent =
    ramUsedMB !== null && totalMemoryBytes !== null
      ? roundPercent((ramUsedMB * 1024 * 1024 * 100) / totalMemoryBytes)
      : null

  return {
    schemaVersion: 1,
    sampledAt,
    sampleWindowMs:
      previousSampledAt && sampledAt >= previousSampledAt ? sampledAt - previousSampledAt : 0,
    cpuPercent: cpuSampleCount > 0 ? roundPercent(Math.max(0, cpuTotal)) : null,
    ramPercent,
    ramUsedMB,
    activeThreadCount,
    processCount: metrics.length
  }
}

function displayKey(snapshot: AppShellStatsSnapshot): string {
  return [
    snapshot.cpuPercent ?? 'cpu-null',
    snapshot.ramPercent ?? 'ram-null',
    snapshot.activeThreadCount
  ].join('|')
}

export class AppShellStatsService {
  private readonly getAppMetrics: AppShellStatsCollectorDeps['getAppMetrics']
  private readonly getTotalMemoryBytes: AppShellStatsCollectorDeps['getTotalMemoryBytes']
  private readonly getActiveThreadCount: AppShellStatsCollectorDeps['getActiveThreadCount']
  private readonly now?: () => number
  private readonly activeIntervalMs: number
  private readonly inactiveIntervalMs: number
  private readonly setIntervalFn: typeof setInterval
  private readonly clearIntervalFn: typeof clearInterval
  private readonly listeners = new Set<(snapshot: AppShellStatsSnapshot) => void>()

  private currentSnapshot: AppShellStatsSnapshot | null = null
  private refreshInFlight: Promise<AppShellStatsSnapshot | null> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private windowActive = true
  private lastPublishedKey: string | null = null

  constructor(options: AppShellStatsServiceOptions) {
    this.getAppMetrics = options.getAppMetrics
    this.getTotalMemoryBytes = options.getTotalMemoryBytes
    this.getActiveThreadCount = options.getActiveThreadCount
    this.now = options.now
    this.activeIntervalMs = options.activeIntervalMs ?? DEFAULT_ACTIVE_INTERVAL_MS
    this.inactiveIntervalMs = options.inactiveIntervalMs ?? DEFAULT_INACTIVE_INTERVAL_MS
    this.setIntervalFn = options.setIntervalFn ?? setInterval
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval
  }

  onChange(listener: (snapshot: AppShellStatsSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  start(active = true): void {
    this.running = true
    this.windowActive = active
    this.reschedule()
    void this.refresh({ force: true }).catch((error) => {
      console.warn('[AppShellStats] initial refresh failed:', error)
    })
  }

  stop(): void {
    this.running = false
    this.clearTimer()
  }

  setWindowActive(active: boolean): void {
    if (this.windowActive === active) return
    this.windowActive = active
    if (this.running) {
      this.reschedule()
    }
  }

  async getSnapshot(): Promise<AppShellStatsSnapshot> {
    if (this.currentSnapshot) return this.currentSnapshot
    const snapshot = await this.refresh({ publish: false })
    if (snapshot) return snapshot
    return collectAppShellStatsSnapshot(
      {
        getAppMetrics: this.getAppMetrics,
        getTotalMemoryBytes: this.getTotalMemoryBytes,
        getActiveThreadCount: this.getActiveThreadCount,
        now: this.now
      },
      undefined
    )
  }

  refresh(options: AppShellStatsRefreshOptions = {}): Promise<AppShellStatsSnapshot | null> {
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.collectAndPublish(options).finally(() => {
      this.refreshInFlight = null
    })
    return this.refreshInFlight
  }

  private async collectAndPublish(
    options: AppShellStatsRefreshOptions
  ): Promise<AppShellStatsSnapshot> {
    const snapshot = await collectAppShellStatsSnapshot(
      {
        getAppMetrics: this.getAppMetrics,
        getTotalMemoryBytes: this.getTotalMemoryBytes,
        getActiveThreadCount: this.getActiveThreadCount,
        now: this.now
      },
      this.currentSnapshot?.sampledAt
    )
    this.currentSnapshot = snapshot

    if (options.publish !== false) {
      const nextKey = displayKey(snapshot)
      if (options.force || nextKey !== this.lastPublishedKey) {
        this.lastPublishedKey = nextKey
        for (const listener of this.listeners) {
          listener(snapshot)
        }
      }
    }

    return snapshot
  }

  private reschedule(): void {
    this.clearTimer()
    const intervalMs = this.windowActive ? this.activeIntervalMs : this.inactiveIntervalMs
    this.timer = this.setIntervalFn(() => {
      void this.refresh().catch((error) => {
        console.warn('[AppShellStats] refresh failed:', error)
      })
    }, intervalMs)
    const timerWithUnref = this.timer as ReturnType<typeof setInterval> & {
      unref?: () => void
    }
    timerWithUnref.unref?.()
  }

  private clearTimer(): void {
    if (!this.timer) return
    this.clearIntervalFn(this.timer)
    this.timer = null
  }
}
