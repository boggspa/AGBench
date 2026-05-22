import { describe, expect, it } from 'vitest'

import {
  hasConversationContent,
  shouldRenderWelcome,
  type WelcomeChatLike,
  type WelcomeMessageLike
} from './welcomeState'

const chat: WelcomeChatLike = { appChatId: 'chat-1' }

describe('hasConversationContent', () => {
  it('returns false for an empty message list', () => {
    expect(hasConversationContent([])).toBe(false)
  })

  it('returns true when an assistant message exists', () => {
    expect(hasConversationContent([{ role: 'assistant' }])).toBe(true)
  })

  it('returns true when a user message exists', () => {
    expect(hasConversationContent([{ role: 'user' }])).toBe(true)
  })

  it('returns true when a tool message exists', () => {
    expect(hasConversationContent([{ role: 'tool' }])).toBe(true)
  })

  it('returns true when an error message exists', () => {
    expect(hasConversationContent([{ role: 'error' }])).toBe(true)
  })

  it('returns false for system-only messages', () => {
    expect(hasConversationContent([{ role: 'system' }, { role: 'system' }])).toBe(false)
  })

  it('detects content in the last position of a long list', () => {
    const messages: WelcomeMessageLike[] = [
      { role: 'system' },
      { role: 'system' },
      { role: 'system' },
      { role: 'assistant' }
    ]
    expect(hasConversationContent(messages)).toBe(true)
  })
})

describe('shouldRenderWelcome', () => {
  it('returns false when no chat is selected', () => {
    expect(
      shouldRenderWelcome({
        currentChat: null,
        messages: [],
        isCurrentChatRunning: false,
        showFallbackUX: false
      })
    ).toBe(false)
  })

  it('returns true when the chat exists, has no conversation content, and is idle', () => {
    expect(
      shouldRenderWelcome({
        currentChat: chat,
        messages: [],
        isCurrentChatRunning: false,
        showFallbackUX: false
      })
    ).toBe(true)
  })

  it('treats a chat with only a system message as a welcome candidate', () => {
    expect(
      shouldRenderWelcome({
        currentChat: chat,
        messages: [{ role: 'system' }],
        isCurrentChatRunning: false,
        showFallbackUX: false
      })
    ).toBe(true)
  })

  it('hides the welcome surface when the chat has assistant content', () => {
    expect(
      shouldRenderWelcome({
        currentChat: chat,
        messages: [{ role: 'assistant' }],
        isCurrentChatRunning: false,
        showFallbackUX: false
      })
    ).toBe(false)
  })

  it('hides the welcome surface when the chat has only a tool activity row', () => {
    // Tool-only chats (e.g. a Kimi chat whose first turn was a shell
    // command before any assistant prose streamed in) must not render
    // welcome over the running transcript.
    expect(
      shouldRenderWelcome({
        currentChat: chat,
        messages: [{ role: 'tool' }],
        isCurrentChatRunning: false,
        showFallbackUX: false
      })
    ).toBe(false)
  })

  it('hides the welcome surface when the chat is currently running', () => {
    expect(
      shouldRenderWelcome({
        currentChat: chat,
        messages: [],
        isCurrentChatRunning: true,
        showFallbackUX: false
      })
    ).toBe(false)
  })

  it('hides the welcome surface when the fallback retry card is showing', () => {
    expect(
      shouldRenderWelcome({
        currentChat: chat,
        messages: [],
        isCurrentChatRunning: false,
        showFallbackUX: true
      })
    ).toBe(false)
  })

  it('still hides welcome when the chat has both content and is running', () => {
    expect(
      shouldRenderWelcome({
        currentChat: chat,
        messages: [{ role: 'user' }],
        isCurrentChatRunning: true,
        showFallbackUX: false
      })
    ).toBe(false)
  })
})
