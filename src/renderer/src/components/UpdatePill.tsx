import React from 'react'
import type { UpdateStateSnapshot } from '../../../main/UpdateService'

interface UpdatePillProps {
  snapshot: UpdateStateSnapshot | null
  onOpen: () => void
}

const ACTIONABLE_UPDATE_STATUSES = new Set<UpdateStateSnapshot['status']>([
  'available',
  'downloading',
  'downloaded',
  'error'
])

export function UpdatePill({ snapshot, onOpen }: UpdatePillProps): React.JSX.Element | null {
  if (!snapshot || !ACTIONABLE_UPDATE_STATUSES.has(snapshot.status)) return null

  const label = labelForSnapshot(snapshot)
  return (
    <button
      className={`chat-corner-btn chat-corner-update-pill chat-corner-update-pill-${snapshot.status}`}
      type="button"
      onClick={onOpen}
      title={titleForSnapshot(snapshot)}
      aria-label={titleForSnapshot(snapshot)}
    >
      <span className="chat-corner-update-pill-label">{label}</span>
    </button>
  )
}

function labelForSnapshot(snapshot: UpdateStateSnapshot): string {
  switch (snapshot.status) {
    case 'available':
      return snapshot.latestVersion ? `Update ${snapshot.latestVersion}` : 'Update'
    case 'downloading':
      return typeof snapshot.downloadProgress?.percent === 'number'
        ? `${Math.round(snapshot.downloadProgress.percent)}%`
        : 'Downloading'
    case 'downloaded':
      return 'Restart'
    case 'error':
      return 'Update issue'
    default:
      return 'Update'
  }
}

function titleForSnapshot(snapshot: UpdateStateSnapshot): string {
  switch (snapshot.status) {
    case 'available':
      return snapshot.latestVersion
        ? `AGBench ${snapshot.latestVersion} is available`
        : 'An AGBench update is available'
    case 'downloading':
      return 'AGBench update is downloading'
    case 'downloaded':
      return 'Restart AGBench to install the downloaded update'
    case 'error':
      return snapshot.errorMessage || 'AGBench update check failed'
    default:
      return 'AGBench update'
  }
}
