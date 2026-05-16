import React, { useCallback, useEffect, useState } from 'react'

/**
 * BridgeNetworkingPanel — Phase E3 Settings → "Bridge Networking" pane.
 *
 * Shows LAN + Tailscale status for the iPhone bridge so the user can
 * see at a glance:
 *   - Whether the bridge daemon is enabled (LAN visibility).
 *   - Whether Tailscale is installed/logged-in/connected.
 *   - The IP a paired iPhone uses to reach the desktop from off-LAN.
 *
 * The detection result is cached by main for ~5s so toggling the
 * panel doesn't hammer `tailscale status --json`.
 *
 * Scope note: this panel currently reports detection only. The
 * actual daemon-side bind-on-tailnet-IP is a separate Swift slice
 * (planned follow-up) — the iOS app would still need to learn the
 * tailnet IP via pairing handshake. For now the user surfaces the
 * IP here so they can verify off-LAN reachability manually.
 */

interface BridgeNetworkingStatus {
  lan: {
    enabled: boolean
    bonjourServiceType: string
    hostname: string
  }
  tailscale: {
    available: boolean
    cliPath?: string
    version?: string
    tailnetIPv4?: string
    tailnetIPv6?: string
    hostname?: string
    tailnetName?: string
    magicDNSEnabled?: boolean
    reason?: string
  }
}

export function BridgeNetworkingPanel(): React.JSX.Element {
  const [status, setStatus] = useState<BridgeNetworkingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const result = (await window.api.bridgeNetworkingStatus()) as BridgeNetworkingStatus
      setStatus(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(() => refresh())
  }, [refresh])

  return (
    <div className="bridge-networking-panel">
      <div className="bridge-networking-header">
        <label className="settings-label">Bridge networking</label>
        <div className="settings-hint">
          How a paired iPhone reaches this desktop. LAN works when both devices are on the same
          Wi-Fi; Tailscale works from anywhere.
        </div>
      </div>

      {error && <div className="settings-error">{error}</div>}

      <section className="bridge-networking-section">
        <header className="bridge-networking-section-header">
          <span className="bridge-networking-section-title">LAN</span>
          <StatusPill
            kind={status?.lan.enabled ? 'ok' : 'idle'}
            label={status?.lan.enabled ? 'Daemon enabled' : 'Daemon disabled'}
          />
        </header>
        {status?.lan && (
          <dl className="bridge-networking-fields">
            <Field label="Bonjour service" value={status.lan.bonjourServiceType} />
            <Field label="Hostname" value={status.lan.hostname} />
          </dl>
        )}
        {!status?.lan.enabled && (
          <div className="settings-hint">
            Set <code>AGBENCH_BRIDGE_DAEMON=1</code> to enable the bridge daemon. Without it, no
            iPhone can pair regardless of network.
          </div>
        )}
      </section>

      <section className="bridge-networking-section">
        <header className="bridge-networking-section-header">
          <span className="bridge-networking-section-title">Tailscale</span>
          <StatusPill
            kind={status?.tailscale.available ? 'ok' : status?.tailscale.cliPath ? 'warn' : 'idle'}
            label={
              status?.tailscale.available
                ? 'Connected'
                : status?.tailscale.cliPath
                  ? 'Installed, not ready'
                  : 'Not installed'
            }
          />
        </header>
        {status?.tailscale.available ? (
          <dl className="bridge-networking-fields">
            {status.tailscale.tailnetIPv4 && (
              <Field label="Tailnet IPv4" value={status.tailscale.tailnetIPv4} copyable />
            )}
            {status.tailscale.tailnetIPv6 && (
              <Field label="Tailnet IPv6" value={status.tailscale.tailnetIPv6} copyable />
            )}
            {status.tailscale.hostname && (
              <Field label="Tailscale hostname" value={status.tailscale.hostname} />
            )}
            {status.tailscale.tailnetName && (
              <Field label="Tailnet" value={status.tailscale.tailnetName} />
            )}
            {status.tailscale.magicDNSEnabled !== undefined && (
              <Field
                label="Magic DNS"
                value={status.tailscale.magicDNSEnabled ? 'enabled' : 'disabled'}
              />
            )}
            {status.tailscale.version && (
              <Field label="CLI version" value={status.tailscale.version} />
            )}
          </dl>
        ) : (
          <>
            {status?.tailscale.reason && (
              <div className="settings-hint bridge-networking-reason">
                {status.tailscale.reason}
              </div>
            )}
            {!status?.tailscale.cliPath && (
              <div className="settings-hint">
                <a
                  href="https://tailscale.com/download"
                  target="_blank"
                  rel="noreferrer"
                  className="bridge-networking-install-link"
                >
                  Install Tailscale
                </a>{' '}
                to enable off-LAN bridge access. Tailscale gives this Mac a stable IP your iPhone
                can reach from any network.
              </div>
            )}
          </>
        )}
      </section>

      <div className="bridge-networking-actions">
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}

function StatusPill({
  kind,
  label
}: {
  kind: 'ok' | 'warn' | 'idle'
  label: string
}): React.JSX.Element {
  return <span className={`bridge-networking-pill bridge-networking-pill-${kind}`}>{label}</span>
}

function Field({
  label,
  value,
  copyable = false
}: {
  label: string
  value: string
  copyable?: boolean
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard rejected — silently fall through; user can still
      // select-and-copy the displayed text.
    }
  }
  return (
    <div className="bridge-networking-field">
      <dt className="bridge-networking-field-label">{label}</dt>
      <dd className="bridge-networking-field-value">
        <span>{value}</span>
        {copyable && (
          <button type="button" className="bridge-networking-copy-btn" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </dd>
    </div>
  )
}
