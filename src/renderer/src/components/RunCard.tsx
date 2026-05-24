import { useEffect, useMemo, useState, type JSX } from 'react'
import type { ChatRun, ProviderId, RunEventReplay } from '../../../main/store/types'
import { classifyRunEvent } from '../lib/RunEventClassifier'
import { DigitOdometer } from './DigitOdometer'

interface RunCardProps {
  run: ChatRun
  fallbackProvider?: ProviderId
  /** Phase K1B: when provided, the Inspect button enters Run mode for
   * this run. Without it, the button just logs a stub for debugging
   * (the K1A default). */
  onInspect?: (runId: string) => void
}

interface RunAggregate {
  approvalCount: number
  eventFileCount: number | null
}

export function RunCard({ run, fallbackProvider, onInspect }: RunCardProps): JSX.Element {
  const provider = run.provider || fallbackProvider || 'gemini'
  const [aggregate, setAggregate] = useState<RunAggregate>({
    approvalCount: 0,
    eventFileCount: null
  })
  const [, setNowTick] = useState(0)

  const isActive =
    !run.endedAt &&
    run.status !== 'failed' &&
    run.status !== 'cancelled' &&
    run.status !== 'success'
  const fileCount = useMemo(() => {
    const diffCount = countRunDiffFiles(run)
    if (diffCount !== null) return diffCount
    return aggregate.eventFileCount
  }, [aggregate.eventFileCount, run])

  useEffect(() => {
    let cancelled = false
    const refresh = async (): Promise<void> => {
      if (!run.runId || typeof window.api.getRunEventReplay !== 'function') return
      try {
        const replay = (await window.api.getRunEventReplay(run.runId)) as RunEventReplay
        if (cancelled) return
        setAggregate(buildRunAggregate(replay))
      } catch {
        if (!cancelled) setAggregate((current) => current)
      }
    }
    void refresh()
    if (!isActive)
      return () => {
        cancelled = true
      }
    const intervalId = window.setInterval(() => void refresh(), 2000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [isActive, run.runId])

  useEffect(() => {
    if (!isActive) return
    const intervalId = window.setInterval(() => setNowTick((tick) => tick + 1), 1000)
    return () => window.clearInterval(intervalId)
  }, [isActive])

  const status = getRunStatus(run)
  const duration = formatDuration(run.startedAt, run.endedAt)
  const inspect = (): void => {
    // K1B+ always provides `onInspect`. Silent no-op fallback protects
    // against any future caller that mounts RunCard without wiring it
    // — a no-op button is a fixable bug, not a silent data issue.
    if (onInspect && run.runId) onInspect(run.runId)
  }

  return (
    <div className="run-card" data-provider={provider}>
      <div className="run-card-main">
        <div className="run-card-title-row">
          <span className={`run-card-provider provider-${provider}`}>
            {getProviderLabel(provider)}
          </span>
          <span className={`run-card-status tone-${status.tone}`}>{status.label}</span>
          <span className="run-card-id" title={run.runId}>
            #{shortRunId(run.runId)}
          </span>
        </div>
        <div className="run-card-meta">
          <span>{duration}</span>
          {fileCount !== null && (
            <span className="run-card-meta-count">
              <DigitOdometer value={fileCount} /> file{fileCount === 1 ? '' : 's'}
            </span>
          )}
          <span className="run-card-meta-count">
            <DigitOdometer value={aggregate.approvalCount} /> approval
            {aggregate.approvalCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      <button type="button" className="run-card-inspect" onClick={inspect} title="Inspect run">
        <span>Inspect</span>
        <span aria-hidden>→</span>
      </button>
    </div>
  )
}

function buildRunAggregate(replay: RunEventReplay): RunAggregate {
  const files = new Set<string>()
  let editEventCount = 0
  let approvalCount = 0

  for (const event of replay.events || []) {
    const classified = classifyRunEvent(event)
    if (event.kind === 'approval_request') {
      approvalCount += 1
    } else if (classified.kind === 'file_edit') {
      editEventCount += 1
      for (const file of classified.files) files.add(file)
    }
  }

  return {
    approvalCount,
    eventFileCount: files.size > 0 ? files.size : editEventCount > 0 ? editEventCount : null
  }
}

function countRunDiffFiles(run: ChatRun): number | null {
  const diff = run.runDiff
  if (!diff) return null
  const files = [
    ...(diff.createdFiles || []),
    ...(diff.modifiedFiles || []),
    ...(diff.deletedFiles || [])
  ].filter((file) => file && !file.isNoise)
  return files.length
}

function getRunStatus(run: ChatRun): {
  label: string
  tone: 'success' | 'warning' | 'danger' | 'muted' | 'running'
} {
  if (run.cancelled || run.status === 'cancelled') return { label: 'Cancelled', tone: 'muted' }
  if (run.status === 'failed') return { label: 'Failed', tone: 'danger' }
  // In-flight runs render as the contrast-aware accent shimmer-sweep
  // "Active" badge (CSS handles the animation; tone-running is the hook).
  if (!run.endedAt) return { label: 'Active', tone: 'running' }
  if (run.status === 'success' || run.status === 'completed')
    return { label: 'Done', tone: 'success' }
  if (run.status === 'success_with_warnings') return { label: 'Warnings', tone: 'warning' }
  return { label: run.status || 'Complete', tone: 'muted' }
}

function formatDuration(startedAt?: string, endedAt?: string): string {
  const started = startedAt ? Date.parse(startedAt) : NaN
  if (!Number.isFinite(started)) return 'duration unknown'
  const ended = endedAt ? Date.parse(endedAt) : Date.now()
  const elapsedMs = Math.max(0, (Number.isFinite(ended) ? ended : Date.now()) - started)
  const seconds = Math.floor(elapsedMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function getProviderLabel(provider: ProviderId): string {
  if (provider === 'codex') return 'Codex'
  if (provider === 'claude') return 'Claude'
  if (provider === 'kimi') return 'Kimi'
  return 'Gemini'
}

function shortRunId(runId: string): string {
  if (runId.length <= 8) return runId
  return runId.slice(0, 8)
}
