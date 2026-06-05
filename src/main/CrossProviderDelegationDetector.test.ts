import { describe, expect, it } from 'vitest'
import {
  crossProviderDelegationWarningMessage,
  detectCrossProviderDelegationMisuse
} from './CrossProviderDelegationDetector'

describe('detectCrossProviderDelegationMisuse', () => {
  it('returns no warning when the user prompt does not mention another provider', () => {
    const result = detectCrossProviderDelegationMisuse({
      userPrompt: 'Refactor src/app.ts and add tests',
      toolName: 'invoke_agent'
    })
    expect(result.shouldWarn).toBe(false)
  })

  it('returns no warning when stdout has no internal-agent surface', () => {
    const result = detectCrossProviderDelegationMisuse({
      userPrompt: 'Ask Kimi to write the song table',
      stdoutChunk: '{"type":"tool_use","tool_name":"read_file"}'
    })
    expect(result.shouldWarn).toBe(false)
  })

  it('flags an invoke_agent tool_name with a Kimi-targeting prompt', () => {
    const result = detectCrossProviderDelegationMisuse({
      userPrompt: 'Please delegate to Kimi for the 9 song data tables',
      toolName: 'invoke_agent'
    })
    expect(result.shouldWarn).toBe(true)
    expect(result.reason).toMatch(/invoke_agent/i)
  })

  it('flags invoke_agent embedded in a JSON tool_call payload', () => {
    const stdoutChunk = JSON.stringify({
      type: 'tool_use',
      tool_name: 'invoke_agent',
      parameters: { agent_name: 'Beauvoir' }
    })
    const result = detectCrossProviderDelegationMisuse({
      userPrompt: 'Hand this off to a Codex sub-agent for the audit',
      stdoutChunk
    })
    expect(result.shouldWarn).toBe(true)
  })

  it('flags free-text "spawned agent" output paired with cross-provider intent', () => {
    const result = detectCrossProviderDelegationMisuse({
      userPrompt: 'Sub-thread the migration work over to claude',
      stdoutChunk: '... Spawned agents Beauvoir, Hilbert ...'
    })
    expect(result.shouldWarn).toBe(true)
  })

  it('treats keyword matching case-insensitively', () => {
    const result = detectCrossProviderDelegationMisuse({
      userPrompt: 'CAN YOU ASK KIMI TO HELP?',
      toolName: 'INVOKE_AGENT'
    })
    expect(result.shouldWarn).toBe(true)
  })

  it('exposes a canonical warning message containing the redirect hint', () => {
    const text = crossProviderDelegationWarningMessage()
    expect(text).toContain('TaskWraith__delegate_to_subthread')
    expect(text).toContain('Gemini')
  })
})
