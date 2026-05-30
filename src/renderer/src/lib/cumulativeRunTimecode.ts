import type { ChatRun } from '../../../main/store/types'

export function computeCumulativeRunBaseMs(runs: readonly ChatRun[] | undefined): number {
  if (!runs || runs.length === 0) return 0
  let total = 0
  for (const run of runs) {
    if (!run.startedAt) continue
    const start = Date.parse(run.startedAt)
    if (!Number.isFinite(start)) continue
    if (!run.endedAt) continue
    const end = Date.parse(run.endedAt)
    if (!Number.isFinite(end)) continue
    total += Math.max(0, end - start)
  }
  return total
}
