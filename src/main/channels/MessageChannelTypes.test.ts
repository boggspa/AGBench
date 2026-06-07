import { describe, expect, it } from 'vitest'
import {
  ACTIVE_MESSAGE_CHANNEL_KINDS,
  MESSAGE_CHANNEL_ADAPTERS,
  MESSAGE_CHANNEL_INTERACTION_PRIMITIVES,
  isActiveMessageChannelKind,
  messageChannelConversationId,
  toCanonicalMessageChannelEvent
} from './MessageChannelTypes'

describe('MessageChannelTypes', () => {
  it('keeps iMessage as the only active adapter while naming planned BYO/self-hosted channels', () => {
    expect(ACTIVE_MESSAGE_CHANNEL_KINDS).toEqual(['imessage'])
    expect(isActiveMessageChannelKind('imessage')).toBe(true)
    expect(isActiveMessageChannelKind('telegram')).toBe(false)
    expect(MESSAGE_CHANNEL_ADAPTERS.find((adapter) => adapter.channel === 'imessage')).toMatchObject(
      {
        label: 'iMessage local experimental',
        status: 'active',
        transport: 'local'
      }
    )
    expect(
      MESSAGE_CHANNEL_ADAPTERS.filter((adapter) => adapter.status === 'planned').map(
        (adapter) => adapter.channel
      )
    ).toEqual(expect.arrayContaining(['telegram', 'matrix', 'signal', 'email', 'web']))
  })

  it('normalizes adapter events into the canonical channel event shape', () => {
    expect(
      messageChannelConversationId({
        channel: 'imessage',
        accountId: ' mac-default ',
        chatGuid: ' iMessage;-;+15555550100 '
      })
    ).toBe('imessage:mac-default:iMessage;-;+15555550100')

    expect(
      toCanonicalMessageChannelEvent(
        {
          channel: 'imessage',
          accountId: 'mac-default',
          chatGuid: 'iMessage;-;+15555550100',
          messageGuid: 'message-1',
          senderHandle: '+15555550100',
          text: 'tw status',
          timestamp: '2026-06-07T12:00:00.000Z',
          attachments: [{ filename: 'screen.png', mimeType: 'image/png' }]
        },
        {
          authState: 'allowlisted_contact',
          routeTarget: 'existing_chat',
          binding: {
            appChatId: 'chat-1',
            workspaceId: 'workspace-1',
            provider: 'codex'
          }
        }
      )
    ).toMatchObject({
      channel: 'imessage',
      conversationId: 'imessage:mac-default:iMessage;-;+15555550100',
      messageId: 'message-1',
      sender: {
        handle: '+15555550100',
        authState: 'allowlisted_contact'
      },
      text: 'tw status',
      attachments: [{ filename: 'screen.png', mimeType: 'image/png' }],
      routeTarget: 'existing_chat',
      appChatId: 'chat-1',
      workspaceId: 'workspace-1',
      provider: 'codex',
      receivedAt: '2026-06-07T12:00:00.000Z',
      isFromMe: false
    })
  })

  it('documents portable interaction primitives separately from adapter support', () => {
    const primitives = new Map(
      MESSAGE_CHANNEL_INTERACTION_PRIMITIVES.map((primitive) => [primitive.name, primitive])
    )

    expect(primitives.get('approve')?.state).toBe('implemented')
    expect(primitives.get('deny')?.state).toBe('implemented')
    expect(primitives.get('status')?.state).toBe('implemented')
    expect(primitives.get('pause')?.state).toBe('implemented')
    expect(primitives.get('show_diff')?.state).toBe('planned')
    expect(primitives.get('open_thread')?.aliases).toContain('open thread')
    expect(primitives.get('handoff_provider')?.aliases).toContain('handoff to codex')
  })
})
