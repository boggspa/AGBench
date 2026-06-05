import React from 'react'
import type { UpdateStateSnapshot } from '../../../main/UpdateService'

interface UpdatePillProps {
  snapshot: UpdateStateSnapshot | null
  onOpen: () => void
  /** 'corner' = the chat-corner icon button (default); 'sidebar' = the accent
   * pill in the sidebar masthead. Both gate on the same actionable statuses,
   * so the pill is absent at rest. */
  variant?: 'corner' | 'sidebar'
}

const ACTIONABLE_UPDATE_STATUSES = new Set<UpdateStateSnapshot['status']>([
  'available',
  'downloading',
  'downloaded',
  'error'
])

export function UpdatePill({
  snapshot,
  onOpen,
  variant = 'corner'
}: UpdatePillProps): React.JSX.Element | null {
  if (!snapshot || !ACTIONABLE_UPDATE_STATUSES.has(snapshot.status)) return null

  const label = labelForSnapshot(snapshot)
  const className =
    variant === 'sidebar'
      ? `sidebar-update-pill sidebar-update-pill-${snapshot.status}`
      : `chat-corner-btn chat-corner-update-pill chat-corner-update-pill-${snapshot.status}`
  return (
    <button
      className={className}
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
        ? `TaskWraith ${snapshot.latestVersion} is available`
        : 'An TaskWraith update is available'
    case 'downloading':
      return 'TaskWraith update is downloading'
    case 'downloaded':
      return 'Restart TaskWraith to install the downloaded update'
    case 'error':
      return snapshot.errorMessage || 'TaskWraith update check failed'
    default:
      return 'TaskWraith update'
  }
}
