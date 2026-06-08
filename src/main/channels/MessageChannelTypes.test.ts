import { describe, expect, it } from 'vitest'
import {
  ACTIVE_MESSAGE_CHANNEL_KINDS,
  ACTIVE_MESSAGE_CHANNEL_ROUTE_TARGETS,
  MESSAGE_CHANNEL_ADAPTERS,
  MESSAGE_CHANNEL_INTERACTION_PRIMITIVES,
  MESSAGE_CHANNEL_PROVIDER_OPTIONS,
  isActiveMessageChannelKind,
  messageChannelConversationId,
  toCanonicalMessageChannelEvent
} from './MessageChannelTypes'

describe('MessageChannelTypes', () => {
  it('keeps iMessage, Telegram, Matrix, and local web active while naming planned BYO channels', () => {
    expect(ACTIVE_MESSAGE_CHANNEL_KINDS).toEqual(['imessage', 'telegram', 'matrix', 'web'])
    expect(isActiveMessageChannelKind('imessage')).toBe(true)
    expect(isActiveMessageChannelKind('telegram')).toBe(true)
    expect(isActiveMessageChannelKind('matrix')).toBe(true)
    expect(isActiveMessageChannelKind('web')).toBe(true)
    expect(MESSAGE_CHANNEL_ADAPTERS.find((adapter) => adapter.channel === 'imessage')).toMatchObject(
      {
        label: 'iMessage local experimental',
        status: 'active',
        transport: 'local'
      }
    )
    expect(MESSAGE_CHANNEL_ADAPTERS.find((adapter) => adapter.channel === 'telegram')).toMatchObject(
      {
        label: 'Telegram bot',
        status: 'active',
        transport: 'byo_token'
      }
    )
    expect(MESSAGE_CHANNEL_ADAPTERS.find((adapter) => adapter.channel === 'matrix')).toMatchObject(
      {
        label: 'Matrix',
        status: 'active',
        transport: 'self_hosted',
        capabilities: expect.objectContaining({
          outboundText: true,
          outboundFiles: false
        })
      }
    )
    expect(MESSAGE_CHANNEL_ADAPTERS.find((adapter) => adapter.channel === 'web')).toMatchObject({
      label: 'Local web chat',
      status: 'active',
      transport: 'self_hosted',
      capabilities: expect.objectContaining({
        outboundText: true,
        outboundFiles: true,
        richActions: true
      })
    })
    expect(
      MESSAGE_CHANNEL_ADAPTERS.filter((adapter) => adapter.status === 'planned').map(
        (adapter) => adapter.channel
      )
    ).toEqual(expect.arrayContaining(['signal', 'email']))
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

  it('exposes all current TaskWraith providers for channel routing', () => {
    expect(MESSAGE_CHANNEL_PROVIDER_OPTIONS).toEqual([
      'codex',
      'claude',
      'gemini',
      'kimi',
      'grok',
      'cursor',
      'ollama'
    ])
  })

  it('exposes active route targets for channel bindings', () => {
    expect(ACTIVE_MESSAGE_CHANNEL_ROUTE_TARGETS).toEqual([
      'existing_chat',
      'new_provider_thread',
      'workspace_default_agent',
      'ensemble',
      'approval_status',
      'status_endpoint'
    ])
  })

  it('documents portable interaction primitives separately from adapter support', () => {
    const primitives = new Map(
      MESSAGE_CHANNEL_INTERACTION_PRIMITIVES.map((primitive) => [primitive.name, primitive])
    )

    expect(primitives.get('approve')?.state).toBe('implemented')
    expect(primitives.get('deny')?.state).toBe('implemented')
    expect(primitives.get('status')?.state).toBe('implemented')
    expect(primitives.get('pause')?.state).toBe('implemented')
    expect(primitives.get('resume')?.state).toBe('implemented')
    expect(primitives.get('show_diff')?.state).toBe('implemented')
    expect(primitives.get('open_thread')?.state).toBe('implemented')
    expect(primitives.get('send_file')?.state).toBe('implemented')
    expect(primitives.get('handoff_provider')?.state).toBe('implemented')
    expect(primitives.get('open_thread')?.aliases).toContain('open thread')
    expect(primitives.get('handoff_provider')?.aliases).toContain('handoff to codex <prompt>')
    expect(primitives.get('handoff_provider')?.aliases).toContain('handoff to grok <prompt>')
    expect(primitives.get('handoff_provider')?.aliases).toContain('handoff to cursor <prompt>')
    expect(primitives.get('handoff_provider')?.aliases).toContain('handoff to ollama <prompt>')
    expect(primitives.get('handoff_provider')?.aliases).toContain('handoff to local <prompt>')
  })
})
