import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MessageChannelBindingStore } from './MessageChannelBindingStore'

describe('MessageChannelBindingStore', () => {
  let tmpDir: string
  let storagePath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'message-channel-bindings-'))
    storagePath = join(tmpDir, 'bindings.json')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates and persists an iMessage binding', () => {
    const store = new MessageChannelBindingStore({
      storagePath,
      now: () => new Date('2026-06-06T10:00:00.000Z'),
      createId: () => 'binding-1'
    })

    const binding = store.upsert({
      channel: 'imessage',
      accountId: 'mac-default',
      chatGuid: 'iMessage;-;chat-abc',
      allowedHandles: ['USER@EXAMPLE.COM', 'user@example.com'],
      appChatId: 'chat-1',
      workspaceId: 'workspace-1',
      provider: 'codex',
      label: 'Operator'
    })

    expect(binding).toMatchObject({
      id: 'binding-1',
      channel: 'imessage',
      accountId: 'mac-default',
      chatGuid: 'iMessage;-;chat-abc',
      allowedHandles: ['user@example.com'],
      appChatId: 'chat-1',
      workspaceId: 'workspace-1',
      provider: 'codex',
      mode: 'operator',
      requireTrigger: true,
      triggerPrefix: 'tw',
      createdAt: '2026-06-06T10:00:00.000Z',
      updatedAt: '2026-06-06T10:00:00.000Z'
    })

    const reloaded = new MessageChannelBindingStore({ storagePath })
    expect(reloaded.get('binding-1')?.allowedHandles).toEqual(['user@example.com'])
  })

  it('updates existing bindings while preserving createdAt', () => {
    let now = new Date('2026-06-06T10:00:00.000Z')
    const store = new MessageChannelBindingStore({
      storagePath,
      now: () => now,
      createId: () => 'binding-1'
    })
    store.upsert({
      channel: 'imessage',
      accountId: 'mac-default',
      chatGuid: 'chat-guid',
      allowedHandles: ['+15555550100'],
      appChatId: 'chat-1',
      provider: 'gemini'
    })

    now = new Date('2026-06-06T10:30:00.000Z')
    const updated = store.upsert({
      id: 'binding-1',
      channel: 'imessage',
      accountId: 'mac-default',
      chatGuid: 'chat-guid',
      allowedHandles: ['+15555550100'],
      appChatId: 'chat-2',
      provider: 'claude'
    })

    expect(updated.createdAt).toBe('2026-06-06T10:00:00.000Z')
    expect(updated.updatedAt).toBe('2026-06-06T10:30:00.000Z')
    expect(updated.appChatId).toBe('chat-2')
    expect(updated.provider).toBe('claude')
    expect(updated.requireTrigger).toBe(true)
  })

  it('rejects wildcard allowed handles', () => {
    const store = new MessageChannelBindingStore({ storagePath, createId: () => 'binding-1' })

    expect(() =>
      store.upsert({
        channel: 'imessage',
        accountId: 'mac-default',
        chatGuid: 'chat-guid',
        allowedHandles: ['*'],
        appChatId: 'chat-1',
        provider: 'codex'
      })
    ).toThrow(/wildcard/i)
  })

  it('rejects multiple allowed handles for the operator MVP', () => {
    const store = new MessageChannelBindingStore({ storagePath, createId: () => 'binding-1' })

    expect(() =>
      store.upsert({
        channel: 'imessage',
        accountId: 'mac-default',
        chatGuid: 'chat-guid',
        allowedHandles: ['+15555550100', 'user@example.com'],
        appChatId: 'chat-1',
        provider: 'codex'
      })
    ).toThrow(/exactly one operator handle/i)
  })

  it('rejects group iMessage chat GUIDs for the operator MVP', () => {
    const store = new MessageChannelBindingStore({ storagePath, createId: () => 'binding-1' })

    expect(() =>
      store.upsert({
        channel: 'imessage',
        accountId: 'mac-default',
        chatGuid: 'iMessage;+;group-chat-guid',
        allowedHandles: ['+15555550100'],
        appChatId: 'chat-1',
        provider: 'codex'
      })
    ).toThrow(/one-to-one operator/i)
  })

  it('rejects non-iMessage channel bindings at runtime', () => {
    const store = new MessageChannelBindingStore({ storagePath, createId: () => 'binding-1' })

    expect(() =>
      store.upsert({
        channel: 'telegram' as never,
        accountId: 'mac-default',
        chatGuid: 'chat-guid',
        allowedHandles: ['+15555550100'],
        appChatId: 'chat-1',
        provider: 'codex'
      })
    ).toThrow(/imessage channel/i)
  })

  it('rejects unknown providers at runtime', () => {
    const store = new MessageChannelBindingStore({ storagePath, createId: () => 'binding-1' })

    expect(() =>
      store.upsert({
        channel: 'imessage',
        accountId: 'mac-default',
        chatGuid: 'chat-guid',
        allowedHandles: ['+15555550100'],
        appChatId: 'chat-1',
        provider: 'open-ended-provider' as never
      })
    ).toThrow(/provider/i)
  })

  it('rejects bindings that disable the trigger requirement', () => {
    const store = new MessageChannelBindingStore({ storagePath, createId: () => 'binding-1' })

    expect(() =>
      store.upsert({
        channel: 'imessage',
        accountId: 'mac-default',
        chatGuid: 'chat-guid',
        allowedHandles: ['+15555550100'],
        appChatId: 'chat-1',
        provider: 'codex',
        requireTrigger: false
      })
    ).toThrow(/trigger/i)
  })

  it('rejects non-operator binding modes for the MVP', () => {
    const store = new MessageChannelBindingStore({ storagePath, createId: () => 'binding-1' })

    expect(() =>
      store.upsert({
        channel: 'imessage',
        accountId: 'mac-default',
        chatGuid: 'chat-guid',
        allowedHandles: ['+15555550100'],
        appChatId: 'chat-1',
        provider: 'codex',
        mode: 'group'
      })
    ).toThrow(/operator/i)
  })

  it('finds active bindings by exact channel account and chat guid', () => {
    const store = new MessageChannelBindingStore({ storagePath, createId: () => 'binding-1' })
    store.upsert({
      channel: 'imessage',
      accountId: 'mac-default',
      chatGuid: 'chat-guid',
      allowedHandles: ['+15555550100'],
      appChatId: 'chat-1',
      provider: 'codex'
    })

    expect(
      store.findByConversation({
        channel: 'imessage',
        accountId: 'mac-default',
        chatGuid: 'chat-guid'
      })
    ).toHaveLength(1)
    expect(
      store.findByConversation({
        channel: 'imessage',
        accountId: 'mac-default',
        chatGuid: 'other-chat'
      })
    ).toHaveLength(0)
  })

  it('archives bindings without deleting their audit-relevant record', () => {
    const store = new MessageChannelBindingStore({ storagePath, createId: () => 'binding-1' })
    store.upsert({
      channel: 'imessage',
      accountId: 'mac-default',
      chatGuid: 'chat-guid',
      allowedHandles: ['+15555550100'],
      appChatId: 'chat-1',
      provider: 'codex'
    })

    expect(store.archive('binding-1')?.archived).toBe(true)
    expect(store.list()).toHaveLength(0)
    expect(store.list({ includeArchived: true })).toHaveLength(1)
  })

  it('starts empty when the file is malformed', () => {
    writeFileSync(storagePath, '{not json', 'utf8')
    const store = new MessageChannelBindingStore({ storagePath })
    expect(store.list()).toEqual([])
  })

  it('drops stored bindings with unknown providers', () => {
    writeFileSync(
      storagePath,
      JSON.stringify({
        version: 1,
        bindings: [
          {
            id: 'binding-1',
            channel: 'imessage',
            accountId: 'mac-default',
            chatGuid: 'chat-guid',
            allowedHandles: ['+15555550100'],
            appChatId: 'chat-1',
            provider: 'unknown-provider',
            createdAt: '2026-06-06T10:00:00.000Z',
            updatedAt: '2026-06-06T10:00:00.000Z'
          }
        ]
      }),
      'utf8'
    )
    const store = new MessageChannelBindingStore({ storagePath })
    expect(store.list({ includeArchived: true })).toEqual([])
  })

  it('drops stored bindings with multiple allowed handles', () => {
    writeFileSync(
      storagePath,
      JSON.stringify({
        version: 1,
        bindings: [
          {
            id: 'binding-1',
            channel: 'imessage',
            accountId: 'mac-default',
            chatGuid: 'chat-guid',
            allowedHandles: ['+15555550100', 'user@example.com'],
            appChatId: 'chat-1',
            provider: 'codex',
            createdAt: '2026-06-06T10:00:00.000Z',
            updatedAt: '2026-06-06T10:00:00.000Z'
          }
        ]
      }),
      'utf8'
    )
    const store = new MessageChannelBindingStore({ storagePath })
    expect(store.list({ includeArchived: true })).toEqual([])
  })

  it('drops stored bindings missing required conversation scope', () => {
    writeFileSync(
      storagePath,
      JSON.stringify({
        version: 1,
        bindings: [
          {
            id: 'empty-chat-guid',
            channel: 'imessage',
            accountId: 'mac-default',
            chatGuid: '',
            allowedHandles: ['+15555550100'],
            appChatId: 'chat-1',
            provider: 'codex',
            createdAt: '2026-06-06T10:00:00.000Z',
            updatedAt: '2026-06-06T10:00:00.000Z'
          },
          {
            id: 'empty-app-chat',
            channel: 'imessage',
            accountId: 'mac-default',
            chatGuid: 'chat-guid',
            allowedHandles: ['+15555550100'],
            appChatId: ' ',
            provider: 'codex',
            createdAt: '2026-06-06T10:00:00.000Z',
            updatedAt: '2026-06-06T10:00:00.000Z'
          }
        ]
      }),
      'utf8'
    )
    const store = new MessageChannelBindingStore({ storagePath })
    expect(store.list({ includeArchived: true })).toEqual([])
  })

  it('drops stored non-operator bindings instead of silently normalizing them', () => {
    writeFileSync(
      storagePath,
      JSON.stringify({
        version: 1,
        bindings: [
          {
            id: 'binding-1',
            channel: 'imessage',
            accountId: 'mac-default',
            chatGuid: 'chat-guid',
            allowedHandles: ['+15555550100'],
            appChatId: 'chat-1',
            provider: 'codex',
            mode: 'group',
            createdAt: '2026-06-06T10:00:00.000Z',
            updatedAt: '2026-06-06T10:00:00.000Z'
          }
        ]
      }),
      'utf8'
    )
    const store = new MessageChannelBindingStore({ storagePath })
    expect(store.list({ includeArchived: true })).toEqual([])
  })
})
