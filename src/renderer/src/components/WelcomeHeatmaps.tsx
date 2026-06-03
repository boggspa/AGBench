import { Fragment, useEffect, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { visibleHeatmapSlots, type HeatmapLayout } from '../lib/welcomeHeatmapLayout'

export interface WelcomeHeatmapSlot {
  /** Stable identity for the heatmap (e.g. 'workspace' | 'agbench' | 'external'). */
  key: string
  node: ReactNode
}

interface WelcomeHeatmapsProps {
  slots: WelcomeHeatmapSlot[]
  layout: HeatmapLayout
  /** Seconds between cycles in 'single' layout. Default 90. */
  cycleSeconds?: number
}

/**
 * Container for the welcome-screen standalone heatmaps.
 *   - 'stacked' renders every slot vertically (the long-standing layout).
 *   - 'single' renders one slot at a time, auto-cycling through the slots every
 *     `cycleSeconds` (default 90s) — mirrors the dashboard tab auto-cycle.
 *
 * The interval lives here, so it unmounts automatically when the welcome region
 * disappears. Slots are rendered through a keyed Fragment (no wrapper element)
 * so the existing `.welcome-standalone-heatmaps > *` styling is untouched.
 */
export function WelcomeHeatmaps({
  slots,
  layout,
  cycleSeconds = 90
}: WelcomeHeatmapsProps): ReactElement | null {
  const [tick, setTick] = useState(0)
  const cycling = layout === 'single' && slots.length > 1

  useEffect(() => {
    if (!cycling) return
    const ms = Math.max(5, cycleSeconds) * 1000
    const id = setInterval(() => setTick((t) => t + 1), ms)
    return () => clearInterval(id)
  }, [cycling, cycleSeconds])

  if (slots.length === 0) return null

  const visible = visibleHeatmapSlots(slots, layout, tick)
  const className = `welcome-standalone-heatmaps welcome-standalone-heatmaps--${layout}`

  if (layout === 'single') {
    const slot = visible[0]
    if (!slot) return null
    return (
      <div className={className}>
        <div
          key={slot.key}
          className={`welcome-standalone-heatmap-pane${cycling ? ' is-cycling' : ''}`}
        >
          {slot.node}
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      {visible.map((slot) => (
        <Fragment key={slot.key}>{slot.node}</Fragment>
      ))}
    </div>
  )
}
