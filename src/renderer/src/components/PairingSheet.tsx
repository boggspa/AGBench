import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import QRCode from 'qrcode'

/**
 * PairingSheet — modal overlay for initiating an iOS bridge pairing.
 *
 * Opened from the sidebar "remote connection" icon. On mount it asks
 * main to call `bridge.beginPairing` on the Swift daemon, gets back a
 * `PairingBootstrapPayload`, renders it as:
 *   - A scannable QR (primary path — iOS camera scanner consumes this).
 *   - A copyable JSON blob (fallback for the iOS "Paste JSON instead"
 *     affordance — useful when camera access is denied or for dev
 *     testing).
 *
 * The sheet only emits the bootstrap. The subsequent steps (iOS sends
 * `PairingResponsePayload` → daemon emits 6-digit verification code →
 * desktop's `IncomingPairingPrompt` modal handles user confirmation)
 * are existing infrastructure that takes over automatically once the
 * iPad scans the QR. This sheet can stay open or be dismissed —
 * IncomingPairingPrompt will layer on top regardless.
 *
 * Out of scope (deliberate, future polish):
 *   - Auto-dismiss when pairing completes — would require subscribing
 *     to `bridge-pairing-response-received` events from main. Manual
 *     dismiss is fine for v1.
 *   - QR auto-refresh on bootstrap expiry — bootstraps live for a few
 *     minutes; a manual "Refresh QR" button covers it.
 *   - Pre-flight Bonjour visibility check — if the daemon's running,
 *     the QR contains the connection info iOS needs.
 */

export interface PairingSheetProps {
  /** Called when the user dismisses the sheet (× button, Esc, or
   * backdrop click). */
  onClose: () => void
}

interface BootstrapState {
  /** Pretty-printed JSON for display + copy. */
  json: string
  /** SVG markup of the QR rendered from the JSON. */
  qrSvg: string
}

const DISPLAY_NAME_STORAGE_KEY = 'guigemini-pairing-display-name'

export function PairingSheet({ onClose }: PairingSheetProps): JSX.Element {
  const [displayName, setDisplayName] = useState<string>(() => {
    return window.localStorage?.getItem(DISPLAY_NAME_STORAGE_KEY) || 'iPad'
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null)
  const [copied, setCopied] = useState(false)
  const [maximised, setMaximised] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

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
    void refresh(displayName)
    // Intentional: only fire on mount + on explicit "Refresh" clicks
    // — displayName changes shouldn't auto-refresh until the user
    // commits via the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc to close — works because we focus the close button on mount.
  // When maximised, Esc exits the maximise overlay first; second Esc closes
  // the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (maximised) {
          setMaximised(false)
          return
        }
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, maximised])

  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

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
    <div
      className="pairing-sheet-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="pairing-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pairing-sheet-title"
      >
        <header className="pairing-sheet__header">
          <div className="pairing-sheet__header-titles">
            <h2 id="pairing-sheet-title" className="pairing-sheet__title">
              Pair with iPhone / iPad
            </h2>
            <p className="pairing-sheet__subtitle">
              Open the GUIGemini app on your iOS device and scan this QR. The next
              screen will ask you to verify a 6-digit code.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="pairing-sheet__close"
            onClick={onClose}
            aria-label="Close pairing sheet"
            title="Close (Esc)"
          >
            ×
          </button>
        </header>

        <form className="pairing-sheet__name-form" onSubmit={onDisplayNameSubmit}>
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
                Point the iOS camera here. <strong>Click the QR to maximise</strong>
                {' '}if the camera can't read it at this size. Pair expires in a
                few minutes — tap Refresh if scanning fails.
              </div>
            </div>

            <div className="pairing-sheet__fallback-pane">
              <div className="pairing-sheet__fallback-label">
                Or paste JSON into iOS
              </div>
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
                  iOS app → "Paste JSON instead" if the camera path doesn't work.
                </div>
              </div>
            </div>
          </div>
        )}

        <footer className="pairing-sheet__footer">
          <span className="pairing-sheet__footer-hint">
            After the iOS device confirms, you'll see a 6-digit verification code
            here — make sure it matches before tapping confirm on iOS.
          </span>
        </footer>
      </div>

      {/* Maximised QR overlay — covers the screen so the iPad camera
          can comfortably scan from any reasonable distance. Click /
          Esc dismisses. */}
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
