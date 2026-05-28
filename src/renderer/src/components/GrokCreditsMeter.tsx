/*
 * GrokCreditsMeter — Grok SUBSCRIPTION-CREDIT usage (1.0.6-GU).
 *
 * This is deliberately NOT a token/cost meter. SuperGrok / grok.com CLI
 * auth bills against a subscription credit pool (a percent + reset
 * window), and there is no noninteractive command to read it — the only
 * safe source is the interactive `/usage` → "Show Usage" screen, captured
 * via PTY in the main process (no prompt is ever sent → no model call /
 * credit consumption). The probe is expensive (spawns + scrapes a TUI),
 * so this meter is MANUAL-REFRESH: it probes once on mount and again only
 * when the user presses Refresh.
 *
 * Monochrome by design — grok's accent (`--provider-grok-color`) aliases
 * to the active theme's primary text colour, so the bar reads black on
 * light themes and white on dark themes.
 *
 * Structure mirrors GrokUsage.ts itself: a PURE presentational view
 * (`GrokCreditsMeterView`, SSR-testable across every display state) wrapped
 * by an impure shell (`GrokCreditsMeter`) that owns the probe + state. The
 * parent only mounts the shell when the gated Grok provider is available,
 * so neither carries a gate of its own.
 *
 * "Stale" here means we're showing the last KNOWN-GOOD snapshot because the
 * most recent refresh either threw or came back unavailable — a transient
 * failure never blanks a previously-captured reading.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GrokUsageSnapshot } from '../../../main/grok/GrokUsage'
import { ProviderLogoTile } from './ProviderLogoTile'
import { QuotaProgressBar } from './QuotaProgressBar'
import './GrokCreditsMeter.css'

export interface GrokCreditsMeterViewProps {
  /** The snapshot to display (may be a prior known-good one when stale). */
  snapshot: GrokUsageSnapshot | null
  loading: boolean
  errored: boolean
  /** True when `snapshot` is a prior reading shown after a failed refresh. */
  stale: boolean
  onRefresh: () => void
}

/** Pure presentational meter — no IPC, no state, no clock. */
export function GrokCreditsMeterView({
  snapshot,
  loading,
  errored,
  stale,
  onRefresh
}: GrokCreditsMeterViewProps): React.ReactElement {
  const observed = snapshot?.confidence === 'observed'
  const percent = snapshot?.creditsUsedPercent ?? null
  // For a "<1%" band (display present, percent null) we keep the bar near
  // empty and let the raw display carry the meaning — never invent a number.
  const fraction =
    percent != null && Number.isFinite(percent) ? Math.max(0, Math.min(1, percent / 100)) : 0
  const display = snapshot?.creditsUsedDisplay || '0%'

  return (
    <div className={`grok-credits-meter${observed && stale ? ' is-stale' : ''}`}>
      <div className="grok-credits-header">
        <span className="grok-credits-provider">
          <ProviderLogoTile provider="grok" size={20} />
          <span className="grok-credits-provider-name">Grok</span>
          {snapshot?.planLabel ? (
            <span className="grok-credits-plan">{snapshot.planLabel}</span>
          ) : null}
        </span>
        <button
          type="button"
          className="grok-credits-refresh"
          onClick={onRefresh}
          disabled={loading}
          title="Re-read Grok subscription credits from the CLI"
        >
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      <div className="grok-credits-label">Subscription credits</div>

      {observed ? (
        <>
          <div className="grok-credits-row">
            <span className="grok-credits-used">{display}</span>
            <span className="grok-credits-used-suffix">used</span>
            {snapshot?.resetAtText ? (
              <span className="grok-credits-reset">resets {snapshot.resetAtText}</span>
            ) : null}
          </div>
          <QuotaProgressBar fraction={fraction} accent="var(--provider-grok-color)" emphasised />
          <div className="grok-credits-meta">
            {snapshot?.payAsYouGoEnabled != null ? (
              <span>Pay as you go: {snapshot.payAsYouGoEnabled ? 'enabled' : 'disabled'}</span>
            ) : (
              <span />
            )}
            {stale ? <span className="grok-credits-stamp">Stale · last refresh failed</span> : null}
          </div>
        </>
      ) : (
        <div className="grok-credits-unavailable">
          {loading ? (
            <span className="grok-credits-unavailable-title">Reading Grok usage…</span>
          ) : (
            <>
              <span className="grok-credits-unavailable-title">Usage unavailable</span>
              <span className="grok-credits-hint">
                {errored
                  ? 'Could not read the Grok CLI. Refresh to retry.'
                  : 'Run /usage in the Grok CLI to view subscription credits, or Refresh to retry.'}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Stateful shell: owns the manual-refresh PTY probe + render state. */
export function GrokCreditsMeter(): React.ReactElement {
  // `result` is the latest probe outcome; `lastObserved` is the last
  // known-good reading we fall back to (so a transient failure never blanks
  // an existing meter). `loading` starts true because we always probe on mount.
  const [result, setResult] = useState<GrokUsageSnapshot | null>(null)
  const [lastObserved, setLastObserved] = useState<GrokUsageSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const mountedRef = useRef(true)

  // The async-only probe core: sets state exclusively from promise callbacks,
  // so it is safe to call directly from the mount effect (no synchronous
  // setState in the effect body → no cascading-render warning).
  const runProbe = useCallback(() => {
    const api = typeof window !== 'undefined' ? window.api : undefined
    if (typeof api?.probeGrokUsage !== 'function') {
      void Promise.resolve().then(() => {
        if (!mountedRef.current) return
        setErrored(true)
        setLoading(false)
      })
      return
    }
    api
      .probeGrokUsage()
      .then((snap) => {
        if (!mountedRef.current) return
        setResult(snap)
        if (snap.confidence === 'observed') setLastObserved(snap)
      })
      .catch(() => {
        if (mountedRef.current) setErrored(true)
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
  }, [])

  // Manual refresh (event handler — synchronous setState is fine here).
  const refresh = useCallback(() => {
    setLoading(true)
    setErrored(false)
    runProbe()
  }, [runProbe])

  useEffect(() => {
    mountedRef.current = true
    runProbe()
    return () => {
      mountedRef.current = false
    }
  }, [runProbe])

  const resultObserved = result?.confidence === 'observed'
  // Prefer a fresh observed result; otherwise fall back to the last good one.
  const display = resultObserved ? result : (lastObserved ?? result)
  const displayObserved = display?.confidence === 'observed'
  // Stale when we're showing a prior good reading because the latest refresh
  // failed (threw → errored) or came back unavailable (!resultObserved).
  const stale = displayObserved && (errored || !resultObserved)

  return (
    <GrokCreditsMeterView
      snapshot={display}
      loading={loading}
      errored={errored}
      stale={stale}
      onRefresh={refresh}
    />
  )
}
