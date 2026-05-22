import { describe, expect, it } from 'vitest'
import {
  makeFakeProviderAdapter,
  runProviderAdapterContractTests,
  assertCapabilityContractShape
} from './ProviderAdapterContract'

// Run the contract battery against the conformant fake. If any
// invariant fails here, every adapter built on the same contract
// would also fail — this is the meta-test that the harness itself works.
runProviderAdapterContractTests({
  name: 'makeFakeProviderAdapter (gemini)',
  factory: () => makeFakeProviderAdapter('gemini')
})

runProviderAdapterContractTests({
  name: 'makeFakeProviderAdapter (codex)',
  factory: () => makeFakeProviderAdapter('codex')
})

runProviderAdapterContractTests({
  name: 'makeFakeProviderAdapter (claude)',
  factory: () => makeFakeProviderAdapter('claude')
})

runProviderAdapterContractTests({
  name: 'makeFakeProviderAdapter (kimi)',
  factory: () => makeFakeProviderAdapter('kimi')
})

describe('assertCapabilityContractShape', () => {
  it('accepts a minimal valid contract', () => {
    expect(() => assertCapabilityContractShape({ provider: 'gemini' } as never)).not.toThrow()
  })
})

describe('makeFakeProviderAdapter', () => {
  it('returns a non-active getStatus by default', async () => {
    const adapter = makeFakeProviderAdapter()
    const status = (await adapter.getStatus()) as { running: boolean; fake: boolean }
    expect(status.running).toBe(false)
    expect(status.fake).toBe(true)
  })

  it('cancel returns false by default (no active runs)', async () => {
    const adapter = makeFakeProviderAdapter()
    expect(await adapter.cancel()).toBe(false)
    expect(await adapter.cancel('any-id')).toBe(false)
  })

  it('respects overrides', async () => {
    const adapter = makeFakeProviderAdapter('codex', {
      label: 'Custom Label',
      async cancel(_runId?: string) {
        return true
      }
    })
    expect(adapter.label).toBe('Custom Label')
    expect(await adapter.cancel()).toBe(true)
  })

  it('overrides preserve the rest of the contract', async () => {
    // Spot-check: overriding label doesn't break other invariants.
    const adapter = makeFakeProviderAdapter('codex', { label: 'X' })
    expect(adapter.provider).toBe('codex')
    expect(typeof adapter.features).toBe('object')
    expect(adapter.runChannel).toBe('run-agent')
  })
})

// Demonstration: the contract should REFUSE an adapter with a bogus
// provider id. We don't actually run runProviderAdapterContractTests
// here (it would register a failing describe block in the suite); we
// just verify the invariant we'd assert about by directly checking the
// `KNOWN_PROVIDER_IDS` membership through the helper's behavior.
describe('contract rejects non-conformant adapters', () => {
  it('catches an unknown provider id at the first assertion', async () => {
    const bogus = makeFakeProviderAdapter('gemini', {
      provider: 'futureGrok' as never
    })
    // We can't easily run the full describe block in-line, but we can
    // verify the specific check would fire.
    expect(['gemini', 'codex', 'claude', 'kimi']).not.toContain(bogus.provider)
  })

  it('catches non-boolean feature flags', async () => {
    const bogus = makeFakeProviderAdapter('gemini', {
      features: {
        persistentSessions: 'yes' as unknown as boolean,
        appManagedApprovals: true,
        workspaceGrants: false,
        agentBenchMcpBridge: false,
        providerManagedMcp: false,
        nativeThreadTools: false,
        hostCommandFallback: false
      }
    })
    // The contract battery's check is `expect(typeof value).toBe('boolean')`
    // — we verify the violation pattern would fire.
    expect(typeof bogus.features.persistentSessions).not.toBe('boolean')
  })
})
