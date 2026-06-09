import { useCallback, useEffect, useState } from 'react'
import type { LocalServersSnapshot } from '../../../main/localServers/types'

/**
 * Subscribes to the main-process LocalServersService: hydrates once on mount,
 * then receives pushed snapshots. Mirrors useUpdateStatus. Stop actions are
 * added in Phase B.
 */
export function useLocalServers(): {
  snapshot: LocalServersSnapshot | null
  servers: LocalServersSnapshot['servers']
  busy: boolean
  refresh: () => Promise<LocalServersSnapshot | null>
  stop: (pid: number) => Promise<void>
  stopAll: () => Promise<void>
} {
  const [snapshot, setSnapshot] = useState<LocalServersSnapshot | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<LocalServersSnapshot | null> => {
    if (typeof window.api.localServersSnapshot !== 'function') return null
    try {
      const next = await window.api.localServersSnapshot()
      setSnapshot(next)
      return next
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    void refresh()
    if (typeof window.api.onLocalServersChanged !== 'function') return
    return window.api.onLocalServersChanged((next) => setSnapshot(next))
  }, [refresh])

  const stop = useCallback(
    async (pid: number): Promise<void> => {
      if (typeof window.api.localServersStop !== 'function') return
      setBusy(true)
      try {
        await window.api.localServersStop(pid)
        await refresh()
      } finally {
        setBusy(false)
      }
    },
    [refresh]
  )

  const stopAll = useCallback(async (): Promise<void> => {
    if (typeof window.api.localServersStopAll !== 'function') return
    setBusy(true)
    try {
      await window.api.localServersStopAll()
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [refresh])

  return {
    snapshot,
    servers: snapshot?.servers ?? [],
    busy,
    refresh,
    stop,
    stopAll
  }
}
