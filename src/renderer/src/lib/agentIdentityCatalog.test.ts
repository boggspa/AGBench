import { describe, expect, it } from 'vitest'
import { AGENT_NAME_POOL } from './agentIdentity'
import {
  NAMED_AGENT_IDENTICONS,
  namedAgentIdenticonForName,
  namedAgentIdenticonForSlug
} from './agentIdentityCatalog'

describe('agentIdentityCatalog', () => {
  it('maps every bespoke fallback name to a generated SVG identity', () => {
    expect(NAMED_AGENT_IDENTICONS).toHaveLength(AGENT_NAME_POOL.length)
    expect(NAMED_AGENT_IDENTICONS.map((entry) => entry.name)).toEqual(AGENT_NAME_POOL)
  })

  it('keeps generated slugs and accents unique', () => {
    expect(new Set(NAMED_AGENT_IDENTICONS.map((entry) => entry.slug))).toHaveLength(
      NAMED_AGENT_IDENTICONS.length
    )
    expect(new Set(NAMED_AGENT_IDENTICONS.map((entry) => entry.accent))).toHaveLength(
      NAMED_AGENT_IDENTICONS.length
    )
  })

  it('looks up identities by stable name or slug', () => {
    expect(namedAgentIdenticonForName('Harmonium')).toMatchObject({
      name: 'Harmonium',
      slug: 'harmonium',
      file: 'harmonium.svg',
      accent: '#2CDD88'
    })
    expect(namedAgentIdenticonForSlug('donny-davis')).toMatchObject({
      name: 'Donny-Davis',
      slug: 'donny-davis',
      file: 'donny-davis.svg',
      accent: '#DD3E2C'
    })
  })
})
