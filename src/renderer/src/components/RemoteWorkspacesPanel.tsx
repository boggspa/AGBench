import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'

/**
 * RemoteWorkspacesPanel — Phase C4 admin UI for the iOS remote allowlist.
 *
 * Lives inside Settings (under the "Remote Workspaces" tab) and lets the
 * desktop user explicitly opt workspaces in to iOS-side access. Without
 * an entry, every iOS-initiated turn against that workspace is denied
 * by `BridgeActionRouter`.
 *
 * Self-contained: pulls state via the preload bindings (`api.bridgeAllowlist*`)
 * so no parent prop threading. Refetches the full list after any
 * mutation — the list is small (typically < 20 entries), so the cost
 * is negligible and the code stays trivially correct.
 *
 * UX shape (deliberately minimal for v1):
 *   - List of current entries with mode/providers/expiry inline
 *   - One-form "Add entry" inline at the top (workspaceId + path + checkboxes)
 *   - Per-row "Remove" action
 *   - "Clear all" footer action with confirm
 *
 * Future polish (deferred):
 *   - Workspace picker that surfaces the user's actual registered workspaces
 *   - Expiry as a date picker, not raw ms
 *   - Per-row inline edit
 */

interface RemoteWorkspaceEntry {
  workspaceId: string
  path: string
  mode: 'read-only' | 'read-write'
  allowedProviders: string[]
  allowedApprovalModes: string[]
  expiresAt?: number
  createdAt: number
  updatedAt: number
}

// Include every first-class provider in the remote bridge allowlist toggles.
const PROVIDER_OPTIONS = [
  'gemini',
  'codex',
  'claude',
  'kimi',
  'grok',
  'cursor',
  'ollama'
] as const
const APPROVAL_MODE_OPTIONS = ['default', 'plan'] as const

export function RemoteWorkspacesPanel(): ReactElement {
  const [entries, setEntries] = useState<RemoteWorkspaceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      const result = (await window.api.bridgeAllowlistList()) as RemoteWorkspaceEntry[]
      setEntries(result ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  return (
    <section className="settings-group remote-workspaces-panel">
      <header className="remote-workspaces-header">
        <div>
          <label className="settings-label remote-workspaces-title">
            iOS Remote Workspace Allowlist
          </label>
          <p className="remote-workspaces-kicker">Paired-device access control</p>
        </div>
        <span className="remote-workspaces-count">{entries.length} allowed</span>
      </header>
      <div className="settings-hint remote-workspaces-hint">
        Workspaces a paired iOS device may initiate runs against. Empty list = all iOS-initiated
        turns are denied. Per-action revalidation is enforced — removing an entry takes effect on
        the next iOS request.
      </div>

      {error && <div className="settings-error remote-workspaces-error">{error}</div>}

      <AddEntryForm
        onAdded={async () => {
          await refresh()
        }}
      />

      <div className="remote-workspaces-list-section">
        {loading ? (
          <div className="settings-hint remote-workspaces-empty">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="settings-hint remote-workspaces-empty">
            <strong>No remote workspaces yet</strong>
            <span>Add a workspace to let a paired iPhone start runs against it.</span>
          </div>
        ) : (
          <ul className="remote-workspaces-entry-list">
            {entries.map((entry) => (
              <EntryRow
                key={entry.workspaceId}
                entry={entry}
                onRemove={async () => {
                  await window.api.bridgeAllowlistRemove(entry.workspaceId)
                  await refresh()
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {entries.length > 0 && (
        <div className="remote-workspaces-footer">
          <button
            type="button"
            className="btn btn-sm btn-ghost remote-workspaces-clear"
            onClick={async () => {
              if (!confirm('Remove all remote workspace allowlist entries?')) return
              await window.api.bridgeAllowlistClear()
              await refresh()
            }}
          >
            Clear all entries
          </button>
        </div>
      )}
    </section>
  )
}

function EntryRow({
  entry,
  onRemove
}: {
  entry: RemoteWorkspaceEntry
  onRemove: () => void | Promise<void>
}): ReactElement {
  const expiresLabel =
    entry.expiresAt !== undefined ? new Date(entry.expiresAt).toLocaleString() : '—'
  return (
    <li className="remote-workspaces-entry-card">
      <div className="remote-workspaces-entry-layout">
        <div className="remote-workspaces-entry-main">
          <div className="remote-workspaces-entry-heading">
            <span className="remote-workspaces-entry-id">{entry.workspaceId}</span>
            <span
              className={`remote-workspaces-chip remote-workspaces-mode-chip ${entry.mode === 'read-write' ? 'is-write' : ''}`}
            >
              {entry.mode === 'read-write' ? 'Read-write' : 'Read-only'}
            </span>
          </div>
          <div className="remote-workspaces-path">{entry.path}</div>
          <div className="remote-workspaces-meta">
            <div className="remote-workspaces-meta-group">
              <span className="remote-workspaces-meta-label">Providers</span>
              <ChipList values={entry.allowedProviders} emptyLabel="None" />
            </div>
            <div className="remote-workspaces-meta-group">
              <span className="remote-workspaces-meta-label">Approval</span>
              <ChipList values={entry.allowedApprovalModes} emptyLabel="None" />
            </div>
            <div className="remote-workspaces-meta-group">
              <span className="remote-workspaces-meta-label">Expires</span>
              <span className="remote-workspaces-chip">{expiresLabel}</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-ghost remote-workspaces-remove"
          onClick={() => void onRemove()}
        >
          Remove
        </button>
      </div>
    </li>
  )
}

function ChipList({ values, emptyLabel }: { values: string[]; emptyLabel: string }): ReactElement {
  const chips = values.length > 0 ? values : [emptyLabel]
  return (
    <span className="remote-workspaces-chip-list">
      {chips.map((value) => (
        <span
          key={value}
          className={`remote-workspaces-chip ${values.length === 0 ? 'is-empty' : ''}`}
        >
          {value}
        </span>
      ))}
    </span>
  )
}

function AddEntryForm({ onAdded }: { onAdded: () => void | Promise<void> }): ReactElement {
  const [workspaceId, setWorkspaceId] = useState('')
  const [path, setPath] = useState('')
  const [mode, setMode] = useState<'read-only' | 'read-write'>('read-only')
  const [providers, setProviders] = useState<Set<string>>(new Set(['gemini']))
  const [approvalModes, setApprovalModes] = useState<Set<string>>(new Set(['default']))
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const toggle = (set: Set<string>, value: string, setter: (s: Set<string>) => void): void => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setter(next)
  }

  const submit = async (): Promise<void> => {
    setFormError(null)
    if (!workspaceId.trim() || !path.trim()) {
      setFormError('workspaceId and path are required')
      return
    }
    setSubmitting(true)
    try {
      await window.api.bridgeAllowlistUpsert({
        workspaceId: workspaceId.trim(),
        path: path.trim(),
        mode,
        allowedProviders: Array.from(providers),
        allowedApprovalModes: Array.from(approvalModes)
      })
      setWorkspaceId('')
      setPath('')
      setMode('read-only')
      setProviders(new Set(['gemini']))
      setApprovalModes(new Set(['default']))
      await onAdded()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="remote-workspaces-form">
      <div className="remote-workspaces-form-header">
        <span>Add workspace access</span>
        <small>Path and policy are validated again before every iOS action.</small>
      </div>

      <div className="remote-workspaces-form-grid">
        <label className="remote-workspaces-field">
          <span>Workspace ID</span>
          <input
            type="text"
            placeholder="ws-myproject"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="settings-input remote-workspaces-input"
            disabled={submitting}
          />
        </label>
        <label className="remote-workspaces-field remote-workspaces-path-field">
          <span>Workspace path</span>
          <input
            type="text"
            placeholder="/Users/you/projects/myproject"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className="settings-input remote-workspaces-input"
            disabled={submitting}
          />
        </label>
      </div>

      <fieldset className="remote-workspaces-fieldset">
        <legend>Mode</legend>
        <div
          className="remote-workspaces-segmented"
          role="radiogroup"
          aria-label="Workspace access mode"
        >
          <label className={`remote-workspaces-segment ${mode === 'read-only' ? 'active' : ''}`}>
            <input
              type="radio"
              name="remote-workspace-mode"
              checked={mode === 'read-only'}
              onChange={() => setMode('read-only')}
              disabled={submitting}
            />
            <span>Read-only</span>
          </label>
          <label className={`remote-workspaces-segment ${mode === 'read-write' ? 'active' : ''}`}>
            <input
              type="radio"
              name="remote-workspace-mode"
              checked={mode === 'read-write'}
              onChange={() => setMode('read-write')}
              disabled={submitting}
            />
            <span>Read-write</span>
          </label>
        </div>
      </fieldset>

      <fieldset className="remote-workspaces-fieldset">
        <legend>Providers</legend>
        <div className="remote-workspaces-toggle-grid">
          {PROVIDER_OPTIONS.map((provider) => (
            <label
              key={provider}
              className={`remote-workspaces-toggle-chip ${providers.has(provider) ? 'active' : ''}`}
            >
              <input
                type="checkbox"
                checked={providers.has(provider)}
                onChange={() => toggle(providers, provider, setProviders)}
                disabled={submitting}
              />
              <span>{provider}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="remote-workspaces-fieldset">
        <legend>Approval modes</legend>
        <div className="remote-workspaces-toggle-grid">
          {APPROVAL_MODE_OPTIONS.map((approvalMode) => (
            <label
              key={approvalMode}
              className={`remote-workspaces-toggle-chip ${approvalModes.has(approvalMode) ? 'active' : ''}`}
            >
              <input
                type="checkbox"
                checked={approvalModes.has(approvalMode)}
                onChange={() => toggle(approvalModes, approvalMode, setApprovalModes)}
                disabled={submitting}
              />
              <span>{approvalMode}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {formError && <div className="settings-error remote-workspaces-error">{formError}</div>}

      <button
        type="button"
        className="btn btn-sm btn-primary"
        onClick={() => void submit()}
        disabled={submitting || !workspaceId.trim() || !path.trim()}
      >
        {submitting ? 'Adding…' : 'Add to allowlist'}
      </button>
    </div>
  )
}
