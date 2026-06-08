import type { ProviderId } from '../../../main/store/types'
import { getProviderLabel } from '../lib/providerLabels'
import type { ExternalPathGrantGap } from '../lib/externalPathGrantPreflight'

export interface ExternalPathGrantPromptCardProps {
  gaps: ExternalPathGrantGap[]
  trigger: 'preflight' | 'attach'
  onGrantRead: () => void
  onGrantEdit: () => void
  onDismiss: () => void
  busy?: boolean
}

function formatMissingProviders(providers: ProviderId[]): string {
  return providers.map((provider) => getProviderLabel(provider)).join(', ')
}

export function ExternalPathGrantPromptCard({
  gaps,
  trigger,
  onGrantRead,
  onGrantEdit,
  onDismiss,
  busy = false
}: ExternalPathGrantPromptCardProps): React.JSX.Element | null {
  if (gaps.length === 0) return null

  const title =
    trigger === 'attach'
      ? 'Grant access to additional workspace'
      : 'Additional workspace access required'

  const message =
    trigger === 'attach'
      ? 'Panelists need a signed external-path grant before this workspace is attached to the chat.'
      : 'Some panelists still need signed grants for additional workspaces before this round can run.'

  return (
    <div className="composer-permission-card provider-external-path">
      <div className="composer-permission-title">
        <span>{title}</span>
        <span className="composer-permission-source">Workspace access</span>
      </div>
      <div className="composer-permission-message">{message}</div>
      <div className="composer-permission-paths">
        {gaps.map((gap) => (
          <div key={gap.path} className="composer-permission-external-path">
            <span className="composer-permission-external-path-label">
              {gap.access === 'write' ? 'Edit' : 'Read'} · needs{' '}
              {formatMissingProviders(gap.missingProviders)}
            </span>
            <code className="composer-permission-external-path-value">{gap.path}</code>
          </div>
        ))}
      </div>
      <div className="composer-permission-actions">
        <button
          className="btn btn-sm btn-primary"
          type="button"
          disabled={busy}
          onClick={onGrantRead}
        >
          Grant read access
        </button>
        <button className="btn btn-sm" type="button" disabled={busy} onClick={onGrantEdit}>
          Grant edit access
        </button>
        <button className="btn btn-sm btn-ghost" type="button" disabled={busy} onClick={onDismiss}>
          {trigger === 'attach' ? 'Cancel' : 'Dismiss'}
        </button>
      </div>
    </div>
  )
}
