import { describe, expect, it } from 'vitest'
import {
  createProviderAdapterRegistry,
  defaultProviderDescriptor,
  providerAdapterDescriptor,
  providerLabel
} from './ProviderAdapters'
import type { ProviderAdapter } from './ProviderAdapters'

function adapter(provider: 'gemini' | 'codex'): ProviderAdapter {
  return {
    ...defaultProviderDescriptor(provider),
    run: async () => {},
    cancel: async () => true,
    getStatus: async () => ({ provider }),
    getMcpStatus: async () => null,
    getCapabilityContract: async () => ({
      provider,
      label: providerLabel(provider),
      refreshedAt: '2026-05-07T00:00:00.000Z',
      availability: { available: true },
      tools: {} as never,
      approvals: {
        requestedMode: 'default',
        effectiveMode: 'default',
        providerMode: 'default',
        inAppApprovals: false,
        supportsWorkspaceGrants: false,
        notes: []
      },
      mcp: { state: 'unavailable', source: 'unsupported', available: false, tools: [] },
      warnings: []
    })
  }
}

describe('ProviderAdapters', () => {
  it('provides stable labels and descriptors for every provider boundary', () => {
    expect(providerLabel('gemini')).toBe('Gemini')
    expect(defaultProviderDescriptor('codex')).toMatchObject({
      provider: 'codex',
      transport: 'codex-app-server',
      runChannel: 'run-agent',
      features: {
        appManagedApprovals: true,
        hostCommandFallback: true,
        nativeThreadTools: true
      }
    })
    expect(defaultProviderDescriptor('gemini')).toMatchObject({
      provider: 'gemini',
      runChannel: 'run-gemini',
      features: {
        agentBenchMcpBridge: true,
        workspaceGrants: true
      }
    })
  })

  it('enforces one adapter per provider and requires registered providers', () => {
    const registry = createProviderAdapterRegistry([adapter('gemini'), adapter('codex')])

    expect(registry.require('gemini').label).toBe('Gemini')
    expect(
      registry
        .descriptors()
        .map((descriptor) => descriptor.provider)
        .sort()
    ).toEqual(['codex', 'gemini'])
    expect(() => createProviderAdapterRegistry([adapter('gemini'), adapter('gemini')])).toThrow(
      /already registered/
    )
    expect(() => registry.require('claude')).toThrow(/not registered/)
  })

  it('returns serializable descriptors without runtime functions', () => {
    const descriptor = providerAdapterDescriptor(adapter('codex'))

    expect(descriptor).toEqual(defaultProviderDescriptor('codex'))
    expect('run' in descriptor).toBe(false)
    expect('cancel' in descriptor).toBe(false)
  })
})
