import { describe, expect, it } from 'vitest'

import { visibleRunningChatIds } from './runningChatVisibility'

describe('visibleRunningChatIds', () => {
  it('returns the original list when no approvals are pending', () => {
    const ids = ['chat-1', 'chat-2']
    expect(visibleRunningChatIds(ids, {})).toEqual(['chat-1', 'chat-2'])
  })

  it('hides a Kimi chat that is parked on a pending approval', () => {
    expect(
      visibleRunningChatIds(['chat-1', 'chat-2'], {
        'chat-1': { provider: 'kimi' }
      })
    ).toEqual(['chat-2'])
  })

  it('leaves Codex/Gemini/Claude chats visible while awaiting approval', () => {
    expect(
      visibleRunningChatIds(['gemini-chat', 'codex-chat', 'claude-chat'], {
        'gemini-chat': { provider: 'gemini' },
        'codex-chat': { provider: 'codex' },
        'claude-chat': { provider: 'claude' }
      })
    ).toEqual(['gemini-chat', 'codex-chat', 'claude-chat'])
  })

  it('treats a cleared approval entry as no approval', () => {
    expect(
      visibleRunningChatIds(['chat-1'], { 'chat-1': null })
    ).toEqual(['chat-1'])
  })

  it('accepts a Set as input', () => {
    const set = new Set(['chat-1', 'chat-2'])
    expect(
      visibleRunningChatIds(set, { 'chat-2': { provider: 'kimi' } })
    ).toEqual(['chat-1'])
  })

  it('only filters the chat whose pending approval is Kimi-owned', () => {
    expect(
      visibleRunningChatIds(['chat-1', 'chat-2', 'chat-3'], {
        'chat-1': { provider: 'kimi' },
        'chat-3': { provider: 'codex' }
      })
    ).toEqual(['chat-2', 'chat-3'])
  })
})
