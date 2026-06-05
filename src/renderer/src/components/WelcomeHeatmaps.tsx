import { Fragment, useEffect, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { visibleHeatmapSlots, type HeatmapLayout } from '../lib/welcomeHeatmapLayout'

const HEATMAP_SWIPE_MS = 320

export interface WelcomeHeatmapSlot {
  /** Stable identity for the heatmap (e.g. 'workspace' | 'taskwraith' | 'external'). */
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
 * disappears. Stacked slots still render through keyed Fragments so the existing
 * vertical layout stays untouched; single mode mounts an outgoing pane only for
 * the short swipe transition.
 */
export function WelcomeHeatmaps({
  slots,
  layout,
  cycleSeconds = 90
}: WelcomeHeatmapsProps): ReactElement | null {
  const [activeIndex, setActiveIndex] = useState(0)
  const [outgoingIndex, setOutgoingIndex] = useState<number | null>(null)
  const cycling = layout === 'single' && slots.length > 1

  useEffect(() => {
    setOutgoingIndex(null)
    setActiveIndex((index) => (slots.length > 0 ? index % slots.length : 0))
  }, [layout, slots.length])

  useEffect(() => {
    if (!cycling) return
    const ms = Math.max(5, cycleSeconds) * 1000
    const id = setInterval(() => {
      setOutgoingIndex(activeIndex)
      setActiveIndex((activeIndex + 1) % slots.length)
    }, ms)
    return () => clearInterval(id)
  }, [activeIndex, cycling, cycleSeconds, slots.length])

  useEffect(() => {
    if (outgoingIndex === null) return
    const id = window.setTimeout(() => setOutgoingIndex(null), HEATMAP_SWIPE_MS)
    return () => window.clearTimeout(id)
  }, [outgoingIndex])

  if (slots.length === 0) return null

  const visible = visibleHeatmapSlots(slots, layout, activeIndex)
  const className = `welcome-standalone-heatmaps welcome-standalone-heatmaps--${layout}`

  if (layout === 'single') {
    const slot = slots[activeIndex % slots.length]
    const outgoingSlot = outgoingIndex === null ? null : slots[outgoingIndex % slots.length]
    const transitioning = Boolean(outgoingSlot && outgoingSlot.key !== slot.key)
    return (
      <div className={className}>
        {transitioning && outgoingSlot && (
          <div
            key={`outgoing-${outgoingSlot.key}`}
            className="welcome-standalone-heatmap-pane is-outgoing"
          >
            {outgoingSlot.node}
          </div>
        )}
        <div
          key={`active-${slot.key}`}
          className={`welcome-standalone-heatmap-pane${
            transitioning ? ' is-incoming' : ' is-active'
          }`}
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
