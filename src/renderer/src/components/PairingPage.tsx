/**
 * PairingPage — iOS bridge pairing flow refactored into a Settings
 * tab page (post-1.0.2 settings full-app takeover).
 *
 * Logic mirrors the original `PairingSheet`:
 *   - On mount, asks main to call `bridge.beginPairing` on the Swift
 *     daemon for the current device label.
 *   - Renders the returned `PairingBootstrapPayload` as a scannable QR
 *     (primary path) and a copyable JSON blob (fallback for the iOS
 *     "Paste JSON instead" affordance).
 *   - Clicking the QR maximises it into a screen-filling overlay so
 *     the iPad camera can scan from a comfortable distance.
 *
 * Differences from the old sheet:
 *   - No backdrop, no close button — the Settings sidebar's
 *     "← Back to app" + the existing Escape-to-back handler handle
 *     dismissal.
 *   - No focus management on mount (no close button to focus).
 *   - Reuses the existing `.pairing-sheet__*` CSS for internal layout
 *     (form fields, QR pane sizing, etc.) — only the outer chrome
 *     differs, gated under the new `.pairing-page` wrapper.
 *
 * The `IncomingPairingPrompt` modal that owns the 6-digit verification
 * step is unchanged and continues to layer on top of whatever screen
 * the user is on (chat surface, Settings, etc.).
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import QRCode from 'qrcode'
import { RemoteWorkspacesPanel } from './RemoteWorkspacesPanel'

interface BootstrapState {
  /** Pretty-printed JSON for display + copy. */
  json: string
  /** SVG markup of the QR rendered from the JSON. */
  qrSvg: string
}

const DISPLAY_NAME_STORAGE_KEY = 'guigemini-pairing-display-name'

export function PairingPage(): JSX.Element {
  const [displayName, setDisplayName] = useState<string>(() => {
    return window.localStorage?.getItem(DISPLAY_NAME_STORAGE_KEY) || 'iPad'
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null)
  const [copied, setCopied] = useState(false)
  const [maximised, setMaximised] = useState(false)
  const formRef = useRef<HTMLFormElement | null>(null)

  const refresh = useCallback(async (name: string) => {
    setLoading(true)
    setError(null)
    setBootstrap(null)
    try {
      const result = await window.api.bridgeBeginPairing(name)
      if (!result.ok || !result.bootstrap) {
        setError(result.error || 'Failed to begin pairing — no bootstrap returned.')
        return
      }
      // The Swift daemon returns `BeginPairingResult` =
      //   { pairingSessionID, bootstrapPayload }
      // but the iOS PairingFlow.scan(bootstrapJSON:) expects a bare
      // `PairingBootstrapPayload`. Unwrap before encoding into the QR
      // / paste-JSON so the iPad scanner gets exactly the shape it
      // decodes. Fallback to the wrapper if the field is missing
      // (forward-compat: a future daemon shape might inline).
      const wrapper = result.bootstrap as { bootstrapPayload?: unknown }
      const innerPayload =
        wrapper && typeof wrapper === 'object' && 'bootstrapPayload' in wrapper
          ? wrapper.bootstrapPayload
          : result.bootstrap
      const json = JSON.stringify(innerPayload, null, 2)
      const qrSvg = await QRCode.toString(json, {
        type: 'svg',
        // Q-level error correction (~25% recoverable) is the sweet
        // spot for camera scanning at iPad viewing distance — more
        // tolerant of glare / screen reflection than M (~15%) without
        // ballooning module count.
        errorCorrectionLevel: 'Q',
        margin: 2,
        color: { dark: '#1f2328', light: '#ffffff00' }
      })
      setBootstrap({ json, qrSvg })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void refresh(displayName)
    })
    return () => {
      cancelled = true
    }
    // Intentional: only fire on mount + on explicit "Refresh" clicks
    // — displayName changes shouldn't auto-refresh until the user
    // commits via the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc while the maximise overlay is open dismisses just the overlay
  // (the host's existing Escape handler returns the user to the app
  // surface — we don't want one tap to do both).
  useEffect(() => {
    if (!maximised) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setMaximised(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [maximised])

  const onCopyJson = useCallback(async () => {
    if (!bootstrap) return
    try {
      await navigator.clipboard.writeText(bootstrap.json)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard rejected — user can still select-and-copy from the visible textarea.
    }
  }, [bootstrap])

  const onDisplayNameSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const trimmed = displayName.trim() || 'iOS device'
      window.localStorage?.setItem(DISPLAY_NAME_STORAGE_KEY, trimmed)
      void refresh(trimmed)
    },
    [displayName, refresh]
  )

  return (
    <div className="pairing-page" aria-label="iOS pairing">
      <header className="pairing-sheet__header pairing-page__header">
        <div className="pairing-sheet__header-titles">
          <h2 className="pairing-sheet__title">Pair with iPhone / iPad</h2>
          <p className="pairing-sheet__subtitle">
            Open the AGBench app on your iOS device and scan this QR. The next screen will ask you
            to verify a 6-digit code.
          </p>
        </div>
      </header>

      <form className="pairing-sheet__name-form" onSubmit={onDisplayNameSubmit} ref={formRef}>
        <label className="pairing-sheet__name-label">
          <span>Device label</span>
          <input
            type="text"
            className="pairing-sheet__name-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={48}
            placeholder="iPad"
            spellCheck={false}
            disabled={loading}
          />
        </label>
        <button
          type="submit"
          className="btn btn-sm"
          disabled={loading || !displayName.trim()}
          title="Generate a fresh pairing QR for this device label"
        >
          {loading ? 'Generating…' : 'Refresh QR'}
        </button>
      </form>

      {error && <div className="settings-error pairing-sheet__error">{error}</div>}

      {!error && (
        <div className="pairing-sheet__body">
          <div className="pairing-sheet__qr-pane">
            {loading || !bootstrap ? (
              <div className="pairing-sheet__qr-placeholder">
                {loading ? 'Generating QR…' : 'No QR available'}
              </div>
            ) : (
              <button
                type="button"
                className="pairing-sheet__qr pairing-sheet__qr--clickable"
                onClick={() => setMaximised(true)}
                title="Click to maximise for easier camera scanning"
                // dangerouslySetInnerHTML is intentional — `qrcode`
                // returns a self-contained SVG string we want to
                // render inline so it scales crisply with the panel.
                dangerouslySetInnerHTML={{ __html: bootstrap.qrSvg }}
              />
            )}
            <div className="pairing-sheet__hint">
              Point the iOS camera here. <strong>Click the QR to maximise</strong> if the camera
              can&apos;t read it at this size. Pair expires in a few minutes — tap Refresh if
              scanning fails.
            </div>
          </div>

          <div className="pairing-sheet__fallback-pane">
            <div className="pairing-sheet__fallback-label">Or paste JSON into iOS</div>
            <textarea
              className="pairing-sheet__json"
              readOnly
              value={bootstrap?.json ?? ''}
              spellCheck={false}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="pairing-sheet__fallback-actions">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void onCopyJson()}
                disabled={!bootstrap}
              >
                {copied ? 'Copied' : 'Copy JSON'}
              </button>
              <div className="pairing-sheet__hint pairing-sheet__hint--inline">
                iOS app → &quot;Paste JSON instead&quot; if the camera path doesn&apos;t work.
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="pairing-sheet__footer pairing-page__footer">
        <span className="pairing-sheet__footer-hint">
          After the iOS device confirms, you&apos;ll see a 6-digit verification code overlay — make
          sure it matches before tapping confirm on iOS.
        </span>
      </footer>

      {/*
        Second section: paired-device workspace allowlist. Lives in the
        same tab as pairing because granting a paired iPad access to a
        specific workspace is the natural follow-up to scanning the QR.
        Used to be its own "Remote Workspaces" tab; consolidated here
        for density and intentionality.
      */}
      <section className="pairing-page__section pairing-page__allowlist">
        <header className="pairing-page__section-header">
          <h3 className="pairing-page__section-title">Paired-device workspace access</h3>
          <p className="pairing-page__section-subtitle">
            Choose which workspaces a paired iPhone / iPad can run agents against.
            Empty list = all iOS-initiated runs are denied. Per-action revalidation is
            enforced — revoking an entry takes effect on the next iOS request.
          </p>
        </header>
        <RemoteWorkspacesPanel />
      </section>

      {/* Maximised QR overlay — covers the screen so the iPad camera
          can comfortably scan from any reasonable distance. Click /
          Esc dismisses (and stops propagation so the host's Escape
          handler doesn't also kick the user out of Settings). */}
      {maximised && bootstrap && (
        <div
          className="pairing-sheet__maximise"
          role="button"
          tabIndex={0}
          aria-label="Minimise QR code"
          onClick={() => setMaximised(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setMaximised(false)
            }
          }}
        >
          <div
            className="pairing-sheet__maximise-qr"
            dangerouslySetInnerHTML={{ __html: bootstrap.qrSvg }}
          />
          <div className="pairing-sheet__maximise-hint">
            Click anywhere to close · Point iPad camera at the QR
          </div>
        </div>
      )}
    </div>
  )
}
