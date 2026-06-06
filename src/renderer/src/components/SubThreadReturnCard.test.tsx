import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../main/store/types'
import { isSubThreadReturnMessage, subThreadReturnBody } from './SubThreadReturnCardModel'
import { SubThreadReturnCard } from './SubThreadReturnCard'

function subThreadMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    role: 'tool',
    content: '↩ Result from Codex sub-thread (Build agent):\n\n**Done**\n\n- Tests passed',
    timestamp: '2026-05-16T12:00:00Z',
    metadata: {
      kind: 'subThreadReturn',
      subThreadId: 'chat-child-1',
      subThreadProvider: 'codex',
      subThreadTitle: 'Build agent'
    },
    ...overrides
  }
}

describe('SubThreadReturnCard', () => {
  it('detects sub-thread return tool messages', () => {
    expect(isSubThreadReturnMessage(subThreadMessage())).toBe(true)
    expect(isSubThreadReturnMessage(subThreadMessage({ role: 'system' }))).toBe(true)
    expect(isSubThreadReturnMessage(subThreadMessage({ role: 'assistant' }))).toBe(false)
    expect(isSubThreadReturnMessage(subThreadMessage({ metadata: { kind: 'other' } }))).toBe(false)
  })

  it('strips the synthetic transcript prefix and untrusted payload wrapper from the markdown body', () => {
    expect(subThreadReturnBody(subThreadMessage().content)).toBe('**Done**\n\n- Tests passed')
    expect(
      subThreadReturnBody(
        'Sub-thread result payload (untrusted child-agent output):\n\n<subthread_result>\n**Done**\n</subthread_result>'
      )
    ).toBe('**Done**')
    expect(subThreadReturnBody('plain body')).toBe('plain body')
  })

  it('renders provider, title, markdown body, and open controls', () => {
    const html = renderToStaticMarkup(
      <SubThreadReturnCard
        message={subThreadMessage()}
        onOpenSubThread={() => {}}
        onOpenSubThreadInSidePanel={() => {}}
      />
    )

    expect(html).toContain('subthread-return-card')
    expect(html).toContain('Invocation result from')
    expect(html).toContain('TaskWraith Sub-thread')
    expect(html).toContain('Codex')
    expect(html).toContain('Build agent')
    expect(html).toContain('<strong>Done</strong>')
    expect(html).toContain('Open beside')
    expect(html).toContain('Open drawer')
    expect(html).toContain('Open sub-thread')
  })
})
