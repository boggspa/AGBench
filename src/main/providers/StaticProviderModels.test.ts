import { describe, it, expect } from 'vitest'
import { getStaticProviderModels, normalizeCliProviderModel } from './StaticProviderModels'

describe('normalizeCliProviderModel (claude)', () => {
  it('strips the TaskWraith-internal -1m marker so the CLI gets the base model id', () => {
    // The Claude CLI rejects `--model claude-fable-5-1m` ("model not found");
    // the 1M window is entitlement-based on the base id.
    expect(normalizeCliProviderModel('claude', 'claude-fable-5-1m')).toBe('claude-fable-5')
    expect(normalizeCliProviderModel('claude', 'claude-opus-4-8-1m')).toBe('claude-opus-4-8')
    expect(normalizeCliProviderModel('claude', 'claude-opus-4-7-1m')).toBe('claude-opus-4-7')
  })

  it('passes through base claude ids and bare family aliases unchanged', () => {
    expect(normalizeCliProviderModel('claude', 'claude-fable-5')).toBe('claude-fable-5')
    expect(normalizeCliProviderModel('claude', 'claude-opus-4-8')).toBe('claude-opus-4-8')
    for (const alias of ['default', 'sonnet', 'opus', 'haiku', 'fable']) {
      expect(normalizeCliProviderModel('claude', alias)).toBe(alias)
    }
  })

  it('maps empty / sentinel ids to default', () => {
    expect(normalizeCliProviderModel('claude', '')).toBe('default')
    expect(normalizeCliProviderModel('claude', 'cli-default')).toBe('default')
    expect(normalizeCliProviderModel('claude', 'custom')).toBe('default')
  })
})

interface StaticModelShape {
  id: string
  additionalSpeedTiers?: string[]
  supportedReasoningEfforts?: Array<{ reasoningEffort: string }>
}

describe('getStaticProviderModels (provider-specific catalogs)', () => {
  it('returns distinct model lists for gemini, grok, and cursor', () => {
    const gemini = getStaticProviderModels('gemini').map((m) => m.id)
    const grok = getStaticProviderModels('grok').map((m) => m.id)
    const cursor = getStaticProviderModels('cursor').map((m) => m.id)
    expect(gemini).toContain('flash')
    expect(grok).toEqual(['grok-build'])
    expect(cursor).toEqual(['composer-2.5-fast', 'composer-2.5'])
  })

  it('normalizes invalid cross-provider model ids back to provider defaults', () => {
    expect(normalizeCliProviderModel('grok', 'flash')).toBe('grok-build')
    expect(normalizeCliProviderModel('cursor', 'pro')).toBe('composer-2.5-fast')
    expect(normalizeCliProviderModel('gemini', 'flash')).toBe('flash')
  })
})

describe('getStaticProviderModels (claude)', () => {
  const models = getStaticProviderModels('claude') as StaticModelShape[]
  const byId = new Map(models.map((m) => [m.id, m]))

  it('lists Fable 5 and its 1M variant ahead of the Opus tier', () => {
    const ids = models.map((m) => m.id)
    expect(ids.indexOf('claude-fable-5')).toBeGreaterThan(-1)
    expect(ids.indexOf('claude-fable-5-1m')).toBe(ids.indexOf('claude-fable-5') + 1)
    expect(ids.indexOf('claude-fable-5')).toBeLessThan(ids.indexOf('claude-opus-4-8'))
  })

  it('keeps the paid Fast tier Opus-only — no Fast on Fable or 1M variants', () => {
    expect(byId.get('claude-fable-5')).not.toHaveProperty('additionalSpeedTiers')
    expect(byId.get('claude-fable-5-1m')).not.toHaveProperty('additionalSpeedTiers')
    expect(byId.get('claude-opus-4-8')?.additionalSpeedTiers).toContain('fast')
  })

  it('offers the standard Claude thinking efforts on both Fable entries', () => {
    for (const id of ['claude-fable-5', 'claude-fable-5-1m']) {
      const efforts = byId.get(id)?.supportedReasoningEfforts?.map((e) => e.reasoningEffort)
      expect(efforts).toEqual(['off', 'low', 'medium', 'high'])
    }
  })
})
