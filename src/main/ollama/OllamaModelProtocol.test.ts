import { describe, expect, it } from 'vitest'
import {
  ollamaGptOssFewShotTrajectories,
  ollamaOneToolAtATime,
  ollamaUsesCompactToolSchemas
} from './OllamaModelProtocol'

describe('OllamaModelProtocol', () => {
  it('enables GPT-OSS-specific protocol hardening', () => {
    expect(ollamaUsesCompactToolSchemas('gpt-oss:20b')).toBe(true)
    expect(ollamaOneToolAtATime('qwen3.5:9b')).toBe(false)
    expect(ollamaGptOssFewShotTrajectories()).toHaveLength(3)
  })
})
