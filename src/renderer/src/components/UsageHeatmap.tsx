/*
 * UsageHeatmap — Phase L6 slice 5.
 *
 * The 30-day × 12-bucket activity grid that sits at the foot of
 * the Model Usage Card. Each cell is a small rounded rect coloured
 * by the dominant provider in that 2-hour bucket; opacity scales
 * with token volume (logarithmic) so a single spike doesn't drown
 * out everyday usage.
 *
 * Data path: pull all `UsageRecord` entries via the existing
 * `window.api.getUsage` IPC, run them through the pure
 * `buildHeatmapGrid` helper, render the grid + the 24h / 7D / 30D
 * total chips.
 *
 * Mirrors another-project's `LLMActivityHeatmapView`
 * (`Shared/Views/LLMActivityHeatmapView.swift`) — same 30×12
 * grid dimensions, same per-bucket dominant-provider colouring.
 */
import { useEffect, useMemo, useState } from 'react'
import type { UsageRecord } from '../../../main/store/types'
import {
  buildHeatmapGrid,
  formatTokenCount,
  HEATMAP_COLUMNS,
  HEATMAP_ROWS,
  type HeatmapCell,
  type HeatmapGrid
} from '../lib/UsageHeatmap'

const TIME_LABELS = ['00', '04', '08', '12', '16', '20'] // hour-of-day ticks shown on the left rail

/** A single cell. Pulled out so React.memo can short-circuit
 * re-renders when the cell's bucket data hasn't changed. */
function HeatmapCellTile({ cell }: { cell: HeatmapCell }) {
  const fillColor = cell.color ?? 'transparent'
  const opacity = cell.color ? cell.intensity : 0
  return (
    <span
      className="usage-heatmap-cell"
      data-column={cell.column}
      data-row={cell.row}
      style={{
        backgroundColor: fillColor,
        opacity
      }}
      title={
        cell.eventCount > 0
          ? `${formatTokenCount(cell.totalTokens)} tokens · ${cell.eventCount} call${cell.eventCount === 1 ? '' : 's'}`
          : undefined
      }
    />
  )
}

interface UsageHeatmapProps {
  /** Refresh trigger — when the parent re-fetches usage records
   * (e.g. after a turn completes), bumping this value forces the
   * heatmap to re-query. Defaults to a stable timestamp so the
   * heatmap only loads once on mount when omitted. */
  refreshKey?: number
  /** Render the "Activity" title + 24h / 7D / 30D total chips. The
   * sidebar Model Usage card surfaces them inline; embeds in the
   * welcome dashboard (where total-tokens already lives in the
   * headline stat grid above) hide the header to avoid duplication.
   * Defaults to true. */
  showHeader?: boolean
  /** Class name appended to the root `<div>` — lets callers retune
   * sizing without forking the component. */
  className?: string
}

export function UsageHeatmap({
  refreshKey = 0,
  showHeader = true,
  className
}: UsageHeatmapProps) {
  const [records, setRecords] = useState<UsageRecord[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // We always fetch ALL records and filter in the bucketing helper
    // — the existing IPC has no time-range param, and the filter step
    // happens in O(n) which is fine for typical usage volumes
    // (~thousands of records over a 30-day window).
    window.api
      .getUsage()
      .then((latest) => {
        if (!cancelled) setRecords(latest)
      })
      .catch(() => {
        // Best-effort: render an empty heatmap rather than crashing
        // the whole card if the IPC fails.
        if (!cancelled) setRecords([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const grid: HeatmapGrid = useMemo(() => buildHeatmapGrid(records), [records])

  return (
    <div
      className={`usage-heatmap${className ? ` ${className}` : ''}`}
      aria-label="Usage activity heatmap"
    >
      {showHeader && (
        <div className="usage-heatmap-header">
          <span className="usage-heatmap-title">Activity</span>
          <span className="usage-heatmap-chip">
            24h <strong>{formatTokenCount(grid.totals.last24h)}</strong>
          </span>
          <span className="usage-heatmap-chip">
            7D <strong>{formatTokenCount(grid.totals.last7d)}</strong>
          </span>
          <span className="usage-heatmap-chip">
            30D <strong>{formatTokenCount(grid.totals.last30d)}</strong>
          </span>
        </div>
      )}
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
            gridTemplateColumns: `repeat(${HEATMAP_COLUMNS}, 1fr)`,
            gridTemplateRows: `repeat(${HEATMAP_ROWS}, 1fr)`
          }}
        >
          {grid.cells.map((cell) => (
            <HeatmapCellTile key={`${cell.column}-${cell.row}`} cell={cell} />
          ))}
        </div>
      </div>
    </div>
  )
}
