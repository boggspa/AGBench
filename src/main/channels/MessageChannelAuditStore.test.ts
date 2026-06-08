import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MessageChannelAuditStore } from './MessageChannelAuditStore'

describe('MessageChannelAuditStore', () => {
  let tmpDir: string
  let storagePath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'message-channel-audit-'))
    storagePath = join(tmpDir, 'audit.ndjson')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('appends and reads recent audit records', () => {
    let id = 0
    const store = new MessageChannelAuditStore({
      storagePath,
      now: () => new Date('2026-06-06T10:00:00.000Z'),
      createId: () => `audit-${++id}`
    })

    store.append({
      kind: 'inbound_rejected',
      channel: 'imessage',
      accountId: 'mac-default',
      chatGuid: 'chat-guid',
      messageGuid: 'msg-1',
      senderHandle: 'user@example.com',
      summary: 'trigger-required'
    })
    store.append({
      kind: 'outbound_sent',
      channel: 'telegram',
      accountId: 'telegram-bot',
      chatGuid: 'telegram:123',
      bindingId: 'binding-1',
      appRunId: 'run-1',
      summary: 'Sent assistant reply'
    })

    expect(store.list()).toEqual([
      expect.objectContaining({
        id: 'audit-1',
        kind: 'inbound_rejected',
        timestamp: '2026-06-06T10:00:00.000Z'
      }),
      expect.objectContaining({
        id: 'audit-2',
        kind: 'outbound_sent',
        channel: 'telegram',
        appRunId: 'run-1'
      })
    ])
    expect(store.list({ limit: 1 })).toEqual([
      expect.objectContaining({ id: 'audit-2', kind: 'outbound_sent' })
    ])
  })
})
