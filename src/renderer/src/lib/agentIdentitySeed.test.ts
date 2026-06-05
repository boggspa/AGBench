import { describe, expect, it } from 'vitest'
import { NAMED_AGENT_IDENTICONS, namedAgentIdenticonForName } from './agentIdentityCatalog'
import {
  assignAgentIdentity,
  assignAgentIdentityFromSeed,
  isValidAgentIdentityKey
} from './agentIdentitySeed'

describe('assignAgentIdentity (seed -> named character)', () => {
  it('is deterministic: the same seed always yields the same identity', () => {
    const seeds = ['agent-alpha', 'CODEx:run-17', 'subthread-7f3a', 'task-1', '']
    for (const seed of seeds) {
      const first = assignAgentIdentity(seed)
      // Re-run several times; nothing about the function may drift.
      for (let i = 0; i < 5; i += 1) {
        expect(assignAgentIdentity(seed)).toEqual(first)
      }
    }
  })

  it('exposes a stateless alias that matches the primary export', () => {
    expect(assignAgentIdentityFromSeed('agent-alpha')).toEqual(assignAgentIdentity('agent-alpha'))
  })

  it('pins exact catalog mappings for known seeds (guards the hash + catalog)', () => {
    expect(assignAgentIdentity('agent-alpha')).toEqual({
      key: 'Brian Brian Brian',
      name: 'Brian Brian Brian',
      slug: 'brian-brian-brian',
      accent: '#9FDD2C'
    })
    expect(assignAgentIdentity('CODEx:run-17')).toEqual({
      key: 'Master Maxwell',
      name: 'Master Maxwell',
      slug: 'master-maxwell',
      accent: '#4DDD2C'
    })
    expect(assignAgentIdentity('subthread-7f3a')).toEqual({
      key: 'Deimos',
      name: 'Deimos',
      slug: 'deimos',
      accent: '#8A2CDD'
    })
  })

  it('normalises case and surrounding whitespace before bucketing', () => {
    expect(assignAgentIdentity(' HarmoniUM ')).toEqual(assignAgentIdentity('harmonium'))
  })

  it('returns key === name and a key that is always a valid AgentIdentityIcon input', () => {
    const probeSeeds = [
      'agent-alpha',
      'agent-beta',
      'CODEx:run-17',
      'subthread-7f3a',
      'task-1',
      'Harmonium',
      'a',
      'a-very-long-stable-seed-from-some-provider-internal-agent-0xdeadbeef'
    ]
    for (const seed of probeSeeds) {
      const identity = assignAgentIdentity(seed)
      // key is exactly the display name...
      expect(identity.key).toBe(identity.name)
      // ...and resolves to a real catalog character (what AgentIdentityIcon needs).
      expect(isValidAgentIdentityKey(identity.key)).toBe(true)
      const resolved = namedAgentIdenticonForName(identity.key)
      expect(resolved).toBeDefined()
      // slug + accent come straight from that same catalog entry (no drift).
      expect(identity.slug).toBe(resolved?.slug)
      expect(identity.accent).toBe(resolved?.accent)
    }
  })

  it('spreads varied seeds across the whole catalog', () => {
    const buckets = new Set<string>()
    for (let i = 0; i < 500; i += 1) {
      buckets.add(assignAgentIdentity(`seed-${i}`).slug)
    }
    // Every catalog character should be reachable; assert full coverage so a
    // future hash/catalog change that collapses the distribution is caught.
    expect(buckets.size).toBe(NAMED_AGENT_IDENTICONS.length)
    // Sanity: every emitted slug is a real catalog slug.
    const catalogSlugs = new Set(NAMED_AGENT_IDENTICONS.map((entry) => entry.slug))
    for (const slug of buckets) {
      expect(catalogSlugs.has(slug)).toBe(true)
    }
  })

  it('handles empty / null / undefined seeds with one stable fallback identity', () => {
    const fromEmpty = assignAgentIdentity('')
    expect(assignAgentIdentity(null)).toEqual(fromEmpty)
    expect(assignAgentIdentity(undefined)).toEqual(fromEmpty)
    expect(assignAgentIdentity('   ')).toEqual(fromEmpty)
    // The fallback is still a real, renderable catalog character.
    expect(isValidAgentIdentityKey(fromEmpty.key)).toBe(true)
    expect(fromEmpty).toEqual({
      key: 'Malek Malloc',
      name: 'Malek Malloc',
      slug: 'malek-malloc',
      accent: '#902CDD'
    })
  })
})
