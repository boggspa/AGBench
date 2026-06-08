import { useEffect, useRef, useState } from 'react'

/**
 * Keeps a conditionally-rendered panel mounted long enough to play an
 * open/close transition instead of snapping in/out on mount/unmount.
 *
 * Returns the `mounted` flag to gate rendering and a `className` to spread
 * onto the panel root (and its resize handle) which drives the CSS slide +
 * fade (see `13-panel-transitions.css`). The settled/idle state carries no
 * animation class, so live drag-resize stays instant.
 *
 * The very first render is never animated — only subsequent user toggles —
 * so panels don't slide in on app launch / window restore.
 */
export interface PanelPresence {
  mounted: boolean
  className: string
}

const ANIM_CLASS = 'tw-panel-anim'
const COLLAPSED_CLASS = 'tw-panel-collapsed'

export function usePanelPresence(open: boolean, durationMs = 260): PanelPresence {
  const [mounted, setMounted] = useState(open)
  const [className, setClassName] = useState('')
  const firstRun = useRef(true)
  const raf1 = useRef<number | null>(null)
  const raf2 = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Don't animate the initial state — only react to genuine toggles.
    if (firstRun.current) {
      firstRun.current = false
      setMounted(open)
      return
    }

    const clearScheduled = (): void => {
      if (raf1.current != null) cancelAnimationFrame(raf1.current)
      if (raf2.current != null) cancelAnimationFrame(raf2.current)
      if (timer.current != null) clearTimeout(timer.current)
      raf1.current = null
      raf2.current = null
      timer.current = null
    }
    clearScheduled()

    if (open) {
      setMounted(true)
      // Frame A: mount collapsed with the transition armed (no change yet).
      setClassName(`${ANIM_CLASS} ${COLLAPSED_CLASS}`)
      raf1.current = requestAnimationFrame(() => {
        // Frame B: drop the collapsed modifier → transition to expanded.
        raf2.current = requestAnimationFrame(() => setClassName(ANIM_CLASS))
      })
      // Settle: strip the transition class so resize stays instant.
      timer.current = setTimeout(() => setClassName(''), durationMs + 60)
    } else {
      // Exit: transition from expanded → collapsed, then unmount.
      setClassName(`${ANIM_CLASS} ${COLLAPSED_CLASS}`)
      timer.current = setTimeout(() => {
        setMounted(false)
        setClassName('')
      }, durationMs)
    }

    return clearScheduled
  }, [open, durationMs])

  return { mounted, className }
}
