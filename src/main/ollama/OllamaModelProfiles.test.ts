import { describe, expect, it } from 'vitest'
import {
  ollamaLocalToolSystemPrompt,
  ollamaModelFamilyPromptLines,
  ollamaScoutDelegateWorkflowHint,
  ollamaStruggleHandoffMessage
} from './OllamaModelProfiles'

describe('ollamaModelFamilyPromptLines', () => {
  it('adds Qwen-specific search-first guidance', () => {
    const lines = ollamaModelFamilyPromptLines('qwen3.5:9b')
    expect(lines.join(' ')).toContain('workspace_search')
    expect(lines.join(' ')).toContain('multi-file')
  })

  it('adds GPT-OSS tool-call emphasis', () => {
    const lines = ollamaModelFamilyPromptLines('gpt-oss:latest')
    expect(lines.join(' ')).toContain('tool-intent stub')
    expect(lines.join(' ')).toContain('escape backslashes')
  })
})

describe('ollamaLocalToolSystemPrompt', () => {
  it('includes family profile lines when a model id is provided', () => {
    const prompt = ollamaLocalToolSystemPrompt('read_only', 'qwen3.5:9b')
    expect(prompt).toContain('Model profile (Qwen 3.5 9B)')
    expect(prompt).toContain('workspace_search')
  })
})

describe('workflow hints', () => {
  it('documents scout-then-delegate workflow', () => {
    expect(ollamaScoutDelegateWorkflowHint('qwen3.5:9b')).toContain('delegate implementation')
  })

  it('suggests cloud handoff after struggle', () => {
    expect(ollamaStruggleHandoffMessage('Qwen 3.5 (9B Param)')).toContain('Codex or Claude')
  })
})
