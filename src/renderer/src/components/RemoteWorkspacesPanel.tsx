import { useCallback, useEffect, useState } from 'react'

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

const PROVIDER_OPTIONS = ['gemini', 'codex', 'claude', 'kimi'] as const
const APPROVAL_MODE_OPTIONS = ['default', 'plan'] as const

export function RemoteWorkspacesPanel() {
  const [entries, setEntries] = useState<RemoteWorkspaceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      // @ts-expect-error preload-provided API
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
    void refresh()
  }, [refresh])

  return (
    <div className="settings-group">
      <label className="settings-label">iOS Remote Workspace Allowlist</label>
      <div className="settings-hint" style={{ marginBottom: 12 }}>
        Workspaces a paired iOS device may initiate runs against. Empty list = all
        iOS-initiated turns are denied. Per-action revalidation is enforced — removing
        an entry takes effect on the next iOS request.
      </div>

      {error && (
        <div className="settings-error" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}

      <AddEntryForm
        onAdded={async () => {
          await refresh()
        }}
      />

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <div className="settings-hint">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="settings-hint">No workspaces on the allowlist.</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {entries.map((entry) => (
              <EntryRow
                key={entry.workspaceId}
                entry={entry}
                onRemove={async () => {
                  // @ts-expect-error preload-provided API
                  await window.api.bridgeAllowlistRemove(entry.workspaceId)
                  await refresh()
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {entries.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              if (!confirm('Remove all remote workspace allowlist entries?')) return
              // @ts-expect-error preload-provided API
              await window.api.bridgeAllowlistClear()
              await refresh()
            }}
          >
            Clear all entries
          </button>
        </div>
      )}
    </div>
  )
}

function EntryRow({ entry, onRemove }: { entry: RemoteWorkspaceEntry; onRemove: () => void | Promise<void> }) {
  const expiresLabel =
    entry.expiresAt !== undefined ? new Date(entry.expiresAt).toLocaleString() : '—'
  return (
    <li
      style={{
        padding: '8px 12px',
        marginBottom: 6,
        borderRadius: 6,
        background: 'var(--surface-elevated, rgba(255,255,255,0.05))'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {entry.workspaceId}{' '}
            <span style={{ fontWeight: 400, fontSize: '0.85em', opacity: 0.7 }}>
              ({entry.mode})
            </span>
          </div>
          <div style={{ fontSize: '0.85em', opacity: 0.75, marginTop: 2, wordBreak: 'break-all' }}>
            {entry.path}
          </div>
          <div style={{ fontSize: '0.8em', opacity: 0.65, marginTop: 4 }}>
            Providers: {entry.allowedProviders.join(', ') || '(none)'} · Approval modes:{' '}
            {entry.allowedApprovalModes.join(', ') || '(none)'} · Expires: {expiresLabel}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => void onRemove()}
          style={{ marginLeft: 12, flexShrink: 0 }}
        >
          Remove
        </button>
      </div>
    </li>
  )
}

function AddEntryForm({ onAdded }: { onAdded: () => void | Promise<void> }) {
  const [workspaceId, setWorkspaceId] = useState('')
  const [path, setPath] = useState('')
  const [mode, setMode] = useState<'read-only' | 'read-write'>('read-only')
  const [providers, setProviders] = useState<Set<string>>(new Set(['gemini']))
  const [approvalModes, setApprovalModes] = useState<Set<string>>(new Set(['default']))
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const toggle = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setter(next)
  }

  const submit = async () => {
    setFormError(null)
    if (!workspaceId.trim() || !path.trim()) {
      setFormError('workspaceId and path are required')
      return
    }
    setSubmitting(true)
    try {
      // @ts-expect-error preload-provided API
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
    <div
      style={{
        padding: 12,
        borderRadius: 6,
        background: 'var(--surface-elevated, rgba(255,255,255,0.05))',
        marginBottom: 8
      }}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          type="text"
          placeholder="workspaceId (e.g. ws-myproject)"
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          className="settings-input"
          style={{ flex: 1 }}
          disabled={submitting}
        />
        <input
          type="text"
          placeholder="/Users/you/projects/myproject"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="settings-input"
          style={{ flex: 2 }}
          disabled={submitting}
        />
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="radio"
            checked={mode === 'read-only'}
            onChange={() => setMode('read-only')}
            disabled={submitting}
          />
          Read-only
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="radio"
            checked={mode === 'read-write'}
            onChange={() => setMode('read-write')}
            disabled={submitting}
          />
          Read-write
        </label>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: '0.85em', opacity: 0.75, marginBottom: 4 }}>Providers</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {PROVIDER_OPTIONS.map((provider) => (
            <label key={provider} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={providers.has(provider)}
                onChange={() => toggle(providers, provider, setProviders)}
                disabled={submitting}
              />
              {provider}
            </label>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: '0.85em', opacity: 0.75, marginBottom: 4 }}>Approval modes</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {APPROVAL_MODE_OPTIONS.map((approvalMode) => (
            <label key={approvalMode} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={approvalModes.has(approvalMode)}
                onChange={() => toggle(approvalModes, approvalMode, setApprovalModes)}
                disabled={submitting}
              />
              {approvalMode}
            </label>
          ))}
        </div>
      </div>

      {formError && (
        <div className="settings-error" style={{ marginBottom: 8 }}>
          {formError}
        </div>
      )}

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
