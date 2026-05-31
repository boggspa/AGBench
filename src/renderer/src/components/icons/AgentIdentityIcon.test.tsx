import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentIdentity } from '../../../../main/store/types'
import { AgentIdentityIcon } from './AgentIdentityIcon'

function identity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    agentId: 'agent-1',
    name: 'Harmonium',
    color: '#2CDD88',
    slug: 'harmonium',
    accent: '#2CDD88',
    source: 'pool',
    assignedAt: '2026-05-31T00:00:00.000Z',
    ...overrides
  }
}

describe('AgentIdentityIcon', () => {
  it('renders generated named SVGs for catalog identities', () => {
    const html = renderToStaticMarkup(
      <AgentIdentityIcon identity={identity()} size={18} title="Harmonium" />
    )

    expect(html).toContain('agent-identity-icon-named')
    expect(html).toContain('data-agent-slug="harmonium"')
    expect(html).toContain('agent-named-identicon-svg')
    expect(html).toContain('viewBox="0 0 600 600"')
    expect(html).toContain('color: #2CDD88')
    expect(html).not.toContain('class="agent-identicon')
  })

  it('falls back to the seeded primitive for platform names outside the catalog', () => {
    const html = renderToStaticMarkup(
      <AgentIdentityIcon
        identity={identity({
          name: 'Platform Helper',
          color: '#FF5F5F',
          slug: undefined,
          accent: undefined,
          source: 'platform'
        })}
        size={18}
      />
    )

    expect(html).toContain('agent-identity-icon-seeded')
    expect(html).toContain('agent-identicon')
    expect(html).not.toContain('agent-identity-icon-named')
  })
})
