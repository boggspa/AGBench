import { describe, expect, it } from 'vitest'
import {
  OLLAMA_RUN_PROFILE_PRESETS,
  resolveOllamaRunProfile,
  resolveOllamaThinkingLevel
} from './OllamaRunProfiles'

describe('OllamaRunProfiles', () => {
  it('defaults read-only Ollama runs to Local Scout', () => {
    const profile = resolveOllamaRunProfile({}, 'read_only', 'gpt-oss:latest')
    expect(profile.id).toBe('local_scout')
    expect(profile.reasoningLevel).toBe('medium')
    expect(profile.protocolMode).toBe('native_first')
    expect(profile.keepAlive).toBe('10m')
  })

  it('maps approved shell runs to high-thinking verification profile', () => {
    const profile = resolveOllamaRunProfile({}, 'approved_shell', 'gpt-oss:latest')
    expect(profile.id).toBe('verify_with_shell')
    expect(profile.reasoningLevel).toBe('high')
    expect(profile.numPredictFinal).toBeGreaterThan(profile.numPredictTool || 0)
  })

  it('returns GPT-OSS thinking level only for GPT-OSS models', () => {
    expect(
      resolveOllamaThinkingLevel('gpt-oss:latest', OLLAMA_RUN_PROFILE_PRESETS.local_scout)
    ).toBe('medium')
    expect(
      resolveOllamaThinkingLevel('qwen3.5:9b', OLLAMA_RUN_PROFILE_PRESETS.local_scout)
    ).toBeUndefined()
  })
})
