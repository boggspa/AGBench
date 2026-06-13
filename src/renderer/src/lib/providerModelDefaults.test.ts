import { describe, expect, it } from 'vitest'
import { CLAUDE_DEFAULT_MODELS, isClaudeModelId } from './providerModelDefaults'

describe('Claude provider model defaults', () => {
  it('hides temporarily unavailable Fable variants from the renderer fallback picker list', () => {
    const ids = CLAUDE_DEFAULT_MODELS.map((model) => model.id)
    expect(ids).not.toContain('claude-fable-5')
    expect(ids).not.toContain('claude-fable-5-1m')
  })

  it('treats stale Fable selections as invalid so the composer falls back to default', () => {
    expect(isClaudeModelId('fable')).toBe(false)
    expect(isClaudeModelId('claude-fable-5')).toBe(false)
    expect(isClaudeModelId('claude-fable-5-1m')).toBe(false)
    expect(isClaudeModelId('claude-opus-4-8')).toBe(true)
  })
})
