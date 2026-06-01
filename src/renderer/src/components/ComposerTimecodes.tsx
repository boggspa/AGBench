import { useEffect, useState } from 'react'
import { ClockSymbolIcon } from './AppChromeSymbols'

const ZERO_RUN_TIMECODE = '00:00:00:00'

const formatRunTimecodeDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [days, hours, minutes, seconds].map((part) => part.toString().padStart(2, '0')).join(':')
}

export function ComposerRunTimecode({
  running,
  startedAt
}: {
  running: boolean
  startedAt?: string | null
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setNow(Date.now()))
    if (!running) return () => window.cancelAnimationFrame(frame)
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearInterval(timer)
    }
  }, [running, startedAt])

  const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN
  const label =
    running && Number.isFinite(startedAtMs)
      ? formatRunTimecodeDuration(now - startedAtMs)
      : ZERO_RUN_TIMECODE

  return (
    <span
      className="composer-run-timecode"
      data-running={running ? 'true' : 'false'}
      title={running ? 'Current run elapsed time' : 'Run timer'}
      aria-label={`${running ? 'Current run elapsed time' : 'Run timer'} ${label}`}
    >
      <ClockSymbolIcon />
      <span>{label}</span>
    </span>
  )
}

/**
 * 1.0.4-AR10 — cumulative session timecode. Sits directly right of
 * the per-run timecode. Pre-AR10 there was only the per-run
 * timecode that reset to 00:00:00:00 on every run boundary, which
 * made it hard to tell at a glance how much wall time you'd
 * accumulated across an extended panel session. The cumulative
 * timecode is derived purely from `chat.runs[]` start/end stamps:
 *
 *   - `cumulativeBaseMs` = Σ (endedAt - startedAt) for every
 *     completed run in this chat.
 *   - When a run is currently running, the component adds
 *     `now - startedAt` to the base on each tick.
 *   - When idle (no running run), the readout pauses at the base.
 *
 * Computed-from-state means it survives reloads automatically and
 * doesn't need its own persisted accumulator. Downtime between
 * runs is naturally excluded.
 */
export function ComposerCumulativeTimecode({
  running,
  startedAt,
  cumulativeBaseMs
}: {
  running: boolean
  startedAt?: string | null
  cumulativeBaseMs: number
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setNow(Date.now()))
    if (!running) return () => window.cancelAnimationFrame(frame)
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearInterval(timer)
    }
  }, [running, startedAt])

  const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN
  const liveDelta = running && Number.isFinite(startedAtMs) ? Math.max(0, now - startedAtMs) : 0
  const totalMs = cumulativeBaseMs + liveDelta
  const label = formatRunTimecodeDuration(totalMs)

  return (
    <span
      className="composer-run-timecode composer-run-timecode--cumulative"
      data-running={running ? 'true' : 'false'}
      title={
        running
          ? 'Cumulative session wall time (current run + all prior runs in this chat)'
          : 'Cumulative session wall time (sum of every run in this chat). Paused between runs.'
      }
      aria-label={`Cumulative session wall time ${label}`}
    >
      <ClockSymbolIcon />
      <span>{label}</span>
    </span>
  )
}
