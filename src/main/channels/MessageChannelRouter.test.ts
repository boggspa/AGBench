import { describe, expect, it } from 'vitest'
import { MessageChannelRouter } from './MessageChannelRouter'
import type { MessageChannelBinding } from './MessageChannelTypes'

function binding(overrides: Partial<MessageChannelBinding> = {}): MessageChannelBinding {
  return {
    id: 'binding-1',
    channel: 'imessage',
    accountId: 'mac-default',
    chatGuid: 'chat-guid',
    allowedHandles: ['user@example.com'],
    appChatId: 'chat-1',
    workspaceId: 'workspace-1',
    provider: 'codex',
    mode: 'operator',
    requireTrigger: true,
    triggerPrefix: 'tw',
    createdAt: '2026-06-06T10:00:00.000Z',
    updatedAt: '2026-06-06T10:00:00.000Z',
    ...overrides
  }
}

function envelope(overrides = {}) {
  return {
    channel: 'imessage' as const,
    accountId: 'mac-default',
    chatGuid: 'chat-guid',
    messageGuid: 'message-1',
    senderHandle: 'user@example.com',
    text: 'tw run the tests',
    timestamp: '2026-06-06T10:01:00.000Z',
    ...overrides
  }
}

function routerWith(bindings: MessageChannelBinding[]) {
  return new MessageChannelRouter({
    bindingStore: {
      findByConversation: () => bindings
    }
  })
}

describe('MessageChannelRouter', () => {
  it('routes trigger-prefixed inbound messages to a TaskWraith turn', () => {
    const router = routerWith([binding()])
    const decision = router.routeInbound(envelope({ text: 'tw: summarize status' }))

    expect(decision.accepted).toBe(true)
    if (decision.accepted) {
      expect(decision.turn.appChatId).toBe('chat-1')
      expect(decision.turn.provider).toBe('codex')
      expect(decision.turn.routeTarget).toBe('existing_chat')
      expect(decision.turn.prompt).toBe('summarize status')
      expect(decision.turn.metadata).toMatchObject({
        kind: 'channelInbound',
        channel: 'imessage',
        bindingId: 'binding-1',
        chatGuid: 'chat-guid',
        messageGuid: 'message-1',
        senderHandle: 'user@example.com',
        routeTarget: 'existing_chat',
        attachmentCount: 0
      })
    }
  })

  it('carries endpoint route targets on accepted turns', () => {
    const router = routerWith([binding({ routeTarget: 'approval_status' })])
    const decision = router.routeInbound(envelope({ text: 'tw approve approval-1' }))

    expect(decision.accepted).toBe(true)
    if (decision.accepted) {
      expect(decision.turn.routeTarget).toBe('approval_status')
      expect(decision.turn.metadata.routeTarget).toBe('approval_status')
    }
  })

  it('carries attachment metadata and image paths on accepted turns', () => {
    const router = routerWith([binding()])
    const decision = router.routeInbound(
      envelope({
        attachments: [
          {
            id: 'attachment-1',
            filename: 'photo.jpg',
            path: '/Users/me/Library/Messages/Attachments/photo.jpg',
            mimeType: 'image/jpeg',
            byteCount: 1234
          },
          {
            id: 'attachment-2',
            filename: 'notes.pdf',
            path: '/Users/me/Library/Messages/Attachments/notes.pdf',
            mimeType: 'application/pdf'
          }
        ]
      })
    )

    expect(decision.accepted).toBe(true)
    if (decision.accepted) {
      expect(decision.turn.metadata).toMatchObject({
        attachmentCount: 2,
        attachments: [
          {
            id: 'attachment-1',
            filename: 'photo.jpg',
            path: '/Users/me/Library/Messages/Attachments/photo.jpg',
            mimeType: 'image/jpeg',
            byteCount: 1234
          },
          {
            id: 'attachment-2',
            filename: 'notes.pdf',
            path: '/Users/me/Library/Messages/Attachments/notes.pdf',
            mimeType: 'application/pdf'
          }
        ],
        imagePaths: ['/Users/me/Library/Messages/Attachments/photo.jpg']
      })
    }
  })

  it('ignores Messages.app self echoes', () => {
    const router = routerWith([binding()])
    expect(router.routeInbound(envelope({ isFromMe: true, text: 'TaskWraith reply' }))).toEqual(
      {
        accepted: false,
        reason: 'from-self',
        binding: binding()
      }
    )
  })

  it('accepts trigger-prefixed self-synced operator messages', () => {
    const router = routerWith([binding()])
    const decision = router.routeInbound(
      envelope({
        isFromMe: true,
        senderHandle: '',
        text: 'tw status'
      })
    )

    expect(decision.accepted).toBe(true)
    if (decision.accepted) {
      expect(decision.turn.prompt).toBe('status')
    }
  })

  it('requires an exact allowed sender', () => {
    const router = routerWith([binding()])
    expect(router.routeInbound(envelope({ senderHandle: 'other@example.com' }))).toMatchObject({
      accepted: false,
      reason: 'sender-not-allowed'
    })

    const wildcardRouter = routerWith([binding({ allowedHandles: ['*'] })])
    expect(wildcardRouter.routeInbound(envelope({ senderHandle: 'other@example.com' }))).toEqual({
      accepted: false,
      reason: 'sender-not-allowed',
      binding: binding({ allowedHandles: ['*'] })
    })
  })

  it('prefers an active allowed binding over an older archived binding', () => {
    const router = routerWith([
      binding({ id: 'archived-binding', archived: true }),
      binding({ id: 'active-binding', appChatId: 'active-chat' })
    ])
    const decision = router.routeInbound(envelope())

    expect(decision.accepted).toBe(true)
    if (decision.accepted) {
      expect(decision.turn.binding.id).toBe('active-binding')
      expect(decision.turn.appChatId).toBe('active-chat')
    }
  })

  it('rejects non-operator bindings for the iMessage MVP', () => {
    const router = routerWith([binding({ mode: 'group' })])
    expect(router.routeInbound(envelope())).toMatchObject({
      accepted: false,
      reason: 'unsupported-mode'
    })
  })

  it('requires the trigger prefix by default', () => {
    const router = routerWith([binding()])
    expect(router.routeInbound(envelope({ text: 'run the tests' }))).toMatchObject({
      accepted: false,
      reason: 'trigger-required'
    })
  })

  it('still requires the trigger prefix if a stale binding disables the flag', () => {
    const router = routerWith([binding({ requireTrigger: false })])
    expect(router.routeInbound(envelope({ text: 'run the tests' }))).toMatchObject({
      accepted: false,
      reason: 'trigger-required'
    })
  })

  it('rejects empty trigger-only prompts', () => {
    const router = routerWith([binding()])
    expect(router.routeInbound(envelope({ text: 'tw' }))).toMatchObject({
      accepted: false,
      reason: 'empty-prompt'
    })
  })

  it('deduplicates accepted message guids', () => {
    const router = routerWith([binding()])
    expect(router.routeInbound(envelope()).accepted).toBe(true)
    expect(router.routeInbound(envelope())).toEqual({
      accepted: false,
      reason: 'duplicate-message'
    })
  })
})
