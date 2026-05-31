import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AGENT_IDENTICON_VARIANTS } from '../../lib/agentIdenticon'
import { AgentIdenticon } from './AgentIdenticon'

describe('AgentIdenticon', () => {
  it('renders the deterministic seeded glyph with accessibility metadata', () => {
    const html = renderToStaticMarkup(
      <AgentIdenticon seed="agent-alpha" color="#ff5f5f" title="Harmonium" />
    )

    expect(html).toContain('agent-identicon-anchor')
    expect(html).toContain('rotate(90 12 12)')
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Harmonium"')
    expect(html).toContain('<title>Harmonium</title>')
    expect(html).toContain('color:#ff5f5f')
  })

  it('is decorative when no title is supplied', () => {
    const html = renderToStaticMarkup(<AgentIdenticon seed="agent-beta" />)

    expect(html).toContain('agent-identicon-prism')
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('role="img"')
    expect(html).not.toContain('<title>')
  })

  it('can render every explicit static variant without requiring a seed', () => {
    for (const variant of AGENT_IDENTICON_VARIANTS) {
      const html = renderToStaticMarkup(<AgentIdenticon variant={variant} />)

      expect(html).toContain(`agent-identicon-${variant}`)
      expect(html).toContain('rotate(0 12 12)')
    }
  })
})
