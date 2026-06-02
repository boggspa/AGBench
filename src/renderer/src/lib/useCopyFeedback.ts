import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Shared copy-to-clipboard with transient "Copied" feedback.
 *
 * Extracted in 1.0.8 so the many copy affordances scattered across the
 * transcript (markdown blocks, diffs, inspector, media paths, latest-
 * response) give consistent confirmation instead of silently copying.
 *
 * Returns the id currently showing its confirmation (or null) plus a
 * `copy(id, text)` action. One hook instance can drive many buttons:
 * give each a stable id, and the matching button shows "Copied" for
 * ~1.2s. The timer is cleared on unmount so we never setState on a
 * dead component.
 */
export function useCopyFeedback(resetMs = 1200): {
  copiedId: string | null
  copy: (id: string, text: string) => void
} {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const copy = useCallback(
    (id: string, text: string): void => {
      void navigator.clipboard?.writeText(text)
      setCopiedId(id)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopiedId(null), resetMs)
    },
    [resetMs]
  )

  return { copiedId, copy }
}
