import { describe, expect, it } from 'vitest'
import {
  agentIdenticonHash,
  agentIdenticonRotationForSeed,
  agentIdenticonVariantForSeed
} from './agentIdenticon'

describe('agentIdenticon', () => {
  it('normalises case and surrounding whitespace before hashing', () => {
    expect(agentIdenticonHash(' HarmoniUM ')).toBe(agentIdenticonHash('harmonium'))
    expect(agentIdenticonVariantForSeed(' HarmoniUM ')).toBe('lattice')
    expect(agentIdenticonRotationForSeed(' HarmoniUM ')).toBe(0)
  })

  it('pins deterministic seed buckets for known agent ids', () => {
    expect(agentIdenticonHash('agent-alpha')).toBe(3777829751)
    expect(agentIdenticonVariantForSeed('agent-alpha')).toBe('anchor')
    expect(agentIdenticonRotationForSeed('agent-alpha')).toBe(90)

    expect(agentIdenticonHash('agent-beta')).toBe(2832522979)
    expect(agentIdenticonVariantForSeed('agent-beta')).toBe('prism')
    expect(agentIdenticonRotationForSeed('agent-beta')).toBe(90)

    expect(agentIdenticonHash('CODEx:run-17')).toBe(2775066682)
    expect(agentIdenticonVariantForSeed('CODEx:run-17')).toBe('switchback')
    expect(agentIdenticonRotationForSeed('CODEx:run-17')).toBe(0)
  })

  it('uses the fallback seed for empty values', () => {
    expect(agentIdenticonHash('')).toBe(1340600742)
    expect(agentIdenticonHash(null)).toBe(1340600742)
    expect(agentIdenticonHash(undefined)).toBe(1340600742)
    expect(agentIdenticonVariantForSeed(undefined)).toBe('bracket')
    expect(agentIdenticonRotationForSeed(undefined)).toBe(0)
  })
})
