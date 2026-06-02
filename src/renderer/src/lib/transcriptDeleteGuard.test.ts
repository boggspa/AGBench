import { describe, expect, it } from 'vitest'
import { messageAnchorsActivePrompt } from './transcriptDeleteGuard'

describe('messageAnchorsActivePrompt', () => {
  it('flags the anchor of a pending agent question', () => {
    expect(messageAnchorsActivePrompt('agent-question-42', 'agent-question-42', null)).toBe(true)
  })

  it('flags the anchor of a pending plan choice', () => {
    expect(messageAnchorsActivePrompt('m7', null, 'm7')).toBe(true)
  })

  it('does not flag an unrelated message while prompts are pending elsewhere', () => {
    expect(messageAnchorsActivePrompt('m1', 'agent-question-42', 'm7')).toBe(false)
  })

  it('does not flag when nothing is pending', () => {
    expect(messageAnchorsActivePrompt('m1', null, undefined)).toBe(false)
  })

  it('ignores an empty messageId (never blocks on a missing id)', () => {
    expect(messageAnchorsActivePrompt('', '', '')).toBe(false)
  })
})
