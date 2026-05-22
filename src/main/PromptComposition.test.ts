import { describe, expect, it } from 'vitest'
import { buildPendingSubThreadResultContextBlock, composeRunPrompt } from './PromptComposition'
import type { ChatMessage } from './store/types'

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: overrides.id || 'm',
    role: overrides.role || 'user',
    content: overrides.content || '',
    timestamp: overrides.timestamp || '2026-05-22T12:00:00Z',
    ...overrides
  }
}

function subThreadReturn(content = 'Child says tests passed.'): ChatMessage {
  return message({
    id: 'sub-return-1',
    role: 'tool',
    content,
    metadata: {
      kind: 'subThreadReturn',
      subThreadId: 'sub-1',
      subThreadProvider: 'codex',
      subThreadTitle: 'Build check'
    }
  })
}

describe('buildPendingSubThreadResultContextBlock', () => {
  it('surfaces sub-thread returns after the last assistant as untrusted data', () => {
    const block = buildPendingSubThreadResultContextBlock(
      [message({ role: 'assistant', content: 'Delegated.' }), subThreadReturn('All tests passed.')],
      'continue'
    )

    expect(block).toContain('Pending sub-thread result context')
    expect(block).toContain('untrusted child-agent output')
    expect(block).toContain('Result from Codex sub-thread "Build check"')
    expect(block).toContain('<subthread_result id="sub-1">')
    expect(block).toContain('All tests passed.')
  })

  it('does not repeat results already followed by an assistant reply', () => {
    const block = buildPendingSubThreadResultContextBlock(
      [
        subThreadReturn('All tests passed.'),
        message({ role: 'assistant', content: 'I incorporated that result.' })
      ],
      'continue'
    )

    expect(block).toBe('')
  })
})

describe('composeRunPrompt sub-thread returns', () => {
  it('injects pending sub-thread results even when provider session history is authoritative', () => {
    const result = composeRunPrompt({
      provider: 'codex',
      finalPrompt: 'Continue.',
      messages: [message({ role: 'assistant', content: 'Delegated.' }), subThreadReturn()],
      chatContextTurns: 6,
      resumeSessionId: 'codex-session-1',
      codexHandoffsApplied: [],
      isGlobalRun: false,
      approvalMode: 'default',
      providerLabel: 'Codex'
    })

    expect(result.contextualPrompt).toContain('Pending sub-thread result context')
    expect(result.contextualPrompt).toContain('Child says tests passed.')
    expect(result.contextualPrompt).toContain('Current user request:\nContinue.')
  })
})
