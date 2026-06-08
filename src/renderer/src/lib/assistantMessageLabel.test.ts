import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../main/store/types'
import { formatAssistantMessageLabel } from './assistantMessageLabel'

const assistant = (metadata?: ChatMessage['metadata']): ChatMessage => ({
  id: 'm1',
  role: 'assistant',
  content: 'Hello',
  timestamp: '2026-06-08T10:00:00.000Z',
  ...(metadata ? { metadata } : {})
})

describe('formatAssistantMessageLabel', () => {
  it('uses the Ollama model name as the solo assistant sender label', () => {
    expect(
      formatAssistantMessageLabel(
        assistant({ providerModel: 'qwen3:4b-instruct' }),
        'Ollama',
        'ollama'
      )
    ).toEqual({
      label: 'Qwen 3 (4B Param)',
      provider: 'ollama',
      modelBadge: null
    })
  })

  it('keeps non-Ollama solo chats provider-labelled', () => {
    expect(formatAssistantMessageLabel(assistant(), 'Codex', 'codex')).toEqual({
      label: 'Codex',
      provider: 'codex',
      modelBadge: null
    })
  })
})
