import { describe, expect, it } from 'vitest'
import {
  nextProviderInChain,
  resolveProviderCapabilities,
  type ProviderSignal
} from './ProviderCapabilityResolver'
import type { AuditOrchestrationSettings, ProviderId } from '../store/types'

function sig(provider: ProviderId, over: Partial<ProviderSignal> = {}): ProviderSignal {
  return { provider, configured: true, authenticated: true, healthy: true, ...over }
}

const ALL_ROLES = ['recon', 'reviewer', 'skeptic', 'synthesis'] as const

describe('resolveProviderCapabilities — eligibility layers', () => {
  it('reports the earliest failing layer per provider', () => {
    const { degradations } = resolveProviderCapabilities({
      rolesNeeded: ['reviewer'],
      signals: [
        sig('gemini', { configured: false }),
        sig('codex', { authenticated: false }),
        sig('claude', { healthy: false }),
        sig('kimi', { usageBand: 'critical' })
      ]
    })
    const byProvider = Object.fromEntries(degradations.map((d) => [d.provider, d.reason]))
    expect(byProvider).toEqual({
      gemini: 'unconfigured',
      codex: 'unauthenticated',
      claude: 'unhealthy',
      kimi: 'rate_limited'
    })
  })

  it('excludes providers outside the allowlist', () => {
    const policy: AuditOrchestrationSettings = { providerAllowlist: ['claude', 'codex'] }
    const { perRole, degradations } = resolveProviderCapabilities({
      rolesNeeded: ['reviewer'],
      signals: [sig('claude'), sig('codex'), sig('gemini')],
      policy
    })
    expect(perRole.reviewer).toEqual(['claude', 'codex'])
    expect(degradations).toContainEqual({ provider: 'gemini', reason: 'policy_excluded' })
  })

  it('treats an empty allowlist as no provider restriction', () => {
    const policy: AuditOrchestrationSettings = { providerAllowlist: [] }
    const { perRole, degradations } = resolveProviderCapabilities({
      rolesNeeded: ['reviewer'],
      signals: [sig('claude'), sig('kimi')],
      policy
    })
    expect(perRole.reviewer).toEqual(['claude', 'kimi'])
    expect(degradations).toEqual([])
  })

  it('high usage band is eligible but deprioritized below low', () => {
    const { perRole } = resolveProviderCapabilities({
      rolesNeeded: ['reviewer'],
      signals: [sig('grok', { usageBand: 'high' }), sig('claude', { usageBand: 'low' })]
    })
    expect(perRole.reviewer).toEqual(['claude', 'grok'])
  })
})

describe('resolveProviderCapabilities — Ollama gating + role restriction', () => {
  it('excludes Ollama when not opted in', () => {
    const { perRole, degradations } = resolveProviderCapabilities({
      rolesNeeded: ['reviewer'],
      signals: [sig('claude'), sig('ollama')]
    })
    expect(perRole.reviewer).toEqual(['claude'])
    expect(degradations).toContainEqual({ provider: 'ollama', reason: 'ollama_disabled' })
  })

  it('allows Ollama for reviewer/skeptic but never recon/synthesis when opted in', () => {
    const policy: AuditOrchestrationSettings = { ollamaEnabled: true }
    const { perRole, degradations } = resolveProviderCapabilities({
      rolesNeeded: [...ALL_ROLES],
      signals: [sig('claude'), sig('ollama')],
      policy
    })
    expect(perRole.reviewer).toContain('ollama')
    expect(perRole.skeptic).toContain('ollama')
    expect(perRole.recon).not.toContain('ollama')
    expect(perRole.synthesis).not.toContain('ollama')
    // Opted-in + eligible → no degradation entry for ollama.
    expect(degradations.find((d) => d.provider === 'ollama')).toBeUndefined()
  })

  it('orders cloud before local within a role', () => {
    const policy: AuditOrchestrationSettings = { ollamaEnabled: true }
    const { perRole } = resolveProviderCapabilities({
      rolesNeeded: ['skeptic'],
      signals: [sig('ollama'), sig('claude')],
      policy
    })
    expect(perRole.skeptic).toEqual(['claude', 'ollama'])
  })
})

describe('resolveProviderCapabilities — preferences + fallback chains', () => {
  it('honors per-role preference order, then appends remaining eligible', () => {
    const policy: AuditOrchestrationSettings = {
      perRolePreferences: { skeptic: ['grok', 'kimi'] }
    }
    const { perRole } = resolveProviderCapabilities({
      rolesNeeded: ['skeptic'],
      signals: [sig('claude'), sig('kimi'), sig('grok')],
      policy
    })
    expect(perRole.skeptic).toEqual(['grok', 'kimi', 'claude'])
  })

  it('skips a preferred-but-ineligible provider', () => {
    const policy: AuditOrchestrationSettings = {
      perRolePreferences: { reviewer: ['kimi', 'claude'] }
    }
    const { perRole } = resolveProviderCapabilities({
      rolesNeeded: ['reviewer'],
      signals: [sig('kimi', { authenticated: false }), sig('claude')],
      policy
    })
    expect(perRole.reviewer).toEqual(['claude'])
  })

  it('degrades honestly to a single provider', () => {
    const { perRole } = resolveProviderCapabilities({
      rolesNeeded: [...ALL_ROLES],
      signals: [sig('claude'), sig('codex', { healthy: false })]
    })
    expect(perRole.reviewer).toEqual(['claude'])
    expect(perRole.synthesis).toEqual(['claude'])
  })

  it('returns an empty chain (never throws) when nothing is eligible', () => {
    const { perRole } = resolveProviderCapabilities({
      rolesNeeded: ['reviewer'],
      signals: [sig('claude', { healthy: false })]
    })
    expect(perRole.reviewer).toEqual([])
  })
})

describe('nextProviderInChain', () => {
  it('returns the first untried link, then null when exhausted', () => {
    const chain: ProviderId[] = ['grok', 'kimi', 'claude']
    expect(nextProviderInChain(chain, [])).toBe('grok')
    expect(nextProviderInChain(chain, ['grok'])).toBe('kimi')
    expect(nextProviderInChain(chain, ['grok', 'kimi', 'claude'])).toBeNull()
    expect(nextProviderInChain(undefined, [])).toBeNull()
  })
})
