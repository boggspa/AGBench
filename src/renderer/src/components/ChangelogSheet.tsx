import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import bundledChangelog from '../../../../CHANGELOG.md?raw'
import type {
  ProductChangelogSnapshot,
  ProductUpdateChangelog,
  ProductUpdateReleaseNotes
} from '../../../main/store/types'
import type { UpdateStateSnapshot } from '../../../main/UpdateService'

interface ChangelogSheetProps {
  open: boolean
  onDismiss: () => void
  changelogSnapshot: ProductChangelogSnapshot | null
  updateSnapshot: UpdateStateSnapshot | null
  busy?: boolean
  onCheckForUpdates?: () => Promise<unknown> | unknown
  onDownloadUpdate?: () => Promise<unknown> | unknown
  onInstallUpdateNow?: () => Promise<unknown> | unknown
}

const SHEET_TITLE_ID = 'changelog-sheet-title'

export function ChangelogSheet({
  open,
  onDismiss,
  changelogSnapshot,
  updateSnapshot,
  busy = false,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdateNow
}: ChangelogSheetProps): React.JSX.Element | null {
  const dismissRef = useRef(onDismiss)
  useEffect(() => {
    dismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        dismissRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  const entry = useMemo(
    () => resolveChangelogEntry(changelogSnapshot, updateSnapshot),
    [changelogSnapshot, updateSnapshot]
  )
  const releaseNotes = formatReleaseNotes(entry.releaseNotes)
  const displayNotes = releaseNotes || bundledChangelog.trim() || 'No changelog is available yet.'
  const notesSource = releaseNotes ? 'Release notes' : 'Bundled changelog'
  const releasePageUrl = updateSnapshot?.releasePageUrl
  const updateStatus = updateSnapshot?.status || 'idle'
  const canAct = !busy && updateStatus !== 'checking' && updateStatus !== 'downloading'

  const handleInstall = useCallback(() => {
    if (!onInstallUpdateNow) return
    if (!confirm('Install update and restart TaskWraith now?')) return
    void onInstallUpdateNow()
  }, [onInstallUpdateNow])

  const handleOpenRelease = useCallback(() => {
    if (!releasePageUrl || typeof window.api.openExternalOrPath !== 'function') return
    void window.api.openExternalOrPath(releasePageUrl)
  }, [releasePageUrl])

  if (!open) return null

  return (
    <div
      className="changelog-sheet-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss()
      }}
    >
      <section
        className="changelog-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={SHEET_TITLE_ID}
      >
        <header className="changelog-sheet-header">
          <div className="changelog-sheet-header-text">
            <span className="changelog-sheet-glyph" aria-hidden="true">
              i
            </span>
            <div>
              <h2 id={SHEET_TITLE_ID}>{entry.releaseName || `TaskWraith ${entry.version}`}</h2>
              <p className="changelog-sheet-subtitle">
                v{entry.version}
                {entry.releaseDate ? ` - ${formatDate(entry.releaseDate)}` : ''} - {notesSource}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="changelog-sheet-close"
            onClick={onDismiss}
            aria-label="Close changelog sheet"
          >
            x
          </button>
        </header>

        {updateStatus === 'downloading' && updateSnapshot?.downloadProgress && (
          <div className="changelog-sheet-progress" role="status">
            <div
              className="changelog-sheet-progress-fill"
              style={{
                width: `${Math.max(0, Math.min(100, updateSnapshot.downloadProgress.percent))}%`
              }}
            />
            <span>{updateSnapshot.downloadProgress.percent.toFixed(1)}%</span>
          </div>
        )}

        {updateStatus === 'error' && updateSnapshot?.errorMessage && (
          <div className="changelog-sheet-error" role="status">
            {updateSnapshot.errorMessage}
          </div>
        )}

        <div className="changelog-sheet-notes">
          <pre>{displayNotes}</pre>
        </div>

        <footer className="changelog-sheet-actions">
          {releasePageUrl && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={handleOpenRelease}>
              Open release
            </button>
          )}
          {updateStatus === 'available' && onDownloadUpdate && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!canAct}
              onClick={() => void onDownloadUpdate()}
            >
              Download update
            </button>
          )}
          {updateStatus === 'downloaded' && onInstallUpdateNow && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={handleInstall}
            >
              Restart to install
            </button>
          )}
          {(updateStatus === 'error' ||
            updateStatus === 'idle' ||
            updateStatus === 'not-available' ||
            updateStatus === 'disabled') &&
            onCheckForUpdates && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || updateStatus === 'disabled'}
                onClick={() => void onCheckForUpdates()}
              >
                {updateStatus === 'error' ? 'Check again' : 'Check for updates'}
              </button>
            )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={onDismiss}>
            Close
          </button>
        </footer>
      </section>
    </div>
  )
}

export function resolveChangelogEntry(
  changelogSnapshot: ProductChangelogSnapshot | null,
  updateSnapshot: UpdateStateSnapshot | null
): ProductUpdateChangelog {
  if (updateSnapshot?.latestVersion) {
    return {
      version: updateSnapshot.latestVersion,
      ...(updateSnapshot.releaseName ? { releaseName: updateSnapshot.releaseName } : {}),
      ...(updateSnapshot.releaseDate ? { releaseDate: updateSnapshot.releaseDate } : {}),
      ...(updateSnapshot.releaseNotes ? { releaseNotes: updateSnapshot.releaseNotes } : {})
    }
  }
  if (changelogSnapshot?.pendingUpdateChangelog) return changelogSnapshot.pendingUpdateChangelog
  return {
    version: changelogSnapshot?.currentVersion || 'unknown'
  }
}

export function formatReleaseNotes(notes: ProductUpdateReleaseNotes | undefined): string {
  if (typeof notes === 'string') return notes.trim()
  if (!Array.isArray(notes)) return ''
  return notes
    .map((note) => {
      const body = note.note?.trim()
      return body ? `## ${note.version}\n${body}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function formatDate(value: string): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value
  return new Date(time).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  })
}
