import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DiffViewer } from './components/DiffViewer'
import { FileEditorPanel } from './components/FileEditorPanel'
import { useAppearance } from './hooks/useAppearance'

type PopoutKind = 'file-editor' | 'diff-studio'

type WorkspaceDiff = Awaited<ReturnType<typeof window.api.getDiff>>

const parsePopoutKind = (value: string | null): PopoutKind | null => {
  return value === 'file-editor' || value === 'diff-studio' ? value : null
}

const basename = (path: string): string => {
  const cleaned = path.replace(/[\\/]+$/, '')
  return cleaned.split(/[\\/]/).filter(Boolean).pop() || path
}

// 1.0.5-PO2 — Debounce window for live-refresh signals. A burst of
// chat-updated events (e.g. during a tool-call sequence) collapses
// into a single getDiff fetch.
const REFRESH_DEBOUNCE_MS = 500

export function PopoutApp() {
  useAppearance()
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const kind = parsePopoutKind(params.get('popout'))
  const workspacePath = params.get('workspace') || ''
  const [diff, setDiff] = useState<WorkspaceDiff | null>(null)
  const [status, setStatus] = useState('')
  // 1.0.5-PO2 — fileEditorRefreshTick bumps to nudge FileEditorPanel
  // to re-list. We can't directly call into the panel; flipping a
  // key prop forces a re-mount. Cheap, correct, and the panel
  // already handles its own load lifecycle.
  const [fileEditorRefreshTick, setFileEditorRefreshTick] = useState(0)

  const refreshDiff = useCallback(async () => {
    if (kind !== 'diff-studio' || !workspacePath) return
    setStatus('Refreshing diff...')
    try {
      const nextDiff = await window.api.getDiff(workspacePath)
      setDiff(nextDiff)
      setStatus('Diff refreshed')
    } catch (error) {
      setDiff({
        type: 'error',
        text: error instanceof Error ? error.message : 'Could not load workspace diff'
      })
      setStatus('Diff refresh failed')
    }
  }, [kind, workspacePath])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void refreshDiff()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [refreshDiff])

  // 1.0.5-PO2 — Subscribe to the main-process broadcast that fires
  // whenever a chat in this workspace has changed. Debounce the
  // re-fetch so a chatty round doesn't spam getDiff.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!workspacePath) return
    const unsubscribe = window.api.onWorkspacePopoutRefresh((payload) => {
      // Belt-and-braces: main filters by workspacePath too, but if
      // any future broadcaster forgets we don't want cross-workspace
      // churn here.
      if (payload.workspacePath !== workspacePath) return
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null
        if (kind === 'diff-studio') {
          void refreshDiff()
        } else {
          setFileEditorRefreshTick((tick) => tick + 1)
        }
      }, REFRESH_DEBOUNCE_MS)
    })
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
      unsubscribe?.()
    }
  }, [kind, workspacePath, refreshDiff])

  if (!kind || !workspacePath) {
    return (
      <main className="popout-root">
        <section className="popout-error" role="alert">
          <strong>Popout unavailable</strong>
          <span>This window is missing a workspace or view type.</span>
        </section>
      </main>
    )
  }

  const title = kind === 'file-editor' ? 'File Editor' : 'Diff Studio'
  const workspaceName = basename(workspacePath)

  return (
    <main className="popout-root" data-popout-kind={kind}>
      <header className="popout-header">
        <div className="popout-title-block">
          <strong>{title}</strong>
          <span title={workspacePath}>{workspaceName}</span>
        </div>
        {kind === 'diff-studio' && (
          <div className="popout-actions">
            <span className="popout-status" role="status" aria-live="polite">
              {status}
            </span>
            <button className="btn btn-sm" type="button" onClick={() => void refreshDiff()}>
              Refresh
            </button>
          </div>
        )}
      </header>
      <section className="popout-body">
        {kind === 'file-editor' ? (
          // 1.0.5-PO2 — key bump forces FileEditorPanel to re-mount,
          // which re-runs its file-list load. Cheaper than wiring a
          // bespoke imperative refresh hook into the panel.
          <FileEditorPanel
            key={`file-editor-${fileEditorRefreshTick}`}
            workspacePath={workspacePath}
          />
        ) : (
          <div className="diff-studio popout-diff-studio">
            <DiffViewer diff={diff} workspacePath={workspacePath} />
          </div>
        )}
      </section>
    </main>
  )
}
