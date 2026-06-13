import { describe, expect, it } from 'vitest'
import {
  CLAUDE_DEFAULT_MODELS,
  OLLAMA_DEFAULT_MODELS,
  isClaudeModelId
} from './providerModelDefaults'

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

describe('Ollama provider model defaults', () => {
  it('includes the optional curated local model tags without changing the default', () => {
    expect(OLLAMA_DEFAULT_MODELS[0].id).toBe('qwen3:4b-instruct')
    expect(OLLAMA_DEFAULT_MODELS.map((model) => model.id)).toEqual([
      'qwen3:4b-instruct',
      'qwen3.5:9b',
      'qwen3.6:35b',
      'gemma4:12b',
      'gpt-oss:20b',
      'minicpm-v4.5:8b',
      'granite4.1:3b',
      'granite4.1:30b',
      'nemotron3:33b',
      'custom'
    ])
  })
})
