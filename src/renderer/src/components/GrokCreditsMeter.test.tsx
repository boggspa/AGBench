import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GrokCreditsMeterView } from './GrokCreditsMeter'
import { parseGrokUsage, type GrokUsageSnapshot } from '../../../main/grok/GrokUsage'

function snap(raw: string): GrokUsageSnapshot {
  return parseGrokUsage(raw, '2026-05-28T00:00:00.000Z')
}

function render(props: {
  snapshot: GrokUsageSnapshot | null
  loading?: boolean
  errored?: boolean
  stale?: boolean
}): string {
  return renderToStaticMarkup(
    <GrokCreditsMeterView
      snapshot={props.snapshot}
      loading={props.loading ?? false}
      errored={props.errored ?? false}
      stale={props.stale ?? false}
    />
  )
}

describe('GrokCreditsMeterView', () => {
  it('renders as a Grok credits row (never token/cost) using the shared meter classes', () => {
    const html = render({ snapshot: snap('Credits used: 1.05%') })
    expect(html).toContain('model-usage-item provider-grok')
    expect(html).toContain('Grok')
    expect(html).toContain('Credits')
    expect(html).toContain('Subscription credits')
    expect(html).not.toMatch(/token/i)
    expect(html).not.toMatch(/\$/)
    // No bespoke local refresh button anymore (matches the other meters).
    expect(html).not.toContain('grok-credits-refresh')
    expect(html).not.toContain('Refresh')
  })

  it('renders a decimal percent', () => {
    const html = render({ snapshot: snap('Credits used: 1.05%') })
    expect(html).toContain('1.05%')
  })

  it('renders an exact 0%', () => {
    const html = render({ snapshot: snap('Credits used: 0%') })
    expect(html).toContain('0%')
  })

  it('preserves the raw "<1%" band without inventing a number', () => {
    const html = render({ snapshot: snap('Credits used: <1%') })
    expect(html).toContain('&lt;1%')
    expect(html).not.toContain('>0%<')
    expect(html).not.toContain('>1%<')
  })

  it('shows the reset window verbatim when present', () => {
    const html = render({ snapshot: snap('Credits used: 0%\nResets: May 31, 16:00 PT') })
    expect(html).toContain('resets May 31, 16:00 PT')
  })

  it('omits the reset line entirely when the reset window is missing', () => {
    const html = render({ snapshot: snap('Credits used: 5%') })
    expect(html).not.toContain('resets ')
  })

  it('surfaces the plan label (tier badge) and pay-as-you-go state', () => {
    const html = render({
      snapshot: snap('Free credits with SuperGrok\nCredits used: 2%\nPay as you go: disabled')
    })
    expect(html).toContain('Free credits with SuperGrok')
    expect(html).toContain('Pay as you go: disabled')
  })

  it('renders an unavailable state', () => {
    const html = render({ snapshot: snap('') })
    expect(html).toContain('Usage unavailable')
  })

  it('renders an errored unavailable state distinctly', () => {
    const html = render({ snapshot: null, errored: true })
    expect(html).toContain('Could not read the Grok CLI')
  })

  it('renders a loading state', () => {
    const html = render({ snapshot: null, loading: true })
    expect(html).toContain('Reading subscription credits…')
  })

  it('does not flag a fresh observed snapshot as stale', () => {
    const html = render({ snapshot: snap('Credits used: 0%'), stale: false })
    expect(html).not.toContain('stale')
  })

  it('flags a prior reading shown after a failed refresh as stale', () => {
    const html = render({ snapshot: snap('Credits used: 3%'), stale: true })
    expect(html).toContain('3%')
    expect(html).toContain('stale')
  })
})
