import { useEffect, useMemo, useState } from 'react'
import type { WorkspaceActivitySnapshot } from '../../../main/store/types'
import { HEATMAP_ROWS } from '../lib/UsageHeatmap'
import {
  buildWorkspaceActivityHeatmapGrid,
  formatActivityCount,
  type WorkspaceActivityHeatmapCell
} from '../lib/WorkspaceActivityHeatmap'

const TIME_LABELS = ['00', '04', '08', '12', '16', '20']

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

function scheduleWorkspaceActivityRefresh(callback: () => void): () => void {
  const idleWindow = window as IdleWindow
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 700 })
    return () => idleWindow.cancelIdleCallback?.(handle)
  }
  const handle = window.setTimeout(callback, 0)
  return () => window.clearTimeout(handle)
}

function WorkspaceActivityCellTile({ cell }: { cell: WorkspaceActivityHeatmapCell }) {
  const style = cell.active
    ? {
        backgroundColor: 'var(--accent)',
        opacity: cell.intensity
      }
    : undefined
  return (
    <span
      className="usage-heatmap-cell workspace-activity-heatmap-cell"
      data-empty={cell.active ? undefined : 'true'}
      data-column={cell.column}
      data-row={cell.row}
      style={style}
      title={
        cell.count > 0
          ? `${formatActivityCount(cell.count)} workspace activity marker${cell.count === 1 ? '' : 's'}`
          : undefined
      }
    />
  )
}

interface WorkspaceActivityHeatmapProps {
  workspacePath: string
  dayCount?: number
  refreshKey?: number
  className?: string
}

export function WorkspaceActivityHeatmap({
  workspacePath,
  dayCount = 90,
  refreshKey = 0,
  className
}: WorkspaceActivityHeatmapProps) {
  const [snapshot, setSnapshot] = useState<WorkspaceActivitySnapshot | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const cancelRefresh = scheduleWorkspaceActivityRefresh(() => {
      if (cancelled) return
      setLoading(true)
      window.api
        .getWorkspaceActivity(workspacePath, dayCount)
        .then((latest) => {
          if (!cancelled) setSnapshot(latest)
        })
        .catch(() => {
          if (!cancelled) setSnapshot(null)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    })
    return () => {
      cancelled = true
      cancelRefresh()
    }
  }, [workspacePath, dayCount, refreshKey])

  const grid = useMemo(
    () => buildWorkspaceActivityHeatmapGrid(snapshot, new Date(), dayCount),
    [snapshot, dayCount]
  )

  return (
    <div
      className={`usage-heatmap usage-heatmap--workspace-activity${className ? ` ${className}` : ''}`}
      aria-label="Workspace Activity heatmap"
    >
      <div className="usage-heatmap-header">
        <span className="usage-heatmap-title">Workspace Activity</span>
        <span className="usage-heatmap-chip">
          24h <strong>{formatActivityCount(grid.totals.last24h)}</strong>
        </span>
        <span className="usage-heatmap-chip">
          7D <strong>{formatActivityCount(grid.totals.last7d)}</strong>
        </span>
        <span className="usage-heatmap-chip">
          {grid.columns}D <strong>{formatActivityCount(grid.totals.window)}</strong>
        </span>
      </div>
      <div className="usage-heatmap-grid-wrapper" aria-busy={loading}>
        <div className="usage-heatmap-time-labels" aria-hidden>
          {TIME_LABELS.map((label) => (
            <span key={label} className="usage-heatmap-time-label">
              {label}
            </span>
          ))}
        </div>
        <div
          className="usage-heatmap-grid"
          style={{
            aspectRatio: `${grid.columns} / ${HEATMAP_ROWS}`,
            gridTemplateColumns: `repeat(${grid.columns}, 1fr)`,
            gridTemplateRows: `repeat(${HEATMAP_ROWS}, 1fr)`
          }}
        >
          {grid.cells.map((cell) => (
            <WorkspaceActivityCellTile key={`${cell.column}-${cell.row}`} cell={cell} />
          ))}
        </div>
      </div>
    </div>
  )
}
