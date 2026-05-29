/*
 * UsageHeatmap — Phase L6 slice 5.
 *
 * Pure helper that buckets `UsageRecord` events into a 30-day × 12
 * (2-hour) grid for the activity heatmap, plus computes per-cell
 * colour and opacity. Mirrors another-project's
 * `LLMActivityHeatmapView` bucketing (`Shared/Views/
 * LLMActivityHeatmapView.swift`).
 *
 * Pure module — no React, no DOM. Easy to unit-test the bucket
 * coordinates and the colour-mixing logic.
 */

import type { ProviderId, UsageRecord } from '../../../main/store/types'

export const HEATMAP_COLUMNS = 30 // days
export const HEATMAP_ROWS = 12 // 2-hour buckets per day (00-02, 02-04, …, 22-24)
const BUCKET_HOURS = 24 / HEATMAP_ROWS

/** Per-provider hex used for colouring heatmap cells. Mirrors the
 * Limit Counter palette + the AGBench `--provider-{id}-color`
 * theme tokens so the heatmap reads as a sibling of the bars
 * above it. */
export const HEATMAP_PROVIDER_COLOR_HEX: Record<ProviderId, string> = {
  gemini: '#2563EB',
  codex: '#6366F1',
  claude: '#D97706',
  kimi: '#84A33B',
  // Grok (gated) — monochrome identity. Heatmap cells paint over the
  // dark sidebar surface, so the "white" end of black/white reads as
  // a near-white cell (mirrors --provider-grok-color, which adapts to
  // the active theme where it can; this static hex is the dark-surface
  // case the heatmap always renders against).
  grok: '#E5E7EB',
  cursor: '#D2A60C'
}

export interface HeatmapCell {
  /** 0..HEATMAP_COLUMNS-1 — 0 is the OLDEST day, HEATMAP_COLUMNS-1 is today. */
  column: number
  /** 0..HEATMAP_ROWS-1 — 0 is `00:00-02:00`, 11 is `22:00-24:00`. */
  row: number
  /** Hex string for the cell fill. Empty cells return null so the
   * caller can render a neutral background. */
  color: string | null
  /** 0..1 opacity multiplier. 0 = empty cell; 1 = highest-intensity
   * cell in this grid. Intensity is logarithmic on token-count so a
   * 100k-token spike doesn't drown out a normal 1k-token call. */
  intensity: number
  /** Cumulative tokens across all events in this bucket. */
  totalTokens: number
  /** Number of events in this bucket — used for tooltip text. */
  eventCount: number
  /** Dominant provider in the bucket (most tokens). `null` when no
   * events landed in this bucket. */
  dominantProvider: ProviderId | null
}

export interface HeatmapGrid {
  cells: HeatmapCell[]
  /** Token totals across known time windows, derived from the same
   * event list so the header chips don't need an independent query. */
  totals: {
    last24h: number
    last7d: number
    last30d: number
  }
  /** ISO date of the column-0 origin (the oldest column shown). */
  startDay: string
  /** ISO date of the column-29 (today) anchor. */
  endDay: string
}

/**
 * Bucket usage records into the 30×12 heatmap grid relative to a
 * reference `now`. Records older than 30 days are dropped; future-
 * timestamped records (clock skew) are dropped too. Column 0 is the
 * oldest day shown; column `HEATMAP_COLUMNS - 1` is the day
 * containing `now`.
 */
export function buildHeatmapGrid(records: UsageRecord[], now: Date = new Date()): HeatmapGrid {
  const endOfDay = new Date(now)
  endOfDay.setHours(23, 59, 59, 999)
  const startOfWindow = new Date(endOfDay)
  startOfWindow.setDate(startOfWindow.getDate() - (HEATMAP_COLUMNS - 1))
  startOfWindow.setHours(0, 0, 0, 0)

  const startMs = startOfWindow.getTime()
  const endMs = endOfDay.getTime()
  const oneDayMs = 24 * 60 * 60 * 1000

  // Phase 1: aggregate per-bucket token totals + per-provider sums.
  const cellMap = new Map<
    string,
    { totalTokens: number; eventCount: number; providerTokens: Map<ProviderId, number> }
  >()
  let last24h = 0
  let last7d = 0
  let last30d = 0
  const now24hMs = now.getTime() - 24 * 60 * 60 * 1000
  const now7dMs = now.getTime() - 7 * oneDayMs

  for (const record of records) {
    if (!Number.isFinite(record.timestamp)) continue
    if (record.timestamp < startMs || record.timestamp > endMs) continue
    const tokens = Number.isFinite(record.totalTokens) ? record.totalTokens : 0
    if (tokens <= 0) continue

    const eventDate = new Date(record.timestamp)
    const dayOffset = Math.floor((eventDate.getTime() - startMs) / oneDayMs)
    const column = Math.max(0, Math.min(HEATMAP_COLUMNS - 1, dayOffset))
    const row = Math.max(0, Math.min(HEATMAP_ROWS - 1, Math.floor(eventDate.getHours() / BUCKET_HOURS)))
    const key = `${column}-${row}`
    let bucket = cellMap.get(key)
    if (!bucket) {
      bucket = { totalTokens: 0, eventCount: 0, providerTokens: new Map() }
      cellMap.set(key, bucket)
    }
    bucket.totalTokens += tokens
    bucket.eventCount += 1
    if (record.provider) {
      bucket.providerTokens.set(
        record.provider,
        (bucket.providerTokens.get(record.provider) ?? 0) + tokens
      )
    }

    last30d += tokens
    if (record.timestamp >= now7dMs) last7d += tokens
    if (record.timestamp >= now24hMs) last24h += tokens
  }

  // Phase 2: figure out the max bucket weight so intensity
  // normalises against the brightest cell in this grid. Logarithmic
  // scaling keeps a single 100k spike from washing out everything
  // else — a bucket with 10× the tokens of another reads as
  // ~1.3× more intense, not 10×.
  let maxLogWeight = 0
  for (const bucket of cellMap.values()) {
    const weight = Math.log10(bucket.totalTokens + 1)
    if (weight > maxLogWeight) maxLogWeight = weight
  }

  // Phase 3: emit cells for every (column, row) in the grid so the
  // renderer can map straight to a fixed 30×12 layout without
  // checking sparse-map lookups.
  const cells: HeatmapCell[] = []
  for (let column = 0; column < HEATMAP_COLUMNS; column += 1) {
    for (let row = 0; row < HEATMAP_ROWS; row += 1) {
      const key = `${column}-${row}`
      const bucket = cellMap.get(key)
      if (!bucket) {
        cells.push({
          column,
          row,
          color: null,
          intensity: 0,
          totalTokens: 0,
          eventCount: 0,
          dominantProvider: null
        })
        continue
      }
      const weight = Math.log10(bucket.totalTokens + 1)
      const intensity = maxLogWeight > 0 ? Math.max(0.18, weight / maxLogWeight) : 0
      // Dominant provider = the one contributing the most tokens to
      // this bucket. Ties broken by deterministic provider order.
      let dominantProvider: ProviderId | null = null
      let dominantTokens = -1
      for (const [providerId, providerTokens] of bucket.providerTokens.entries()) {
        if (providerTokens > dominantTokens) {
          dominantTokens = providerTokens
          dominantProvider = providerId
        }
      }
      cells.push({
        column,
        row,
        color: dominantProvider ? HEATMAP_PROVIDER_COLOR_HEX[dominantProvider] : null,
        intensity,
        totalTokens: bucket.totalTokens,
        eventCount: bucket.eventCount,
        dominantProvider
      })
    }
  }

  return {
    cells,
    totals: { last24h, last7d, last30d },
    startDay: startOfWindow.toISOString().slice(0, 10),
    endDay: endOfDay.toISOString().slice(0, 10)
  }
}

/** Format a token count for the header chips (1.5K / 12.3M / etc.). */
export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 1000) return Math.round(value).toString()
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`
  return `${(value / 1_000_000_000).toFixed(2)}B`
}
