import { describe, expect, it } from 'vitest'
import { getKnownModelLabels, humaniseModelId } from './modelDisplayName'

// 1.0.5-EW50 — Shared model-id humaniser. Covers the four
// provider families + the fallback contract. Verifies that:
//   - known ids return their canonical display name
//   - unknown ids fall back to the raw id (not a placeholder)
//   - lookup is case-insensitive on the key side
//   - empty / null inputs return empty string
describe('humaniseModelId', () => {
  describe('Gemini', () => {
    it('maps known full ids to "Gemini X Variant" form', () => {
      expect(humaniseModelId('gemini', 'gemini-3-flash-preview')).toBe('Gemini 3 Flash Preview')
      expect(humaniseModelId('gemini', 'gemini-3.1-pro-preview')).toBe('Gemini 3.1 Pro Preview')
      expect(humaniseModelId('gemini', 'gemini-3.1-flash-lite-preview')).toBe(
        'Gemini 3.1 Flash Lite Preview'
      )
      expect(humaniseModelId('gemini', 'gemini-3.1-flash-lite')).toBe('Gemini 3.1 Flash Lite')
    })

    it('maps composer-side short ids to "Gemini X" form', () => {
      expect(humaniseModelId('gemini', 'pro')).toBe('Gemini Pro')
      expect(humaniseModelId('gemini', 'flash')).toBe('Gemini Flash')
      expect(humaniseModelId('gemini', 'flash-lite')).toBe('Gemini Flash Lite')
      expect(humaniseModelId('gemini', 'cli-default')).toBe('CLI Default')
    })
  })

  describe('Claude', () => {
    it('maps full claude ids to "Claude Opus/Sonnet/Haiku N.N" form', () => {
      expect(humaniseModelId('claude', 'claude-opus-4-7')).toBe('Claude Opus 4.7')
      expect(humaniseModelId('claude', 'claude-opus-4-7-1m')).toBe('Claude Opus 4.7 (1M)')
      expect(humaniseModelId('claude', 'claude-sonnet-4-6')).toBe('Claude Sonnet 4.6')
      expect(humaniseModelId('claude', 'claude-haiku-4-5')).toBe('Claude Haiku 4.5')
      expect(humaniseModelId('claude', 'claude-opus-4-6')).toBe('Claude Opus 4.6')
    })

    it('maps composer-side short ids to "Claude X" form', () => {
      expect(humaniseModelId('claude', 'sonnet')).toBe('Claude Sonnet')
      expect(humaniseModelId('claude', 'opus')).toBe('Claude Opus')
      expect(humaniseModelId('claude', 'haiku')).toBe('Claude Haiku')
    })
  })

  describe('Codex (GPT)', () => {
    it('maps gpt ids preserving the "GPT-X.Y" capitalisation', () => {
      expect(humaniseModelId('codex', 'gpt-5.5')).toBe('GPT-5.5')
      expect(humaniseModelId('codex', 'gpt-5.4')).toBe('GPT-5.4')
      expect(humaniseModelId('codex', 'gpt-5.4-mini')).toBe('GPT-5.4 Mini')
      expect(humaniseModelId('codex', 'gpt-5.3-codex')).toBe('GPT-5.3 Codex')
      expect(humaniseModelId('codex', 'gpt-5.3-codex-spark')).toBe('GPT-5.3 Codex Spark')
      expect(humaniseModelId('codex', 'gpt-5.2')).toBe('GPT-5.2')
    })
  })

  describe('Kimi', () => {
    it('maps Kimi ids including the old/new thinking aliases', () => {
      expect(humaniseModelId('kimi', 'kimi-k2.6')).toBe('Kimi K2.6')
      expect(humaniseModelId('kimi', 'kimi-k2.6-thinking')).toBe('Kimi K2.6 Thinking')
      // Pre-renamed alias still maps to the same display
      expect(humaniseModelId('kimi', 'kimi-k2-thinking')).toBe('Kimi K2.6 Thinking')
      expect(humaniseModelId('kimi', 'kimi-k2.5')).toBe('Kimi K2.5')
      expect(humaniseModelId('kimi', 'kimi-k2')).toBe('Kimi K2')
      expect(humaniseModelId('kimi', 'kimi-latest')).toBe('Kimi (Latest)')
    })

    it('maps preview / dated Kimi variants', () => {
      expect(humaniseModelId('kimi', 'kimi-k2-turbo-preview')).toBe('Kimi K2 Turbo Preview')
      expect(humaniseModelId('kimi', 'kimi-k2-0711-preview')).toBe('Kimi K2 (0711 Preview)')
      expect(humaniseModelId('kimi', 'kimi-k2-0905-preview')).toBe('Kimi K2 (0905 Preview)')
    })
  })

  describe('Lookup behaviour', () => {
    it('is case-insensitive on the input id', () => {
      expect(humaniseModelId('gemini', 'GEMINI-3-FLASH-PREVIEW')).toBe('Gemini 3 Flash Preview')
      expect(humaniseModelId('claude', 'Claude-Opus-4-7')).toBe('Claude Opus 4.7')
      expect(humaniseModelId('codex', 'GPT-5.5')).toBe('GPT-5.5')
    })

    it('falls back to the raw id for unknown models (preserves info over placeholder)', () => {
      // Brand-new model the table hasn't been extended for yet —
      // should NOT become "Unknown model" or empty; the raw id
      // stays so power users still see what's there.
      expect(humaniseModelId('gemini', 'gemini-99-experimental-x')).toBe('gemini-99-experimental-x')
      expect(humaniseModelId('codex', 'gpt-x-future')).toBe('gpt-x-future')
    })

    it('returns empty string for empty / null / undefined input', () => {
      expect(humaniseModelId('gemini', '')).toBe('')
      expect(humaniseModelId('gemini', null)).toBe('')
      expect(humaniseModelId('gemini', undefined)).toBe('')
    })

    it('does not require a known provider — provider is documentation-only today', () => {
      // The provider argument is currently unused (mappings key
      // on full id so collisions don't happen in the known set),
      // but should still resolve correctly regardless of what is
      // passed.
      expect(humaniseModelId(undefined, 'gemini-3-flash-preview')).toBe('Gemini 3 Flash Preview')
      // @ts-expect-error — intentional bad provider for runtime guard
      expect(humaniseModelId('not-a-provider', 'gpt-5.5')).toBe('GPT-5.5')
    })
  })

  describe('getKnownModelLabels', () => {
    it('returns a shallow clone so callers cannot mutate the source-of-truth', () => {
      const first = getKnownModelLabels()
      const second = getKnownModelLabels()
      expect(first).not.toBe(second)
      // Mutating the returned clone should not affect a fresh call.
      first['injected-key'] = 'pwned'
      expect(getKnownModelLabels()['injected-key']).toBeUndefined()
    })

    it('contains at least the six pillars we surface across the dashboard + Settings', () => {
      const labels = getKnownModelLabels()
      expect(labels['gemini-3-flash-preview']).toBeDefined()
      expect(labels['claude-opus-4-7']).toBeDefined()
      expect(labels['gpt-5.5']).toBeDefined()
      expect(labels['kimi-k2.6']).toBeDefined()
      expect(labels['kimi-k2.6-thinking']).toBeDefined()
      // CLI Default is a non-canonical Gemini composer id but is
      // surfaced in the comparison list when a user has run with
      // it — must humanise to something readable.
      expect(labels['cli-default']).toBeDefined()
    })
  })
})
