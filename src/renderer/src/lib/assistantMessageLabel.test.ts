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
  it('uses the Qwen brand as the solo Ollama assistant sender label', () => {
    expect(
      formatAssistantMessageLabel(
        assistant({ providerModel: 'qwen3:4b-instruct' }),
        'Ollama',
        'ollama'
      )
    ).toEqual({
      label: 'Qwen',
      provider: 'ollama',
      providerClass: 'qwen',
      modelBadge: 'Qwen 3 (4B Param)'
    })
  })

  it('uses the Qwen brand and Qwen 3.5 badge for the 9B Ollama model', () => {
    expect(
      formatAssistantMessageLabel(
        assistant({ providerModel: 'qwen3.5:9b' }),
        'Ollama',
        'ollama'
      )
    ).toEqual({
      label: 'Qwen',
      provider: 'ollama',
      providerClass: 'qwen',
      modelBadge: 'Qwen 3.5 (9B Param)'
    })
  })

  it('uses the Google brand for Gemma through Ollama', () => {
    expect(
      formatAssistantMessageLabel(
        assistant({ providerModel: 'gemma4:12b' }),
        'Ollama',
        'ollama'
      )
    ).toEqual({
      label: 'Google',
      provider: 'ollama',
      providerClass: 'google',
      modelBadge: 'Gemma 4 (12B Param)'
    })
  })

  it('uses the OpenAI brand for GPT OSS through Ollama', () => {
    expect(
      formatAssistantMessageLabel(
        assistant({ providerModel: 'gpt-oss' }),
        'Ollama',
        'ollama'
      )
    ).toEqual({
      label: 'OpenAI',
      provider: 'ollama',
      providerClass: 'openai',
      modelBadge: 'GPT OSS (20B Param)'
    })
  })

  it('keeps non-Ollama solo chats provider-labelled', () => {
    expect(formatAssistantMessageLabel(assistant(), 'Codex', 'codex')).toEqual({
      label: 'Codex',
      provider: 'codex',
      providerClass: 'codex',
      modelBadge: null
    })
  })
})
