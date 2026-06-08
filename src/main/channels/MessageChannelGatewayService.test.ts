import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatRecord } from '../store/types'
import {
  MessageChannelGatewayService,
  parseMessageChannelCommand
} from './MessageChannelGatewayService'
import type { MessageChannelBinding } from './MessageChannelTypes'
import { LocalWebChannelAdapter } from './LocalWebChannelAdapter'

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

function telegramBinding(): MessageChannelBinding {
  return {
    ...binding(),
    id: 'telegram-binding-1',
    channel: 'telegram',
    accountId: 'telegram-bot',
    chatGuid: 'telegram:123456',
    allowedHandles: ['telegram-user:42'],
    label: 'Telegram Operator'
  }
}

function webBinding(): MessageChannelBinding {
  return {
    ...binding(),
    id: 'web-binding-1',
    channel: 'web',
    accountId: 'local-web',
    chatGuid: 'web:operator',
    allowedHandles: ['web-user:operator'],
    label: 'Local Web Operator'
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
  const tempDirs: string[] = []

  afterEach(() => {
    while (tempDirs.length) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true })
    }
  })

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'taskwraith-channel-'))
    tempDirs.push(dir)
    return dir
  }

  it('recognizes portable channel commands before provider dispatch', () => {
    expect(parseMessageChannelCommand('channel status')).toEqual({ name: 'status' })
    expect(parseMessageChannelCommand('pause')).toEqual({ name: 'pause' })
    expect(parseMessageChannelCommand('resume')).toEqual({ name: 'resume' })
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
    expect(parseMessageChannelCommand('show diff')).toEqual({ name: 'show_diff' })
    expect(parseMessageChannelCommand('open thread')).toEqual({ name: 'open_thread' })
    expect(parseMessageChannelCommand('send file docs/report.pdf')).toEqual({
      name: 'send_file',
      requestedPath: 'docs/report.pdf'
    })
    expect(parseMessageChannelCommand('send file "docs/weekly report.pdf"')).toEqual({
      name: 'send_file',
      requestedPath: 'docs/weekly report.pdf'
    })
    expect(parseMessageChannelCommand('handoff to codex')).toEqual({
      name: 'handoff_provider',
      provider: 'codex',
      prompt: ''
    })
    expect(parseMessageChannelCommand('handoff to openai inspect the repo')).toEqual({
      name: 'handoff_provider',
      provider: 'codex',
      prompt: 'inspect the repo'
    })
    expect(parseMessageChannelCommand('handoff to grok investigate the failure')).toEqual({
      name: 'handoff_provider',
      provider: 'grok',
      prompt: 'investigate the failure'
    })
    expect(parseMessageChannelCommand('handoff to cursor make the edit')).toEqual({
      name: 'handoff_provider',
      provider: 'cursor',
      prompt: 'make the edit'
    })
    expect(parseMessageChannelCommand('handoff to ollama summarize locally')).toEqual({
      name: 'handoff_provider',
      provider: 'ollama',
      prompt: 'summarize locally'
    })
    expect(parseMessageChannelCommand('handoff to local summarize locally')).toEqual({
      name: 'handoff_provider',
      provider: 'ollama',
      prompt: 'summarize locally'
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

  it('handles status endpoint bindings without loading a chat or dispatching a provider run', async () => {
    const endpointBinding: MessageChannelBinding = {
      ...webBinding(),
      routeTarget: 'status_endpoint'
    }
    const getChat = vi.fn()
    const saveChat = vi.fn()
    const dispatchRun = vi.fn()
    const delivery = {
      registerRunTarget: vi.fn(),
      sendDirectReply: vi.fn(async () => ({ attempted: true, sent: true }))
    }
    const auditRecords: Array<{ kind: string; payload?: Record<string, unknown> }> = []
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [endpointBinding],
        list: () => [endpointBinding]
      },
      pollMessages: async () => ({
        ok: true,
        channel: 'web',
        accountId: 'local-web',
        databasePath: 'local-web:memory',
        messages: [
          {
            channel: 'web',
            accountId: 'local-web',
            chatGuid: 'web:operator',
            messageGuid: 'web-status-1',
            senderHandle: 'web-user:operator',
            text: 'tw status',
            timestamp: '2026-06-08T12:00:00.000Z',
            rowId: 1
          }
        ]
      }),
      getChat,
      saveChat,
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

    expect(summary).toMatchObject({ polled: 1, accepted: 1, dispatched: 0, commands: 1 })
    expect(getChat).not.toHaveBeenCalled()
    expect(saveChat).not.toHaveBeenCalled()
    expect(dispatchRun).not.toHaveBeenCalled()
    expect(delivery.registerRunTarget).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'web',
        command: 'status',
        text: expect.stringContaining('Target: status endpoint.')
      })
    )
    expect(auditRecords).toContainEqual(
      expect.objectContaining({
        kind: 'inbound_dispatched',
        payload: expect.objectContaining({
          routeTarget: 'status_endpoint',
          command: 'status',
          replySent: true
        })
      })
    )
  })

  it('handles approval endpoint commands without provider dispatch', async () => {
    const endpointBinding: MessageChannelBinding = {
      ...telegramBinding(),
      routeTarget: 'approval_status'
    }
    const resolveApproval = vi.fn(async () => true)
    const dispatchRun = vi.fn()
    const delivery = {
      registerRunTarget: vi.fn(),
      sendDirectReply: vi.fn(async () => ({ attempted: true, sent: true }))
    }
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [endpointBinding],
        list: () => [endpointBinding]
      },
      pollMessages: async () => ({
        ok: true,
        channel: 'telegram',
        accountId: 'telegram-bot',
        databasePath: 'telegram:getUpdates',
        messages: [
          {
            channel: 'telegram',
            accountId: 'telegram-bot',
            chatGuid: 'telegram:123456',
            messageGuid: 'telegram-approval-1',
            senderHandle: 'telegram-user:42',
            text: 'tw approve approval-1',
            timestamp: '2026-06-08T12:01:00.000Z',
            rowId: 2
          }
        ]
      }),
      getChat: vi.fn(),
      saveChat: vi.fn(),
      dispatchRun,
      delivery,
      resolveApproval
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({ polled: 1, accepted: 1, dispatched: 0, commands: 1 })
    expect(resolveApproval).toHaveBeenCalledWith('approval-1', 'accept')
    expect(dispatchRun).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'approval',
        text: 'Approved approval approval-1.'
      })
    )
  })

  it('routes plain channel prompts into a fresh provider thread', async () => {
    const newThreadBinding: MessageChannelBinding = {
      ...webBinding(),
      routeTarget: 'new_provider_thread',
      provider: 'grok'
    }
    const createdChat = chat({
      appChatId: 'new-channel-chat-1',
      provider: 'grok',
      title: 'Channel seed',
      messages: []
    })
    const saved: ChatRecord[] = []
    const createProviderThread = vi.fn(async () => createdChat)
    const getChat = vi.fn()
    const dispatchRun = vi.fn(async () => ({ dispatched: true, appRunId: 'run-new-thread' }))
    const delivery = {
      registerRunTarget: vi.fn(),
      sendDirectReply: vi.fn(async () => ({ attempted: true, sent: true }))
    }
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [newThreadBinding],
        list: () => [newThreadBinding]
      },
      pollMessages: async () => ({
        ok: true,
        channel: 'web',
        accountId: 'local-web',
        databasePath: 'local-web:memory',
        messages: [
          {
            channel: 'web',
            accountId: 'local-web',
            chatGuid: 'web:operator',
            messageGuid: 'web-new-thread-1',
            senderHandle: 'web-user:operator',
            text: 'tw inspect the repo',
            timestamp: '2026-06-08T12:02:00.000Z',
            rowId: 3
          }
        ]
      }),
      createProviderThread,
      getChat,
      saveChat: (updated) => saved.push(updated),
      dispatchRun,
      delivery,
      nowIso: () => '2026-06-08T12:02:05.000Z'
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({ polled: 1, accepted: 1, dispatched: 1, commands: 0 })
    expect(getChat).not.toHaveBeenCalled()
    expect(createProviderThread).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: newThreadBinding,
        provider: 'grok',
        title: 'Local Web Operator: inspect the repo'
      })
    )
    expect(saved).toHaveLength(2)
    expect(saved[0]).toMatchObject({
      appChatId: 'new-channel-chat-1',
      provider: 'grok',
      messages: [
        expect.objectContaining({
          role: 'user',
          content: 'inspect the repo',
          metadata: expect.objectContaining({
            routeTarget: 'new_provider_thread',
            channelDispatchStatus: 'pending'
          })
        })
      ]
    })
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'grok',
        appChatId: 'new-channel-chat-1',
        prompt: expect.stringContaining('User message:\ninspect the repo')
      })
    )
    expect(delivery.registerRunTarget).toHaveBeenCalledWith({
      appRunId: 'run-new-thread',
      channel: 'web',
      bindingId: 'web-binding-1',
      accountId: 'local-web',
      chatGuid: 'web:operator',
      appChatId: 'new-channel-chat-1',
      recipientHandle: 'web-user:operator'
    })
    expect(delivery.sendDirectReply).not.toHaveBeenCalled()
    expect(saved[1].messages[0].metadata).toMatchObject({
      channelDispatchStatus: 'dispatched',
      appRunId: 'run-new-thread'
    })
  })

  it('routes plain channel prompts into the workspace default agent thread', async () => {
    const workspaceDefaultBinding: MessageChannelBinding = {
      ...webBinding(),
      routeTarget: 'workspace_default_agent',
      provider: 'kimi'
    }
    const defaultChat = chat({
      appChatId: 'workspace-default-channel-chat',
      provider: 'kimi',
      title: 'Local Web Operator: Workspace channel',
      messages: []
    })
    const saved: ChatRecord[] = []
    const createWorkspaceDefaultThread = vi.fn(async () => defaultChat)
    const dispatchRun = vi.fn(async () => ({
      dispatched: true,
      appRunId: 'run-workspace-default'
    }))
    const delivery = {
      registerRunTarget: vi.fn(),
      sendDirectReply: vi.fn(async () => ({ attempted: true, sent: true }))
    }
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [workspaceDefaultBinding],
        list: () => [workspaceDefaultBinding]
      },
      pollMessages: async () => ({
        ok: true,
        channel: 'web',
        accountId: 'local-web',
        databasePath: 'local-web:memory',
        messages: [
          {
            channel: 'web',
            accountId: 'local-web',
            chatGuid: 'web:operator',
            messageGuid: 'web-workspace-default-1',
            senderHandle: 'web-user:operator',
            text: 'tw summarize workspace status',
            timestamp: '2026-06-08T12:02:10.000Z',
            rowId: 33
          }
        ]
      }),
      createWorkspaceDefaultThread,
      getChat: vi.fn(),
      saveChat: (updated) => saved.push(updated),
      dispatchRun,
      delivery,
      nowIso: () => '2026-06-08T12:02:15.000Z'
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({ polled: 1, accepted: 1, dispatched: 1, commands: 0 })
    expect(createWorkspaceDefaultThread).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: workspaceDefaultBinding,
        provider: 'kimi',
        title: 'Local Web Operator: Workspace channel'
      })
    )
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'kimi',
        appChatId: 'workspace-default-channel-chat',
        prompt: expect.stringContaining('User message:\nsummarize workspace status')
      })
    )
    expect(delivery.registerRunTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        appRunId: 'run-workspace-default',
        appChatId: 'workspace-default-channel-chat'
      })
    )
    expect(delivery.sendDirectReply).not.toHaveBeenCalled()
    expect(saved[0].messages[0].metadata).toMatchObject({
      routeTarget: 'workspace_default_agent',
      channelDispatchStatus: 'pending'
    })
    expect(saved[1].messages[0].metadata).toMatchObject({
      routeTarget: 'workspace_default_agent',
      channelDispatchStatus: 'dispatched',
      appRunId: 'run-workspace-default'
    })
  })

  it('routes plain channel prompts into an Ensemble round without single-provider dispatch', async () => {
    const ensembleBinding: MessageChannelBinding = {
      ...webBinding(),
      routeTarget: 'ensemble',
      provider: 'ollama'
    }
    const ensembleChat = chat({
      appChatId: 'channel-ensemble-chat',
      chatKind: 'ensemble',
      provider: 'ollama',
      title: 'Local Web Operator: Ensemble',
      messages: []
    })
    const createEnsembleThread = vi.fn(async () => ensembleChat)
    const dispatchEnsembleRun = vi.fn(async () => ({
      dispatched: true,
      status: 'started',
      roundId: 'ensemble-round-1'
    }))
    const dispatchRun = vi.fn()
    const delivery = {
      registerRunTarget: vi.fn(),
      sendDirectReply: vi.fn(async () => ({ attempted: true, sent: true }))
    }
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [ensembleBinding],
        list: () => [ensembleBinding]
      },
      pollMessages: async () => ({
        ok: true,
        channel: 'web',
        accountId: 'local-web',
        databasePath: 'local-web:memory',
        messages: [
          {
            channel: 'web',
            accountId: 'local-web',
            chatGuid: 'web:operator',
            messageGuid: 'web-ensemble-1',
            senderHandle: 'web-user:operator',
            text: 'tw compare providers',
            timestamp: '2026-06-08T12:03:00.000Z',
            rowId: 40
          }
        ]
      }),
      createEnsembleThread,
      dispatchEnsembleRun,
      getChat: vi.fn(),
      saveChat: vi.fn(),
      dispatchRun,
      delivery
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({ polled: 1, accepted: 1, dispatched: 1, commands: 0 })
    expect(createEnsembleThread).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: ensembleBinding,
        provider: 'ollama',
        title: 'Local Web Operator: Ensemble compare providers'
      })
    )
    expect(dispatchRun).not.toHaveBeenCalled()
    expect(dispatchEnsembleRun).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: ensembleBinding,
        chat: ensembleChat,
        provider: 'ollama',
        prompt: expect.stringContaining('External Local web chat channel input.')
      })
    )
    expect(dispatchEnsembleRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('User message:\ncompare providers')
      })
    )
    expect(delivery.registerRunTarget).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'planned',
        text: 'Started TaskWraith Ensemble round ensemble-rou.'
      })
    )
  })

  it('fails closed when new-provider-thread routing has no app-layer creator', async () => {
    const newThreadBinding: MessageChannelBinding = {
      ...webBinding(),
      routeTarget: 'new_provider_thread'
    }
    const dispatchRun = vi.fn()
    const delivery = {
      registerRunTarget: vi.fn(),
      sendDirectReply: vi.fn(async () => ({ attempted: true, sent: true }))
    }
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [newThreadBinding],
        list: () => [newThreadBinding]
      },
      pollMessages: async () => ({
        ok: true,
        channel: 'web',
        accountId: 'local-web',
        databasePath: 'local-web:memory',
        messages: [
          {
            channel: 'web',
            accountId: 'local-web',
            chatGuid: 'web:operator',
            messageGuid: 'web-new-thread-unavailable',
            senderHandle: 'web-user:operator',
            text: 'tw run this in a fresh thread',
            timestamp: '2026-06-08T12:02:30.000Z',
            rowId: 4
          }
        ]
      }),
      getChat: vi.fn(),
      saveChat: vi.fn(),
      dispatchRun,
      delivery
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({
      polled: 1,
      accepted: 1,
      dispatched: 0,
      rejected: { 'new-thread-unavailable': 1 }
    })
    expect(dispatchRun).not.toHaveBeenCalled()
    expect(delivery.registerRunTarget).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'planned',
        text: expect.stringContaining('New provider thread routing is not available')
      })
    )
  })

  it('fails closed when workspace-default-agent routing has no app-layer creator', async () => {
    const workspaceDefaultBinding: MessageChannelBinding = {
      ...webBinding(),
      routeTarget: 'workspace_default_agent'
    }
    const dispatchRun = vi.fn()
    const delivery = {
      registerRunTarget: vi.fn(),
      sendDirectReply: vi.fn(async () => ({ attempted: true, sent: true }))
    }
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [workspaceDefaultBinding],
        list: () => [workspaceDefaultBinding]
      },
      pollMessages: async () => ({
        ok: true,
        channel: 'web',
        accountId: 'local-web',
        databasePath: 'local-web:memory',
        messages: [
          {
            channel: 'web',
            accountId: 'local-web',
            chatGuid: 'web:operator',
            messageGuid: 'web-workspace-default-unavailable',
            senderHandle: 'web-user:operator',
            text: 'tw summarize this workspace',
            timestamp: '2026-06-08T12:02:45.000Z',
            rowId: 34
          }
        ]
      }),
      getChat: vi.fn(),
      saveChat: vi.fn(),
      dispatchRun,
      delivery
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({
      polled: 1,
      accepted: 1,
      dispatched: 0,
      rejected: { 'workspace-default-unavailable': 1 }
    })
    expect(dispatchRun).not.toHaveBeenCalled()
    expect(delivery.registerRunTarget).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'planned',
        text: expect.stringContaining('Workspace default agent routing is not available')
      })
    )
  })

  it('fails closed when ensemble routing has no app-layer ensemble dispatcher', async () => {
    const ensembleBinding: MessageChannelBinding = {
      ...webBinding(),
      routeTarget: 'ensemble'
    }
    const dispatchRun = vi.fn()
    const delivery = {
      registerRunTarget: vi.fn(),
      sendDirectReply: vi.fn(async () => ({ attempted: true, sent: true }))
    }
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [ensembleBinding],
        list: () => [ensembleBinding]
      },
      pollMessages: async () => ({
        ok: true,
        channel: 'web',
        accountId: 'local-web',
        databasePath: 'local-web:memory',
        messages: [
          {
            channel: 'web',
            accountId: 'local-web',
            chatGuid: 'web:operator',
            messageGuid: 'web-ensemble-unavailable',
            senderHandle: 'web-user:operator',
            text: 'tw review this as a group',
            timestamp: '2026-06-08T12:03:30.000Z',
            rowId: 41
          }
        ]
      }),
      getChat: vi.fn(),
      saveChat: vi.fn(),
      dispatchRun,
      delivery
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({
      polled: 1,
      accepted: 1,
      dispatched: 0,
      rejected: { 'ensemble-unavailable': 1 }
    })
    expect(dispatchRun).not.toHaveBeenCalled()
    expect(delivery.registerRunTarget).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'planned',
        text: expect.stringContaining('Ensemble routing is not available')
      })
    )
  })

  it('rejects existing-chat prompts when the binding workspace allow-list mismatches the chat', async () => {
    const restrictedBinding: MessageChannelBinding = {
      ...binding(),
      workspaceId: 'workspace-allowed'
    }
    const getChat = vi.fn(() =>
      chat({
        workspaceId: 'workspace-other',
        workspacePath: '/other-repo'
      })
    )
    const saveChat = vi.fn()
    const dispatchRun = vi.fn()
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [restrictedBinding],
        list: () => [restrictedBinding]
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
            messageGuid: 'message-workspace-mismatch',
            senderHandle: 'user@example.com',
            text: 'tw run unit tests',
            timestamp: '2026-06-06T10:00:00.000Z',
            isFromMe: false,
            rowId: 41
          }
        ]
      }),
      getChat,
      saveChat,
      dispatchRun
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({
      polled: 1,
      accepted: 1,
      dispatched: 0,
      rejected: { 'workspace-not-allowed': 1 }
    })
    expect(getChat).toHaveBeenCalledWith('chat-1')
    expect(saveChat).not.toHaveBeenCalled()
    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('rejects provider-thread routes when the created chat leaves the binding workspace allow-list', async () => {
    const restrictedBinding: MessageChannelBinding = {
      ...webBinding(),
      routeTarget: 'new_provider_thread',
      workspaceId: 'workspace-allowed'
    }
    const createdChat = chat({
      appChatId: 'new-channel-chat-mismatch',
      workspaceId: 'workspace-other',
      workspacePath: '/other-repo'
    })
    const createProviderThread = vi.fn(async () => createdChat)
    const saveChat = vi.fn()
    const dispatchRun = vi.fn()
    const delivery = {
      registerRunTarget: vi.fn(),
      sendDirectReply: vi.fn(async () => ({ attempted: true, sent: true }))
    }
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [restrictedBinding],
        list: () => [restrictedBinding]
      },
      pollMessages: async () => ({
        ok: true,
        channel: 'web',
        accountId: 'local-web',
        databasePath: 'local-web:memory',
        messages: [
          {
            channel: 'web',
            accountId: 'local-web',
            chatGuid: 'web:operator',
            messageGuid: 'web-thread-workspace-mismatch',
            senderHandle: 'web-user:operator',
            text: 'tw inspect this repo',
            timestamp: '2026-06-08T12:04:00.000Z',
            rowId: 42
          }
        ]
      }),
      createProviderThread,
      getChat: vi.fn(),
      saveChat,
      dispatchRun,
      delivery
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({
      polled: 1,
      accepted: 1,
      dispatched: 0,
      rejected: { 'workspace-not-allowed': 1 }
    })
    expect(createProviderThread).toHaveBeenCalled()
    expect(saveChat).not.toHaveBeenCalled()
    expect(dispatchRun).not.toHaveBeenCalled()
    expect(delivery.registerRunTarget).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('limited to a different TaskWraith workspace')
      })
    )
  })

  it('rejects ensemble routes when the ensemble chat leaves the binding workspace allow-list', async () => {
    const restrictedBinding: MessageChannelBinding = {
      ...webBinding(),
      routeTarget: 'ensemble',
      workspaceId: 'workspace-allowed'
    }
    const ensembleChat = chat({
      appChatId: 'channel-ensemble-mismatch',
      chatKind: 'ensemble',
      workspaceId: 'workspace-other',
      workspacePath: '/other-repo'
    })
    const createEnsembleThread = vi.fn(async () => ensembleChat)
    const dispatchEnsembleRun = vi.fn()
    const delivery = {
      registerRunTarget: vi.fn(),
      sendDirectReply: vi.fn(async () => ({ attempted: true, sent: true }))
    }
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [restrictedBinding],
        list: () => [restrictedBinding]
      },
      pollMessages: async () => ({
        ok: true,
        channel: 'web',
        accountId: 'local-web',
        databasePath: 'local-web:memory',
        messages: [
          {
            channel: 'web',
            accountId: 'local-web',
            chatGuid: 'web:operator',
            messageGuid: 'web-ensemble-workspace-mismatch',
            senderHandle: 'web-user:operator',
            text: 'tw review this as an ensemble',
            timestamp: '2026-06-08T12:04:30.000Z',
            rowId: 43
          }
        ]
      }),
      createEnsembleThread,
      dispatchEnsembleRun,
      getChat: vi.fn(),
      saveChat: vi.fn(),
      dispatchRun: vi.fn(),
      delivery
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({
      polled: 1,
      accepted: 1,
      dispatched: 0,
      rejected: { 'workspace-not-allowed': 1 }
    })
    expect(createEnsembleThread).toHaveBeenCalled()
    expect(dispatchEnsembleRun).not.toHaveBeenCalled()
    expect(delivery.registerRunTarget).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('limited to a different TaskWraith workspace')
      })
    )
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

  it('routes Telegram adapter messages through the same policy-gated dispatch path', async () => {
    const saved: ChatRecord[] = []
    const dispatchRun = vi.fn(async () => ({ dispatched: true, appRunId: 'run-telegram' }))
    const pollMessages = vi.fn(async () => ({
      ok: true,
      channel: 'telegram' as const,
      accountId: 'telegram-bot',
      databasePath: 'telegram:getUpdates',
      messages: [
        {
          rowId: 100,
          channel: 'telegram' as const,
          accountId: 'telegram-bot',
          chatGuid: 'telegram:123456',
          messageGuid: 'telegram:100:7',
          senderHandle: 'telegram-user:42',
          text: 'tw summarize status',
          timestamp: '2026-06-07T10:01:00.000Z',
          isFromMe: false,
          attachments: []
        }
      ]
    }))
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: ({ channel }) => (channel === 'telegram' ? [telegramBinding()] : []),
        list: () => [telegramBinding()]
      },
      pollMessages,
      getChat: () => chat({ title: 'Telegram Operator' }),
      saveChat: (updated) => saved.push(updated),
      dispatchRun
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({ polled: 1, accepted: 1, dispatched: 1, lastRowId: 100 })
    expect(pollMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'telegram',
        accountId: 'telegram-bot',
        chatGuid: '__account__',
        allConversations: true,
        includeFromMe: true
      })
    )
    expect(saved.at(-1)?.messages[0].metadata).toMatchObject({
      kind: 'channelInbound',
      channel: 'telegram',
      authState: 'allowlisted_contact',
      sourceTrust: 'external_untrusted',
      appRunId: 'run-telegram'
    })
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'codex',
        prompt: expect.stringContaining('External Telegram channel input.')
      })
    )
  })

  it('routes local web adapter messages through the same policy-gated dispatch path', async () => {
    const saved: ChatRecord[] = []
    const dispatchRun = vi.fn(async () => ({ dispatched: true, appRunId: 'run-web' }))
    const adapter = new LocalWebChannelAdapter({
      nowIso: () => '2026-06-08T10:00:00.000Z'
    })
    adapter.submitMessage({
      chatGuid: 'web:operator',
      senderHandle: 'web-user:operator',
      text: 'tw map project'
    })
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: ({ channel }) => (channel === 'web' ? [webBinding()] : []),
        list: () => [webBinding()]
      },
      pollMessages: (params) => adapter.poll(params),
      getChat: () => chat({ title: 'Local Web Operator' }),
      saveChat: (updated) => saved.push(updated),
      dispatchRun
    })

    const summary = await service.pollOnce({
      channel: 'web',
      accountId: 'local-web',
      chatGuid: 'web:operator',
      afterRowId: 0
    })

    expect(summary).toMatchObject({ polled: 1, accepted: 1, dispatched: 1, lastRowId: 1 })
    expect(saved.at(-1)?.messages[0].metadata).toMatchObject({
      kind: 'channelInbound',
      channel: 'web',
      authState: 'allowlisted_contact',
      sourceTrust: 'external_untrusted',
      appRunId: 'run-web'
    })
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'codex',
        prompt: expect.stringContaining('External Local web chat channel input.')
      })
    )
  })

  it('rate-limits accepted channel rows before transcript writes or provider dispatch', async () => {
    const saved: ChatRecord[] = []
    const auditRecords: Array<{
      kind: string
      messageGuid?: string
      payload?: Record<string, unknown>
    }> = []
    const dispatchRun = vi.fn(async () => ({ dispatched: true, appRunId: 'run-rate-limit' }))
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
            messageGuid: 'message-guid-rate-1',
            senderHandle: 'user@example.com',
            text: 'tw run one thing',
            timestamp: '2026-06-06T10:01:00.000Z',
            rowId: 51
          },
          {
            channel: 'imessage' as const,
            accountId: 'mac-default',
            chatGuid: 'chat-guid',
            messageGuid: 'message-guid-rate-2',
            senderHandle: 'user@example.com',
            text: 'tw run another thing',
            timestamp: '2026-06-06T10:01:01.000Z',
            rowId: 52
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
      },
      rateLimit: {
        maxAcceptedMessages: 1,
        windowMs: 60_000
      },
      nowIso: () => '2026-06-06T10:02:00.000Z'
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({
      polled: 2,
      accepted: 1,
      dispatched: 1,
      rejected: { 'rate-limited': 1 },
      lastRowId: 52
    })
    expect(dispatchRun).toHaveBeenCalledTimes(1)
    expect(saved).toHaveLength(2)
    expect(saved[0].messages).toHaveLength(1)
    expect(saved.at(-1)?.messages).toHaveLength(1)
    expect(auditRecords).toContainEqual(
      expect.objectContaining({
        kind: 'inbound_rejected',
        messageGuid: 'message-guid-rate-2',
        payload: expect.objectContaining({
          reason: 'rate-limited',
          rateLimit: expect.objectContaining({
            limit: 1,
            windowMs: 60_000,
            retryAfterMs: expect.any(Number)
          })
        })
      })
    )
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

  it('resumes the latest retryable channel message through provider dispatch', async () => {
    let chatRecord = chat({
      messages: [
        {
          id: 'message-retryable',
          role: 'user',
          content: 'run the failing check again',
          timestamp: '2026-06-06T10:04:00.000Z',
          metadata: {
            kind: 'channelInbound',
            channel: 'imessage',
            accountId: 'mac-default',
            bindingId: 'binding-1',
            chatGuid: 'chat-guid',
            messageGuid: 'message-guid-retryable',
            senderHandle: 'user@example.com',
            authState: 'allowlisted_contact',
            attachmentCount: 0,
            sourceTrust: 'external_untrusted',
            channelDispatchStatus: 'retryable-failed',
            channelDispatchError: 'provider temporarily unavailable'
          }
        }
      ]
    })
    const dispatchRun = vi.fn(async () => ({ dispatched: true, appRunId: 'run-resumed' }))
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
            messageGuid: 'message-guid-resume',
            senderHandle: 'user@example.com',
            text: 'tw resume',
            timestamp: '2026-06-06T10:05:00.000Z',
            rowId: 80
          }
        ]
      }),
      getChat: () => chatRecord,
      saveChat: (updated) => {
        chatRecord = updated
      },
      dispatchRun,
      delivery,
      nowIso: () => '2026-06-06T10:06:00.000Z'
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({ commands: 1, dispatched: 1 })
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'codex',
        prompt: expect.stringContaining('User message:\nrun the failing check again'),
        appChatId: 'chat-1'
      })
    )
    expect(delivery.registerRunTarget).toHaveBeenCalledWith({
      appRunId: 'run-resumed',
      channel: 'imessage',
      bindingId: 'binding-1',
      accountId: 'mac-default',
      chatGuid: 'chat-guid',
      appChatId: 'chat-1',
      recipientHandle: 'user@example.com'
    })
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'resume',
        text: 'Resumed the latest retryable TaskWraith channel message with codex as run run-resumed.'
      })
    )
    expect(chatRecord.messages).toHaveLength(2)
    expect(chatRecord.messages[0].metadata).toMatchObject({
      channelDispatchStatus: 'dispatched',
      appRunId: 'run-resumed',
      channelResumedAt: '2026-06-06T10:06:00.000Z'
    })
    expect(chatRecord.messages[1].metadata).toMatchObject({
      channelDispatchStatus: 'handled-command',
      messageGuid: 'message-guid-resume'
    })
  })

  it('keeps resume local when no retryable channel message exists', async () => {
    const dispatchRun = vi.fn()
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
            messageGuid: 'message-guid-resume-empty',
            senderHandle: 'user@example.com',
            text: 'tw resume',
            timestamp: '2026-06-06T10:05:00.000Z',
            rowId: 80
          }
        ]
      }),
      getChat: () => chat(),
      saveChat: vi.fn(),
      dispatchRun,
      delivery
    })

    await service.pollOnce()

    expect(dispatchRun).not.toHaveBeenCalled()
    expect(delivery.registerRunTarget).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'resume',
        text: 'No retryable TaskWraith channel message is waiting for resume in this chat.'
      })
    )
  })

  it('hands off a channel prompt to a named provider through dispatchRun', async () => {
    let chatRecord = chat({
      provider: 'codex',
      linkedProviderSessionId: 'codex-session'
    })
    const auditRecords: Array<{
      kind: string
      payload?: Record<string, unknown>
    }> = []
    const dispatchRun = vi.fn(async () => ({ dispatched: true, appRunId: 'run-handoff' }))
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
            messageGuid: 'message-guid-handoff',
            senderHandle: 'user@example.com',
            text: 'tw handoff to gemini inspect the workspace',
            timestamp: '2026-06-06T10:05:30.000Z',
            rowId: 81
          }
        ]
      }),
      getChat: () => chatRecord,
      saveChat: (updated) => {
        chatRecord = updated
      },
      dispatchRun,
      delivery,
      auditStore: {
        append: vi.fn((record) => {
          auditRecords.push(record)
          return record as never
        })
      },
      nowIso: () => '2026-06-06T10:06:00.000Z'
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({ commands: 1, dispatched: 1 })
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gemini',
        providerSessionId: undefined,
        prompt: expect.stringContaining('User message:\ninspect the workspace')
      })
    )
    expect(delivery.registerRunTarget).toHaveBeenCalledWith({
      appRunId: 'run-handoff',
      channel: 'imessage',
      bindingId: 'binding-1',
      accountId: 'mac-default',
      chatGuid: 'chat-guid',
      appChatId: 'chat-1',
      recipientHandle: 'user@example.com'
    })
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'handoff_provider',
        text: 'Handed off to gemini as run run-handoff.'
      })
    )
    expect(chatRecord.messages).toHaveLength(1)
    expect(chatRecord.messages[0].metadata).toMatchObject({
      channelDispatchStatus: 'dispatched',
      appRunId: 'run-handoff',
      channelDispatchPrompt: 'inspect the workspace',
      channelHandoffProvider: 'gemini'
    })
    expect(auditRecords).toContainEqual(
      expect.objectContaining({
        kind: 'inbound_dispatched',
        appRunId: 'run-handoff',
        payload: expect.objectContaining({ provider: 'gemini' })
      })
    )
  })

  it('keeps bare provider handoff commands local until a prompt is supplied', async () => {
    const dispatchRun = vi.fn()
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
            messageGuid: 'message-guid-handoff-empty',
            senderHandle: 'user@example.com',
            text: 'tw handoff to codex',
            timestamp: '2026-06-06T10:05:40.000Z',
            rowId: 82
          }
        ]
      }),
      getChat: () => chat(),
      saveChat: vi.fn(),
      dispatchRun,
      delivery
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({ commands: 1, dispatched: 0 })
    expect(dispatchRun).not.toHaveBeenCalled()
    expect(delivery.registerRunTarget).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'handoff_provider',
        text: 'Add a prompt after the provider name, for example: handoff to codex run the tests.'
      })
    )
  })

  it('sends a regular file that resolves inside the linked workspace', async () => {
    const workspacePath = makeTempDir()
    mkdirSync(join(workspacePath, 'docs'))
    const filePath = join(workspacePath, 'docs', 'report.txt')
    writeFileSync(filePath, 'channel report\n')
    const realFilePath = realpathSync(filePath)
    const dispatchRun = vi.fn()
    const delivery = {
      registerRunTarget: vi.fn(),
      sendDirectReply: vi.fn(async () => ({ attempted: true, sent: true }))
    }
    const auditRecords: Array<{
      kind: string
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
            messageGuid: 'message-guid-send-file',
            senderHandle: 'user@example.com',
            text: 'tw send file docs/report.txt',
            timestamp: '2026-06-06T10:05:50.000Z',
            rowId: 83
          }
        ]
      }),
      getChat: () => chat({ workspacePath }),
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

    expect(summary).toMatchObject({ commands: 1, dispatched: 0 })
    expect(dispatchRun).not.toHaveBeenCalled()
    expect(delivery.registerRunTarget).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'send_file',
        text: 'Sending docs/report.txt.',
        attachmentPaths: expect.any(Array)
      })
    )
    const sendDirectReplyCalls = delivery.sendDirectReply.mock.calls as unknown as Array<
      [{ attachmentPaths?: string[] }]
    >
    const reply = sendDirectReplyCalls[0]?.[0]
    expect(reply?.attachmentPaths?.map((path) => realpathSync(path))).toEqual([realFilePath])
    expect(auditRecords).toContainEqual(
      expect.objectContaining({
        kind: 'inbound_dispatched',
        payload: expect.objectContaining({
          sendFile: expect.objectContaining({
            requestedPath: 'docs/report.txt',
            relativePath: 'docs/report.txt',
            allowed: true
          })
        })
      })
    )
  })

  it('blocks send file paths that resolve outside the linked workspace', async () => {
    const parentPath = makeTempDir()
    const workspacePath = join(parentPath, 'workspace')
    mkdirSync(workspacePath)
    const outsidePath = join(parentPath, 'outside-channel-file.txt')
    writeFileSync(outsidePath, 'outside\n')
    const dispatchRun = vi.fn()
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
            messageGuid: 'message-guid-send-file-outside',
            senderHandle: 'user@example.com',
            text: 'tw send file ../outside-channel-file.txt',
            timestamp: '2026-06-06T10:05:55.000Z',
            rowId: 84
          }
        ]
      }),
      getChat: () => chat({ workspacePath }),
      saveChat: vi.fn(),
      dispatchRun,
      delivery
    })

    await service.pollOnce()

    expect(dispatchRun).not.toHaveBeenCalled()
    expect(delivery.registerRunTarget).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'send_file',
        text: 'TaskWraith blocked that file because it resolves outside the linked workspace.'
      })
    )
    const blockedReply = (
      delivery.sendDirectReply.mock.calls as unknown as Array<[Record<string, unknown>]>
    )[0]?.[0]
    expect(blockedReply).not.toHaveProperty('attachmentPaths')
  })

  it('keeps send file local when the channel adapter has no outbound file support', async () => {
    const dispatchRun = vi.fn()
    const delivery = {
      registerRunTarget: vi.fn(),
      sendDirectReply: vi.fn(async () => ({ attempted: true, sent: true }))
    }
    const service = new MessageChannelGatewayService({
      bindingStore: {
        findByConversation: () => [telegramBinding()],
        list: () => [telegramBinding()]
      },
      pollMessages: async () => ({
        ok: true,
        channel: 'telegram' as const,
        accountId: 'telegram-bot',
        databasePath: 'telegram:getUpdates',
        messages: [
          {
            channel: 'telegram' as const,
            accountId: 'telegram-bot',
            chatGuid: 'telegram:123456',
            messageGuid: 'telegram:101:7',
            senderHandle: 'telegram-user:42',
            text: 'tw send file docs/report.txt',
            timestamp: '2026-06-07T10:01:00.000Z',
            rowId: 101
          }
        ]
      }),
      getChat: () => chat(),
      saveChat: vi.fn(),
      dispatchRun,
      delivery
    })

    await service.pollOnce()

    expect(dispatchRun).not.toHaveBeenCalled()
    expect(delivery.registerRunTarget).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'send_file',
        text: 'Telegram does not support outbound file attachments yet.'
      })
    )
  })

  it('replies to show diff with a compact read-only file summary', async () => {
    const dispatchRun = vi.fn()
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
            messageGuid: 'message-guid-show-diff',
            senderHandle: 'user@example.com',
            text: 'tw show diff',
            timestamp: '2026-06-06T10:05:30.000Z',
            rowId: 81
          }
        ]
      }),
      getChat: () =>
        chat({
          runs: [
            {
              runId: 'run-diff-123456789',
              startedAt: '2026-06-06T10:00:00.000Z',
              status: 'success',
              runDiff: {
                runId: 'run-diff-123456789',
                preSnapshot: { capturedAt: '2026-06-06T09:59:00.000Z', isGitRepo: true },
                createdFiles: [
                  { path: 'README.md', status: 'created', additions: 3, previewKind: 'git_diff' }
                ],
                modifiedFiles: [
                  {
                    path: 'src/app.ts',
                    status: 'modified',
                    additions: 2,
                    deletions: 1,
                    previewKind: 'git_diff'
                  }
                ],
                deletedFiles: [],
                preExistingFiles: []
              }
            } as any
          ]
        }),
      saveChat: vi.fn(),
      dispatchRun,
      delivery
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({ commands: 1, dispatched: 0 })
    expect(dispatchRun).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'show_diff',
        text: expect.stringContaining('2 files changed, +5 / -1')
      })
    )
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('created README.md')
      })
    )
  })

  it('replies to open thread with a compact desktop thread locator', async () => {
    const dispatchRun = vi.fn()
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
            messageGuid: 'message-guid-open-thread',
            senderHandle: 'user@example.com',
            text: 'tw open thread',
            timestamp: '2026-06-06T10:05:45.000Z',
            rowId: 82
          }
        ]
      }),
      getChat: () =>
        chat({
          title: 'Mobile Operator',
          workspacePath: '/Users/me/Repo',
          runs: [
            {
              runId: 'run-open-thread',
              startedAt: '2026-06-06T10:00:00.000Z',
              status: 'active'
            } as any
          ]
        }),
      saveChat: vi.fn(),
      dispatchRun,
      delivery
    })

    const summary = await service.pollOnce()

    expect(summary).toMatchObject({ commands: 1, dispatched: 0 })
    expect(dispatchRun).not.toHaveBeenCalled()
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'open_thread',
        text: expect.stringContaining('Thread: Mobile Operator.')
      })
    )
    expect(delivery.sendDirectReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Workspace: Repo.')
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
        summary: 'Channel adapter poll failed.',
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
      channel: 'imessage',
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
