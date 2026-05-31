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
 * `buildHeatmapGrid` helper, render the grid + the 24h / 7D / window
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
  buildProviderFilteredHeatmapGrid,
  formatTokenCount,
  HEATMAP_COLUMNS,
  HEATMAP_ROWS,
  type HeatmapProviderFilter,
  type HeatmapCell,
  type HeatmapGrid
} from '../lib/UsageHeatmap'

const TIME_LABELS = ['00', '04', '08', '12', '16', '20'] // hour-of-day ticks shown on the left rail
const PROVIDER_FILTERS: Array<{ id: HeatmapProviderFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'grok', label: 'Grok' },
  { id: 'cursor', label: 'Cursor' }
]

/** A single cell. Pulled out so React.memo can short-circuit
 * re-renders when the cell's bucket data hasn't changed. */
function HeatmapCellTile({ cell }: { cell: HeatmapCell }) {
  const style = cell.color
    ? {
        backgroundColor: cell.color,
        opacity: cell.intensity
      }
    : undefined
  return (
    <span
      className="usage-heatmap-cell"
      data-empty={cell.color ? undefined : 'true'}
      data-column={cell.column}
      data-row={cell.row}
      style={style}
      title={
        cell.eventCount > 0
          ? cell.totalTokens > 0
            ? `${formatTokenCount(cell.totalTokens)} tokens · ${cell.eventCount} call${cell.eventCount === 1 ? '' : 's'}`
            : `${cell.eventCount} activity marker${cell.eventCount === 1 ? '' : 's'}`
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
  /** Render the "Activity" title + 24h / 7D / rendered-window total chips. The
   * sidebar Model Usage card surfaces them inline; embeds in the
   * welcome dashboard (where total-tokens already lives in the
   * headline stat grid above) hide the header to avoid duplication.
   * Defaults to true. */
  showHeader?: boolean
  /** Number of day columns to render. Defaults to the sidebar's 30-day window. */
  dayCount?: number
  /** Data source for the rendered grid. */
  usageSource?: 'agbench' | 'external'
  /** Header title. Defaults to the original AGBench "Activity" label. */
  title?: string
  /** Optional accessible label override. */
  ariaLabel?: string
  /** Show a compact provider-isolation segmented control in the header. */
  showProviderFilter?: boolean
  /** Class name appended to the root `<div>` — lets callers retune
   * sizing without forking the component. */
  className?: string
}

export function UsageHeatmap({
  refreshKey = 0,
  showHeader = true,
  dayCount = HEATMAP_COLUMNS,
  usageSource = 'agbench',
  title = 'Activity',
  ariaLabel,
  showProviderFilter = false,
  className
}: UsageHeatmapProps) {
  const [records, setRecords] = useState<UsageRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [providerFilter, setProviderFilter] = useState<HeatmapProviderFilter>('all')

  useEffect(() => {
    let cancelled = false
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return
      setLoading(true)
      // We always fetch ALL records and filter in the bucketing helper
      // — the existing IPC has no time-range param, and the filter step
      // happens in O(n) which is fine for typical usage volumes
      // (~thousands of records over a 30-day window).
      const loader =
        usageSource === 'external' && typeof window.api.getExternalUsage === 'function'
          ? window.api.getExternalUsage
          : window.api.getUsage
      loader()
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
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
    }
  }, [refreshKey, usageSource])

  const grid: HeatmapGrid = useMemo(
    () =>
      showProviderFilter
        ? buildProviderFilteredHeatmapGrid(records, new Date(), dayCount, providerFilter)
        : buildHeatmapGrid(records, new Date(), dayCount),
    [records, dayCount, showProviderFilter, providerFilter]
  )
  const windowLabel = grid.columns === HEATMAP_COLUMNS ? '30D' : `${grid.columns}D`
  const rootClassName = [
    'usage-heatmap',
    showProviderFilter ? 'usage-heatmap--with-provider-filter' : '',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={rootClassName} aria-label={ariaLabel || `${title} usage activity heatmap`}>
      {showHeader && (
        <div className="usage-heatmap-header">
          <span className="usage-heatmap-title">{title}</span>
          {showProviderFilter && (
            <div className="usage-heatmap-provider-filter" aria-label={`${title} provider filter`}>
              {PROVIDER_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={providerFilter === filter.id}
                  className={`usage-heatmap-provider-filter-tab provider-${filter.id}`}
                  data-active={providerFilter === filter.id ? 'true' : undefined}
                  onClick={() => setProviderFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          )}
          <span className="usage-heatmap-chips" aria-label={`${title} all-provider totals`}>
            <span className="usage-heatmap-chip">
              24h <strong>{formatTokenCount(grid.totals.last24h)}</strong>
            </span>
            <span className="usage-heatmap-chip">
              7D <strong>{formatTokenCount(grid.totals.last7d)}</strong>
            </span>
            <span className="usage-heatmap-chip">
              {windowLabel} <strong>{formatTokenCount(grid.totals.window)}</strong>
            </span>
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
            aspectRatio: `${grid.columns} / ${HEATMAP_ROWS}`,
            gridTemplateColumns: `repeat(${grid.columns}, 1fr)`,
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
