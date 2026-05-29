import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GrokTelemetryCard } from './GrokTelemetryCard'

/*
 * GrokTelemetryCard is a probe-driven card (the PTY probe runs in an effect,
 * so it never fires during static render). These SSR tests cover the inert
 * shell: it renders the shared Provider-Telemetry card markup for Grok with
 * the "reading…" placeholder, ready for the effect to fill in on mount.
 */
describe('GrokTelemetryCard', () => {
  it('renders a Grok telemetry card with the shared grid markup', () => {
    const html = renderToStaticMarkup(<GrokTelemetryCard />)
    expect(html).toContain('settings-provider-telemetry-card')
    expect(html).toContain('provider-grok')
    expect(html).toContain('<strong>Grok</strong>')
    expect(html).toContain('Subscription credits')
  })

  it('shows the loading placeholder before the probe resolves', () => {
    const html = renderToStaticMarkup(<GrokTelemetryCard />)
    // No window.api.probeGrokUsage in SSR → the inert shell shows "…".
    expect(html).toContain('settings-provider-balance-empty')
    expect(html).toContain('…')
  })
})
