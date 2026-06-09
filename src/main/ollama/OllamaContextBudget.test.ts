import { describe, expect, it } from 'vitest'
import { resolveOllamaContextBudget } from './OllamaContextBudget'

describe('resolveOllamaContextBudget', () => {
  it('uses tighter caps for Qwen 4B than GPT-OSS', () => {
    const qwen = resolveOllamaContextBudget('qwen3:4b-instruct')
    const oss = resolveOllamaContextBudget('gpt-oss:20b')
    expect(qwen.maxBlockChars).toBeLessThan(oss.maxBlockChars)
    expect(qwen.maxTurns).toBeLessThanOrEqual(oss.maxTurns)
  })
})
