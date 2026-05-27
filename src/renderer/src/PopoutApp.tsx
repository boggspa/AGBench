import { useCallback, useEffect, useMemo, useState } from 'react'
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

export function PopoutApp() {
  useAppearance()
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const kind = parsePopoutKind(params.get('popout'))
  const workspacePath = params.get('workspace') || ''
  const [diff, setDiff] = useState<WorkspaceDiff | null>(null)
  const [status, setStatus] = useState('')

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
    void refreshDiff()
  }, [refreshDiff])

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
          <FileEditorPanel workspacePath={workspacePath} />
        ) : (
          <div className="diff-studio popout-diff-studio">
            <DiffViewer diff={diff} workspacePath={workspacePath} />
          </div>
        )}
      </section>
    </main>
  )
}
