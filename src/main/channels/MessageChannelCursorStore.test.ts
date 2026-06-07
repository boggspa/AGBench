import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MessageChannelCursorStore } from './MessageChannelCursorStore'

describe('MessageChannelCursorStore', () => {
  let tmpDir: string
  let storagePath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'message-channel-cursors-'))
    storagePath = join(tmpDir, 'cursors.json')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('persists cursor updates per conversation', () => {
    const store = new MessageChannelCursorStore({
      storagePath,
      now: () => new Date('2026-06-06T10:00:00.000Z')
    })
    store.update({ channel: 'imessage', accountId: 'mac-default', chatGuid: 'chat-guid' }, 42)

    const reloaded = new MessageChannelCursorStore({ storagePath })
    expect(
      reloaded.get({ channel: 'imessage', accountId: 'mac-default', chatGuid: 'chat-guid' })
    ).toMatchObject({
      lastRowId: 42,
      updatedAt: '2026-06-06T10:00:00.000Z'
    })
  })

  it('never moves a cursor backwards', () => {
    const store = new MessageChannelCursorStore({ storagePath })
    const key = { channel: 'imessage' as const, accountId: 'mac-default', chatGuid: 'chat-guid' }
    store.update(key, 100)
    store.update(key, 80)
    expect(store.get(key)?.lastRowId).toBe(100)
  })

  it('clears one conversation cursor without clearing others', () => {
    const store = new MessageChannelCursorStore({ storagePath })
    const first = { channel: 'imessage' as const, accountId: 'mac-default', chatGuid: 'chat-1' }
    const second = { channel: 'imessage' as const, accountId: 'mac-default', chatGuid: 'chat-2' }
    store.update(first, 10)
    store.update(second, 20)

    store.clear(first)

    expect(store.get(first)).toBeNull()
    expect(store.get(second)?.lastRowId).toBe(20)
  })

  it('starts empty when the file is malformed', () => {
    writeFileSync(storagePath, '{not json', 'utf8')
    const store = new MessageChannelCursorStore({ storagePath })
    expect(store.list()).toEqual([])
  })
})
