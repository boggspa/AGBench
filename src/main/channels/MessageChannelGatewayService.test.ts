import { describe, expect, it, vi } from 'vitest'
import type { ChatRecord } from '../store/types'
import {
  MessageChannelGatewayService,
  parseMessageChannelCommand
} from './MessageChannelGatewayService'
import type { MessageChannelBinding } from './MessageChannelTypes'

function binding(): MessageChannelBinding {
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
    updatedAt: '2026-06-06T10:00:00.000Z'
  }
}

function chat(overrides: Partial<ChatRecord> = {}): ChatRecord {
  return {
    appChatId: 'chat-1',
    scope: 'workspace',
    chatKind: 'single',
    provider: 'codex',
    title: 'iMessage Operator',
    workspaceId: 'workspace-1',
    workspacePath: '/repo',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    messages: [],
    runs: [],
    settingsSnapshot: {
      model: 'default',
      approvalMode: 'default',
      sandboxEnabled: true
    },
    ...overrides
  }
}

describe('MessageChannelGatewayService', () => {
  it('recognizes portable channel commands before provider dispatch', () => {
    expect(parseMessageChannelCommand('channel status')).toEqual({ name: 'status' })
    expect(parseMessageChannelCommand('pause')).toEqual({ name: 'pause' })
    expect(parseMessageChannelCommand('approve approval-1')).toEqual({
      name: 'approval',
      action: 'accept',
      approvalId: 'approval-1'
    })
    expect(parseMessageChannelCommand('deny approval-1')).toEqual({
      name: 'approval',
      action: 'decline',
      approvalId: 'approval-1'
    })
    expect(parseMessageChannelCommand('show diff')).toEqual({
      name: 'planned',
      label: 'Show diff'
    })
    expect(parseMessageChannelCommand('handoff to codex')).toEqual({
      name: 'planned',
      label: 'Provider handoff'
    })
  })

  it('does not poll the Messages database when no active bindings exist', async () => {
    const pollMessages = vi.fn()
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [],
        list: () => []
      },
      pollMessages,
      getChat: () => null,
      saveChat: vi.fn(),
      dispatchRun: vi.fn()
    })

    const summary = await service.pollOnce()

    expect(summary).toEqual({
      polled: 0,
      accepted: 0,
      dispatched: 0,
      commands: 0,
      rejected: {}
    })
    expect(pollMessages).not.toHaveBeenCalled()
  })

  it('polls Messages, appends an inbound user message, and dispatches a provider run', async () => {
    const saved: ChatRecord[] = []
    const dispatchRun = vi.fn(async () => ({ dispatched: true, appRunId: 'run-1' }))
    const delivery = {
      registerRunTarget: vi.fn()
    }
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [binding()],
        list: () => [binding()]
      },
      pollMessages: async () => ({
        ok: true,
        accountId: 'mac-default',
        databasePath: '/Users/me/Library/Messages/chat.db',
        messages: [
          {
            channel: 'imessage' as const,
            accountId: 'mac-default',
            chatGuid: 'chat-guid',
            messageGuid: 'message-guid-1',
            senderHandle: 'user@example.com',
            text: 'tw run unit tests',
            timestamp: '2026-06-06T10:01:00.000Z',
            isFromMe: false,
            rowId: 42,
            attachments: []
          }
        ]
      }),
      getChat: () => chat(),
      saveChat: (updated) => saved.push(updated),
      dispatchRun,
      delivery
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({ polled: 1, accepted: 1, dispatched: 1, lastRowId: 42 })
    expect(saved).toHaveLength(2)
    expect(saved.at(-1)?.messages[0]).toMatchObject({
      role: 'user',
      content: 'run unit tests',
      metadata: {
        kind: 'channelInbound',
        channel: 'imessage',
        bindingId: 'binding-1',
        messageGuid: 'message-guid-1',
        channelDispatchStatus: 'dispatched',
        appRunId: 'run-1',
        sourceTrust: 'external_untrusted'
      }
    })
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'codex',
        scope: 'workspace',
        workspace: '/repo',
        prompt: expect.stringContaining('External iMessage channel input.'),
        appChatId: 'chat-1',
        providerSessionId: undefined,
        approvalMode: 'default'
      })
    )
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('User message:\nrun unit tests')
      })
    )
    expect(delivery.registerRunTarget).toHaveBeenCalledWith({
      appRunId: 'run-1',
      channel: 'imessage',
      bindingId: 'binding-1',
      accountId: 'mac-default',
      chatGuid: 'chat-guid',
      appChatId: 'chat-1',
      recipientHandle: 'user@example.com'
    })
  })

  it('handles self-synced operator status commands from the same Apple ID', async () => {
    const dispatchRun = vi.fn(async () => ({ dispatched: true, appRunId: 'run-should-not-start' }))
    const pollMessages = vi.fn(async () => ({
      ok: true,
      accountId: 'mac-default',
      databasePath: '/Users/me/Library/Messages/chat.db',
      messages: [
        {
          channel: 'imessage' as const,
          accountId: 'mac-default',
          chatGuid: 'chat-guid',
          messageGuid: 'message-self-status',
          senderHandle: '',
          text: 'tw status',
          timestamp: '2026-06-06T10:01:00.000Z',
          isFromMe: true,
          rowId: 43,
          attachments: []
        }
      ]
    }))
    const delivery = {
      registerRunTarget: vi.fn(),
      sendDirectReply: vi.fn(async () => ({
        attempted: true,
        sent: true
      }))
    }
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [binding()],
        list: () => [binding()]
      },
      pollMessages,
      getChat: () => chat(),
      saveChat: vi.fn(),
      dispatchRun,
      delivery
    })

    const summary = await service.pollOnce()

    expect(pollMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'mac-default',
        chatGuid: 'chat-guid',
        includeFromMe: true
      })
    )
    expect(summary).toMatchObject({ polled: 1, accepted: 1, commands: 1, dispatched: 0 })
    expect(dispatchRun).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: 'binding-1',
        recipientHandle: 'user@example.com',
        text: expect.stringContaining('TaskWraith channel gateway is online.'),
        command: 'status'
      })
    )
  })

  it('suppresses self-synced TaskWraith outbound echoes even when they start with the trigger', async () => {
    const dispatchRun = vi.fn(async () => ({ dispatched: true, appRunId: 'run-echo' }))
    const auditRecords: Array<{
      kind: string
      bindingId?: string
      accountId?: string
      chatGuid?: string
      payload?: Record<string, unknown>
    }> = [
      {
        kind: 'outbound_sent',
        bindingId: 'binding-1',
        accountId: 'mac-default',
        chatGuid: 'chat-guid',
        payload: {
          textPreview: 'tw status'
        }
      }
    ]
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [binding()],
        list: () => [binding()]
      },
      pollMessages: async () => ({
        ok: true,
        accountId: 'mac-default',
        databasePath: '/Users/me/Library/Messages/chat.db',
        messages: [
          {
            channel: 'imessage' as const,
            accountId: 'mac-default',
            chatGuid: 'chat-guid',
            messageGuid: 'message-self-echo',
            senderHandle: '',
            text: 'tw status',
            timestamp: '2026-06-06T10:02:00.000Z',
            isFromMe: true,
            rowId: 44,
            attachments: []
          }
        ]
      }),
      getChat: () => chat(),
      saveChat: vi.fn(),
      dispatchRun,
      auditStore: {
        append: vi.fn((record) => {
          auditRecords.push(record)
          return record as never
        }),
        list: vi.fn(() => auditRecords as never)
      }
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({
      polled: 1,
      accepted: 0,
      dispatched: 0,
      rejected: { 'outbound-echo': 1 }
    })
    expect(dispatchRun).not.toHaveBeenCalled()
    expect(auditRecords).toContainEqual(
      expect.objectContaining({
        kind: 'inbound_rejected',
        messageGuid: 'message-self-echo',
        payload: expect.objectContaining({
          reason: 'outbound-echo'
        })
      })
    )
  })

  it('forwards inbound image attachments as provider image paths', async () => {
    const saved: ChatRecord[] = []
    const auditRecords: Array<{
      kind: string
      payload?: Record<string, unknown>
    }> = []
    const dispatchRun = vi.fn(async () => ({ dispatched: true, appRunId: 'run-image' }))
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [binding()],
        list: () => [binding()]
      },
      pollMessages: async () => ({
        ok: true,
        accountId: 'mac-default',
        databasePath: '/Users/me/Library/Messages/chat.db',
        messages: [
          {
            channel: 'imessage' as const,
            accountId: 'mac-default',
            chatGuid: 'chat-guid',
            messageGuid: 'message-guid-image',
            senderHandle: 'user@example.com',
            text: 'tw describe this screenshot',
            timestamp: '2026-06-06T10:01:00.000Z',
            isFromMe: false,
            rowId: 77,
            attachments: [
              {
                id: 'attachment-image',
                filename: 'screen.png',
                path: '/Users/me/Library/Messages/Attachments/screen.png',
                mimeType: 'image/png'
              },
              {
                id: 'attachment-file',
                filename: 'log.txt',
                path: '/Users/me/Library/Messages/Attachments/log.txt',
                mimeType: 'text/plain'
              }
            ]
          }
        ]
      }),
      getChat: () => chat(),
      saveChat: (updated) => saved.push(updated),
      dispatchRun,
      auditStore: {
        append: vi.fn((record) => {
          auditRecords.push(record)
          return record as never
        })
      }
    })

    await service.pollOnce()

    expect(saved[0].messages[0].metadata).toMatchObject({
      attachmentCount: 2,
      imagePaths: ['/Users/me/Library/Messages/Attachments/screen.png']
    })
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('User message:\ndescribe this screenshot'),
        imagePaths: ['/Users/me/Library/Messages/Attachments/screen.png']
      })
    )
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Attachment inventory (2):')
      })
    )
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('screen.png; image/png; image forwarded to provider')
      })
    )
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('log.txt; text/plain; content not forwarded automatically')
      })
    )
    expect(auditRecords).toContainEqual(
      expect.objectContaining({
        kind: 'inbound_received',
        bindingId: 'binding-1',
        messageGuid: 'message-guid-image',
        senderHandle: 'user@example.com',
        payload: expect.objectContaining({
          attachmentCount: 2,
          attachmentNames: ['screen.png', 'log.txt'],
          attachmentTypes: ['image/png', 'text/plain']
        })
      })
    )
    expect(auditRecords).toContainEqual(
      expect.objectContaining({
        kind: 'inbound_dispatched',
        payload: expect.objectContaining({
          attachmentNames: ['screen.png', 'log.txt'],
          attachmentTypes: ['image/png', 'text/plain']
        })
      })
    )
  })

  it('audits accepted inbound messages when provider dispatch does not start', async () => {
    const auditRecords: Array<{
      kind: string
      summary: string
      payload?: Record<string, unknown>
    }> = []
    const dispatchRun = vi.fn(async () => ({ dispatched: false, appRunId: '' }))
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [binding()],
        list: () => [binding()]
      },
      pollMessages: async () => ({
        ok: true,
        accountId: 'mac-default',
        databasePath: '/db',
        messages: [
          {
            channel: 'imessage' as const,
            accountId: 'mac-default',
            chatGuid: 'chat-guid',
            messageGuid: 'message-guid-not-started',
            senderHandle: 'user@example.com',
            text: 'tw run unit tests',
            timestamp: '2026-06-06T10:01:00.000Z',
            rowId: 81
          }
        ]
      }),
      getChat: () => chat(),
      saveChat: vi.fn(),
      dispatchRun,
      auditStore: {
        append: vi.fn((record) => {
          auditRecords.push(record)
          return record as never
        })
      }
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({
      accepted: 1,
      dispatched: 0,
      rejected: { 'dispatch-not-started': 1 }
    })
    expect(auditRecords).toContainEqual(
      expect.objectContaining({
        kind: 'inbound_failed',
        summary: 'Provider dispatch did not start.',
        messageGuid: 'message-guid-not-started'
      })
    )
    expect(auditRecords).not.toContainEqual(expect.objectContaining({ kind: 'inbound_dispatched' }))
  })

  it('audits accepted inbound messages when provider dispatch throws', async () => {
    const auditRecords: Array<{
      kind: string
      summary: string
      payload?: Record<string, unknown>
    }> = []
    const dispatchRun = vi.fn(async () => {
      throw new Error('provider unavailable')
    })
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [binding()],
        list: () => [binding()]
      },
      pollMessages: async () => ({
        ok: true,
        accountId: 'mac-default',
        databasePath: '/db',
        messages: [
          {
            channel: 'imessage' as const,
            accountId: 'mac-default',
            chatGuid: 'chat-guid',
            messageGuid: 'message-guid-dispatch-error',
            senderHandle: 'user@example.com',
            text: 'tw run unit tests',
            timestamp: '2026-06-06T10:01:00.000Z',
            rowId: 82
          }
        ]
      }),
      getChat: () => chat(),
      saveChat: vi.fn(),
      dispatchRun,
      auditStore: {
        append: vi.fn((record) => {
          auditRecords.push(record)
          return record as never
        })
      }
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({
      accepted: 1,
      dispatched: 0,
      rejected: { 'dispatch-failed': 1 }
    })
    expect(auditRecords).toContainEqual(
      expect.objectContaining({
        kind: 'inbound_failed',
        summary: 'Provider dispatch failed.',
        messageGuid: 'message-guid-dispatch-error',
        payload: expect.objectContaining({ error: 'provider unavailable' })
      })
    )
  })

  it('handles status commands locally without dispatching a provider run', async () => {
    const dispatchRun = vi.fn()
    const auditRecords: Array<{
      kind: string
      payload?: Record<string, unknown>
    }> = []
    const delivery = {
      registerRunTarget: vi.fn(),
      sendDirectReply: vi.fn(async () => ({ attempted: true, sent: true }))
    }
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [binding()],
        list: () => [binding()]
      },
      pollMessages: async () => ({
        ok: true,
        accountId: 'mac-default',
        databasePath: '/db',
        messages: [
          {
            channel: 'imessage' as const,
            accountId: 'mac-default',
            chatGuid: 'chat-guid',
            messageGuid: 'message-guid-status',
            senderHandle: 'user@example.com',
            text: 'tw status',
            timestamp: '2026-06-06T10:04:00.000Z',
            rowId: 78
          }
        ]
      }),
      getChat: () => chat({ title: 'Operator Bridge' }),
      saveChat: vi.fn(),
      dispatchRun,
      delivery,
      auditStore: {
        append: vi.fn((record) => {
          auditRecords.push(record)
          return record as never
        })
      }
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({ accepted: 1, commands: 1, dispatched: 0 })
    expect(dispatchRun).not.toHaveBeenCalled()
    expect(delivery.registerRunTarget).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: 'binding-1',
        accountId: 'mac-default',
        chatGuid: 'chat-guid',
        appChatId: 'chat-1',
        recipientHandle: 'user@example.com',
        command: 'status',
        text: expect.stringContaining('TaskWraith channel gateway is online.')
      })
    )
    expect(auditRecords).toContainEqual(
      expect.objectContaining({
        kind: 'inbound_dispatched',
        payload: expect.objectContaining({
          replySent: true
        })
      })
    )
  })

  it('cancels active chat runs from an iMessage cancel command', async () => {
    const cancelActiveRunsForChat = vi.fn(async () => 2)
    const delivery = {
      registerRunTarget: vi.fn(),
      sendDirectReply: vi.fn(async () => ({ attempted: true, sent: true }))
    }
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [binding()],
        list: () => [binding()]
      },
      pollMessages: async () => ({
        ok: true,
        accountId: 'mac-default',
        databasePath: '/db',
        messages: [
          {
            channel: 'imessage' as const,
            accountId: 'mac-default',
            chatGuid: 'chat-guid',
            messageGuid: 'message-guid-cancel',
            senderHandle: 'user@example.com',
            text: 'tw cancel',
            timestamp: '2026-06-06T10:05:00.000Z',
            rowId: 79
          }
        ]
      }),
      getChat: () => chat(),
      saveChat: vi.fn(),
      dispatchRun: vi.fn(),
      delivery,
      cancelActiveRunsForChat
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({ commands: 1, dispatched: 0 })
    expect(cancelActiveRunsForChat).toHaveBeenCalledWith('chat-1')
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'mac-default',
        chatGuid: 'chat-guid',
        appChatId: 'chat-1',
        command: 'pause',
        text: 'Cancelled 2 active TaskWraith runs for this chat.'
      })
    )
  })

  it('resolves exact approval ids from iMessage approve commands', async () => {
    const resolveApproval = vi.fn(async () => true)
    const delivery = {
      registerRunTarget: vi.fn(),
      sendDirectReply: vi.fn(async () => ({ attempted: true, sent: true }))
    }
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [binding()],
        list: () => [binding()]
      },
      pollMessages: async () => ({
        ok: true,
        accountId: 'mac-default',
        databasePath: '/db',
        messages: [
          {
            channel: 'imessage' as const,
            accountId: 'mac-default',
            chatGuid: 'chat-guid',
            messageGuid: 'message-guid-approve',
            senderHandle: 'user@example.com',
            text: 'tw approve approval-123',
            timestamp: '2026-06-06T10:06:00.000Z',
            rowId: 80
          }
        ]
      }),
      getChat: () => chat(),
      saveChat: vi.fn(),
      dispatchRun: vi.fn(),
      delivery,
      resolveApproval
    })

    await service.pollOnce()

    expect(resolveApproval).toHaveBeenCalledWith('approval-123', 'accept')
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'mac-default',
        chatGuid: 'chat-guid',
        appChatId: 'chat-1',
        command: 'approval',
        text: 'Approved approval approval-123.'
      })
    )
  })

  it('audits command reply failure when no delivery service is configured', async () => {
    const auditRecords: Array<{
      kind: string
      summary: string
      payload?: Record<string, unknown>
    }> = []
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [binding()],
        list: () => [binding()]
      },
      pollMessages: async () => ({
        ok: true,
        accountId: 'mac-default',
        databasePath: '/db',
        messages: [
          {
            channel: 'imessage' as const,
            accountId: 'mac-default',
            chatGuid: 'chat-guid',
            messageGuid: 'message-guid-status-no-delivery',
            senderHandle: 'user@example.com',
            text: 'tw status',
            timestamp: '2026-06-06T10:07:00.000Z',
            rowId: 83
          }
        ]
      }),
      getChat: () => chat(),
      saveChat: vi.fn(),
      dispatchRun: vi.fn(),
      auditStore: {
        append: vi.fn((record) => {
          auditRecords.push(record)
          return record as never
        })
      }
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({ commands: 1, dispatched: 0 })
    expect(auditRecords).toContainEqual(
      expect.objectContaining({
        kind: 'outbound_failed',
        summary: 'Failed to send iMessage command reply: status.',
        payload: expect.objectContaining({
          command: 'status',
          error: 'delivery-unavailable'
        })
      })
    )
    expect(auditRecords).toContainEqual(
      expect.objectContaining({
        kind: 'inbound_dispatched',
        payload: expect.objectContaining({
          replySent: false,
          replyReason: 'delivery-unavailable'
        })
      })
    )
  })

  it('does not dispatch unauthorized or untriggered messages', async () => {
    const dispatchRun = vi.fn()
    const auditRecords: Array<{
      kind: string
      bindingId?: string
      messageGuid?: string
      senderHandle?: string
      payload?: Record<string, unknown>
    }> = []
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [binding()],
        list: () => [binding()]
      },
      pollMessages: async () => ({
        ok: true,
        accountId: 'mac-default',
        databasePath: '/db',
        messages: [
          {
            channel: 'imessage',
            accountId: 'mac-default',
            chatGuid: 'chat-guid',
            messageGuid: 'message-guid-1',
            senderHandle: 'other@example.com',
            text: 'tw run tests',
            timestamp: '2026-06-06T10:01:00.000Z',
            rowId: 1
          },
          {
            channel: 'imessage',
            accountId: 'mac-default',
            chatGuid: 'chat-guid',
            messageGuid: 'message-guid-2',
            senderHandle: 'user@example.com',
            text: 'run tests',
            timestamp: '2026-06-06T10:02:00.000Z',
            rowId: 2
          }
        ]
      }),
      getChat: () => chat(),
      saveChat: vi.fn(),
      dispatchRun,
      auditStore: {
        append: vi.fn((record) => {
          auditRecords.push(record)
          return record as never
        })
      }
    })

    const summary = await service.pollOnce()

    expect(summary.accepted).toBe(0)
    expect(summary.dispatched).toBe(0)
    expect(summary.rejected).toMatchObject({
      'sender-not-allowed': 1,
      'trigger-required': 1
    })
    expect(dispatchRun).not.toHaveBeenCalled()
    expect(auditRecords).toContainEqual(
      expect.objectContaining({
        kind: 'inbound_received',
        bindingId: 'binding-1',
        messageGuid: 'message-guid-1',
        senderHandle: 'other@example.com',
        payload: expect.objectContaining({ textPreview: 'tw run tests' })
      })
    )
    expect(auditRecords).toContainEqual(
      expect.objectContaining({
        kind: 'inbound_received',
        bindingId: 'binding-1',
        messageGuid: 'message-guid-2',
        senderHandle: 'user@example.com',
        payload: expect.objectContaining({ textPreview: 'run tests' })
      })
    )
    expect(auditRecords.filter((record) => record.kind === 'inbound_rejected')).toHaveLength(2)
  })

  it('audits Messages poll failures before rethrowing', async () => {
    const auditRecords: Array<{
      kind: string
      summary: string
      payload?: Record<string, unknown>
    }> = []
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [binding()],
        list: () => [binding()]
      },
      pollMessages: async () => {
        throw new Error('Full Disk Access required')
      },
      getChat: () => chat(),
      saveChat: vi.fn(),
      dispatchRun: vi.fn(),
      auditStore: {
        append: vi.fn((record) => {
          auditRecords.push(record)
          return record as never
        })
      }
    })

    await expect(
      service.pollOnce({
        accountId: 'mac-default',
        chatGuid: 'chat-guid',
        afterRowId: 40
      })
    ).rejects.toThrow(/Full Disk Access required/)

    expect(auditRecords).toContainEqual(
      expect.objectContaining({
        kind: 'poll',
        summary: 'Messages poll failed.',
        accountId: 'mac-default',
        chatGuid: 'chat-guid',
        payload: { error: 'Full Disk Access required' }
      })
    )
  })

  it('uses binding cursors for default polls and advances them after processing rows', async () => {
    const auditRecords: Array<{
      kind: string
      summary: string
      payload?: Record<string, unknown>
    }> = []
    const cursorStore = {
      get: vi.fn(() => ({
        channel: 'imessage' as const,
        accountId: 'mac-default',
        chatGuid: 'chat-guid',
        lastRowId: 40,
        updatedAt: '2026-06-06T10:00:00.000Z'
      })),
      update: vi.fn()
    }
    const pollMessages = vi.fn(async () => ({
      ok: true,
      accountId: 'mac-default',
      databasePath: '/db',
      messages: [
        {
          channel: 'imessage' as const,
          accountId: 'mac-default',
          chatGuid: 'chat-guid',
          messageGuid: 'message-guid-41',
          senderHandle: 'user@example.com',
          text: 'tw status',
          timestamp: '2026-06-06T10:03:00.000Z',
          rowId: 41
        }
      ]
    }))
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [binding()],
        list: () => [binding()]
      },
      pollMessages,
      getChat: () => chat(),
      saveChat: vi.fn(),
      dispatchRun: vi.fn(async () => ({ dispatched: true, appRunId: 'run-41' })),
      cursorStore,
      auditStore: {
        append: vi.fn((record) => {
          auditRecords.push(record)
          return record as never
        })
      }
    })

    const summary = await service.pollOnce()

    expect(summary.lastRowId).toBe(41)
    expect(pollMessages).toHaveBeenCalledWith({
      accountId: 'mac-default',
      chatGuid: 'chat-guid',
      afterRowId: 40,
      includeFromMe: true
    })
    expect(cursorStore.update).toHaveBeenCalledWith(
      { channel: 'imessage', accountId: 'mac-default', chatGuid: 'chat-guid' },
      41
    )
    expect(auditRecords.map((record) => record.kind)).toContain('inbound_dispatched')
    expect(auditRecords.map((record) => record.kind)).toContain('poll')
  })

  it('keeps accepted provider prompts retryable when dispatch startup fails', async () => {
    let chatRecord = chat()
    const cursorStore = {
      get: vi.fn(() => ({
        channel: 'imessage' as const,
        accountId: 'mac-default',
        chatGuid: 'chat-guid',
        lastRowId: 40,
        updatedAt: '2026-06-06T10:00:00.000Z'
      })),
      update: vi.fn()
    }
    const pollMessages = vi.fn(async () => ({
      ok: true,
      accountId: 'mac-default',
      databasePath: '/db',
      messages: [
        {
          channel: 'imessage' as const,
          accountId: 'mac-default',
          chatGuid: 'chat-guid',
          messageGuid: 'message-guid-retry',
          senderHandle: 'user@example.com',
          text: 'tw run the failing check again',
          timestamp: '2026-06-06T10:08:00.000Z',
          isFromMe: false,
          rowId: 41,
          attachments: []
        }
      ]
    }))
    const dispatchRun = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider temporarily unavailable'))
      .mockResolvedValueOnce({ dispatched: true, appRunId: 'run-retry' })
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [binding()],
        list: () => [binding()]
      },
      pollMessages,
      getChat: () => chatRecord,
      saveChat: (updated) => {
        chatRecord = updated
      },
      dispatchRun,
      cursorStore,
      nowIso: () => '2026-06-06T10:09:00.000Z'
    })

    const first = await service.pollOnce()

    expect(first).toMatchObject({
      accepted: 1,
      dispatched: 0,
      rejected: { 'dispatch-failed': 1 },
      lastRowId: 41
    })
    expect(chatRecord.messages).toHaveLength(1)
    expect(chatRecord.messages[0].metadata).toMatchObject({
      channelDispatchStatus: 'retryable-failed',
      channelDispatchError: 'provider temporarily unavailable',
      messageGuid: 'message-guid-retry'
    })
    expect(cursorStore.update).toHaveBeenLastCalledWith(
      { channel: 'imessage', accountId: 'mac-default', chatGuid: 'chat-guid' },
      40
    )

    const second = await service.pollOnce()

    expect(second).toMatchObject({ accepted: 1, dispatched: 1, rejected: {}, lastRowId: 41 })
    expect(dispatchRun).toHaveBeenCalledTimes(2)
    expect(chatRecord.messages).toHaveLength(1)
    expect(chatRecord.messages[0].metadata).toMatchObject({
      channelDispatchStatus: 'dispatched',
      appRunId: 'run-retry',
      messageGuid: 'message-guid-retry'
    })
    expect(cursorStore.update).toHaveBeenLastCalledWith(
      { channel: 'imessage', accountId: 'mac-default', chatGuid: 'chat-guid' },
      41
    )
  })
})
