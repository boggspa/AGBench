import type { WorkspaceActivityEvent, WorkspaceActivitySnapshot } from '../../../main/store/types'
import { HEATMAP_ROWS } from './UsageHeatmap'

const MAX_WORKSPACE_ACTIVITY_COLUMNS = 180

export interface WorkspaceActivityHeatmapCell {
  column: number
  row: number
  active: boolean
  intensity: number
  count: number
  weight: number
}

export interface WorkspaceActivityHeatmapGrid {
  columns: number
  cells: WorkspaceActivityHeatmapCell[]
  totals: {
    last24h: number
    last7d: number
    window: number
  }
  truncated: boolean
  source: WorkspaceActivitySnapshot['source']
}

function clampColumnCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 90
  return Math.max(1, Math.min(MAX_WORKSPACE_ACTIVITY_COLUMNS, Math.round(value)))
}

function gridBounds(now: Date, columns: number): { startMs: number; endMs: number } {
  const endOfDay = new Date(now)
  endOfDay.setHours(23, 59, 59, 999)
  const startOfWindow = new Date(endOfDay)
  startOfWindow.setDate(startOfWindow.getDate() - (columns - 1))
  startOfWindow.setHours(0, 0, 0, 0)
  return { startMs: startOfWindow.getTime(), endMs: endOfDay.getTime() }
}

function eventCount(event: WorkspaceActivityEvent): number {
  const count = Number(event.count)
  return Number.isFinite(count) && count > 0 ? count : 1
}

function eventWeight(event: WorkspaceActivityEvent): number {
  const weight = Number(event.weight)
  return Number.isFinite(weight) && weight > 0 ? weight : eventCount(event)
}

export function buildWorkspaceActivityHeatmapGrid(
  snapshot: WorkspaceActivitySnapshot | null | undefined,
  now: Date = new Date(),
  columnCount = snapshot?.dayCount || 90
): WorkspaceActivityHeatmapGrid {
  const columns = clampColumnCount(columnCount)
  const { startMs, endMs } = gridBounds(now, columns)
  const oneDayMs = 24 * 60 * 60 * 1000
  const last24hMs = now.getTime() - oneDayMs
  const last7dMs = now.getTime() - 7 * oneDayMs
  const buckets = new Map<string, { count: number; weight: number }>()
  let last24h = 0
  let last7d = 0
  let window = 0

  for (const event of snapshot?.events || []) {
    if (!Number.isFinite(event.timestamp)) continue
    if (event.timestamp < startMs || event.timestamp > endMs) continue
    const timestamp = Number(event.timestamp)
    const count = eventCount(event)
    const weight = eventWeight(event)
    const date = new Date(timestamp)
    const column = Math.max(0, Math.min(columns - 1, Math.floor((timestamp - startMs) / oneDayMs)))
    const row = Math.max(0, Math.min(HEATMAP_ROWS - 1, Math.floor(date.getHours() / 2)))
    const key = `${column}-${row}`
    const bucket = buckets.get(key) || { count: 0, weight: 0 }
    bucket.count += count
    bucket.weight += weight
    buckets.set(key, bucket)
    window += count
    if (timestamp >= last7dMs) last7d += count
    if (timestamp >= last24hMs) last24h += count
  }

  let maxLogWeight = 0
  for (const bucket of buckets.values()) {
    maxLogWeight = Math.max(maxLogWeight, Math.log10(bucket.weight + 1))
  }

  const cells: WorkspaceActivityHeatmapCell[] = []
  for (let row = 0; row < HEATMAP_ROWS; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const bucket = buckets.get(`${column}-${row}`)
      if (!bucket) {
        cells.push({ column, row, active: false, intensity: 0, count: 0, weight: 0 })
        continue
      }
      const logWeight = Math.log10(bucket.weight + 1)
      cells.push({
        column,
        row,
        active: true,
        intensity: maxLogWeight > 0 ? Math.max(0.22, logWeight / maxLogWeight) : 0.22,
        count: bucket.count,
        weight: bucket.weight
      })
    }
  }

  return {
    columns,
    cells,
    totals: { last24h, last7d, window },
    truncated: Boolean(snapshot?.truncated),
    source: snapshot?.source || 'none'
  }
}

export function formatActivityCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 1000) return Math.round(value).toString()
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`
}
