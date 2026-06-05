import { useEffect, useState } from 'react'
import type { AppShellStatsSnapshot } from '../../../main/services/AppShellStatsService'

interface AppShellStatsToolbarProps {
  initialSnapshot?: AppShellStatsSnapshot | null
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '--'
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`
}

function formatCount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0'
  return String(Math.max(0, Math.floor(value)))
}

function formatRamGB(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return `${(Math.max(0, value) / 1024).toFixed(1)}GB`
}

function CpuIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.7" />
      <path d="M6.3 1.8v2.1M9.7 1.8v2.1M6.3 12.1v2.1M9.7 12.1v2.1M1.8 6.3h2.1M1.8 9.7h2.1M12.1 6.3h2.1M12.1 9.7h2.1" />
      <path d="M6.75 8h2.5" />
    </svg>
  )
}

function RamIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path d="M3.4 5.1h9.2c.7 0 1.2.5 1.2 1.2v4.1c0 .7-.5 1.2-1.2 1.2H3.4c-.7 0-1.2-.5-1.2-1.2V6.3c0-.7.5-1.2 1.2-1.2z" />
      <path d="M4.4 3.1v2M7 3.1v2M9.6 3.1v2M12.2 3.1v2M4.8 11.6v1.3M11.2 11.6v1.3" />
      <path d="M4.8 8.4h6.4" />
    </svg>
  )
}

function ThreadIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path d="M4 3.2h8M4 8h8M4 12.8h8" />
      <path d="M5.6 3.2c2.2 2.1 2.2 7.5 0 9.6M10.4 3.2c-2.2 2.1-2.2 7.5 0 9.6" />
    </svg>
  )
}

export function AppShellStatsToolbar({ initialSnapshot = null }: AppShellStatsToolbarProps) {
  const [snapshot, setSnapshot] = useState<AppShellStatsSnapshot | null>(initialSnapshot)

  useEffect(() => {
    let disposed = false
    const api = window.api
    if (!api?.getAppShellStats || !api?.onAppShellStatsChanged) return

    api
      .getAppShellStats()
      .then((next) => {
        if (!disposed) setSnapshot(next)
      })
      .catch(() => {
        // Unsupported stats remain visibly unavailable.
      })

    const unsubscribe = api.onAppShellStatsChanged((next) => {
      if (!disposed) setSnapshot(next)
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const cpuLabel = formatPercent(snapshot?.cpuPercent ?? null)
  const ramLabel = formatPercent(snapshot?.ramPercent ?? null)
  const ramGBLabel = formatRamGB(snapshot?.ramUsedMB)
  const fullRamLabel = ramGBLabel ? `${ramLabel} ${ramGBLabel}` : ramLabel
  const threadLabel = formatCount(snapshot?.activeThreadCount)

  return (
    <div className="app-shell-stats-toolbar" role="group" aria-label="TaskWraith app stats">
      <span
        className="app-shell-stat app-shell-stat--cpu"
        title="TaskWraith Electron CPU"
        aria-label={`TaskWraith Electron CPU ${cpuLabel}`}
      >
        <CpuIcon />
        <span className="app-shell-stat-label">CPU</span>
        <span className="app-shell-stat-value">{cpuLabel}</span>
      </span>
      <span
        className="app-shell-stat app-shell-stat--ram"
        title="TaskWraith Electron RAM"
        aria-label={`TaskWraith Electron RAM ${fullRamLabel}`}
      >
        <RamIcon />
        <span className="app-shell-stat-label">Memory</span>
        <span className="app-shell-stat-value">{ramLabel}</span>
        {ramGBLabel && <span className="app-shell-stat-detail">{ramGBLabel}</span>}
      </span>
      <span
        className="app-shell-stat app-shell-stat--threads"
        title="Running TaskWraith threads"
        aria-label={`Running TaskWraith threads ${threadLabel}`}
      >
        <ThreadIcon />
        <span className="app-shell-stat-label">Threads</span>
        <span className="app-shell-stat-value">{threadLabel}</span>
      </span>
    </div>
  )
}
