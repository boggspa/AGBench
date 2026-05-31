import { describe, expect, it } from 'vitest'
import type { ProviderId } from './store/types'
import { shouldRetainReasoning, stripReasoningChains } from './EnsembleThinkingEphemerality'

describe('shouldRetainReasoning', () => {
  it('retains for Codex (durable streamed reasoning)', () => {
    expect(shouldRetainReasoning('codex')).toBe(true)
  })

  it('drops for the ephemeral providers', () => {
    for (const p of ['claude', 'gemini', 'kimi', 'grok', 'cursor'] as ProviderId[]) {
      expect(shouldRetainReasoning(p)).toBe(false)
    }
  })

  it('drops for undefined provider (safe default)', () => {
    expect(shouldRetainReasoning(undefined)).toBe(false)
  })
})

describe('stripReasoningChains', () => {
  const withThink = 'Before.\n<think>secret chain of thought</think>\nAfter.'

  it('removes <think> blocks for ephemeral providers', () => {
    const out = stripReasoningChains(withThink, 'claude')
    expect(out).not.toContain('secret chain of thought')
    expect(out).toContain('Before.')
    expect(out).toContain('After.')
  })

  it('removes <thinking> and <reasoning> variants too', () => {
    expect(stripReasoningChains('a<thinking>x</thinking>b', 'gemini')).toBe('ab')
    expect(stripReasoningChains('a<reasoning>x</reasoning>b', 'kimi')).toBe('ab')
  })

  it('is case-insensitive', () => {
    expect(stripReasoningChains('a<THINK>x</THINK>b', 'grok')).toBe('ab')
  })

  it('removes multiple blocks in one message', () => {
    const out = stripReasoningChains('<think>one</think>keep<think>two</think>', 'cursor')
    expect(out).toBe('keep')
  })

  it('RETAINS reasoning for Codex (durable)', () => {
    const out = stripReasoningChains(withThink, 'codex')
    expect(out).toBe(withThink)
    expect(out).toContain('secret chain of thought')
  })

  it('leaves ordinary prose containing the word "thinking" untouched', () => {
    const prose = 'I was thinking about the architecture and decided to refactor.'
    expect(stripReasoningChains(prose, 'claude')).toBe(prose)
  })

  it('returns content unchanged (same reference) when there is nothing to strip', () => {
    const clean = 'Just a normal answer.'
    expect(stripReasoningChains(clean, 'claude')).toBe(clean)
  })

  it('returns content unchanged for empty / non-string input', () => {
    expect(stripReasoningChains('', 'claude')).toBe('')
    // @ts-expect-error — exercising the runtime guard
    expect(stripReasoningChains(null, 'claude')).toBe(null)
  })

  it('collapses the blank gap a removed block leaves behind', () => {
    const out = stripReasoningChains('Line one.\n\n<think>x</think>\n\nLine two.', 'claude')
    expect(out).toBe('Line one.\n\nLine two.')
  })

  it('is repeatable — the stateful global regex does not desync across calls', () => {
    // Two calls in a row must give the same answer (guards against a leaked
    // lastIndex on the module-level /g regex).
    const a = stripReasoningChains(withThink, 'claude')
    const b = stripReasoningChains(withThink, 'claude')
    expect(a).toBe(b)
    // A retain call between two strip calls must not perturb either.
    stripReasoningChains(withThink, 'codex')
    expect(stripReasoningChains(withThink, 'claude')).toBe(a)
  })
})
