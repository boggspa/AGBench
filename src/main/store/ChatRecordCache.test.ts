import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import { join } from 'path'
import { AppStore } from './index'
import type { ChatRecord } from './types'

const userDataPath = vi.hoisted(() => `/tmp/taskwraith-chat-cache-test-${process.pid}`)

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataPath
  }
}))

const chatsDir = join(userDataPath, 'chats')

function diskPath(chatId: string): string {
  return join(chatsDir, `${chatId}.json`)
}

describe('AppStore chat record cache', () => {
  beforeEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true })
    fs.mkdirSync(chatsDir, { recursive: true })
  })

  it('repeat reads return the cached instance instead of re-parsing', () => {
    const chat = AppStore.createChat('ws-1', '/repo')
    const first = AppStore.getChat(chat.appChatId)
    const second = AppStore.getChat(chat.appChatId)
    expect(first).not.toBeNull()
    expect(second).toBe(first)

    // The sweep shares the same cache — same instance, not a re-parse.
    const swept = AppStore.getChats().find((c) => c.appChatId === chat.appChatId)
    expect(swept).toBe(first)
  })

  it('saveChat writes through: the next read is the saved record, no stale data', () => {
    const chat = AppStore.createChat('ws-1', '/repo')
    const before = AppStore.getChat(chat.appChatId)
    AppStore.saveChat({ ...chat, title: 'Renamed' } as ChatRecord)
    const after = AppStore.getChat(chat.appChatId)
    expect(after?.title).toBe('Renamed')
    expect(after).not.toBe(before)
    // Disk agrees (write-through, not cache-only).
    const onDisk = JSON.parse(fs.readFileSync(diskPath(chat.appChatId), 'utf-8'))
    expect(onDisk.title).toBe('Renamed')
  })

  it('an out-of-band file change invalidates via mtime/size and re-parses', () => {
    const chat = AppStore.createChat('ws-1', '/repo')
    const cached = AppStore.getChat(chat.appChatId)
    expect(cached?.title).toBe('New Chat')

    const raw = JSON.parse(fs.readFileSync(diskPath(chat.appChatId), 'utf-8'))
    raw.title = 'Edited outside the store'
    fs.writeFileSync(diskPath(chat.appChatId), JSON.stringify(raw))

    const reread = AppStore.getChat(chat.appChatId)
    expect(reread?.title).toBe('Edited outside the store')
    expect(reread).not.toBe(cached)
  })

  it('deleteChat drops the cache entry with the file', () => {
    const chat = AppStore.createChat('ws-1', '/repo')
    expect(AppStore.getChat(chat.appChatId)).not.toBeNull()
    AppStore.deleteChat(chat.appChatId)
    expect(AppStore.getChat(chat.appChatId)).toBeNull()
    expect(AppStore.getChats().some((c) => c.appChatId === chat.appChatId)).toBe(false)
  })

  it('a chat deleted out-of-band disappears from reads', () => {
    const chat = AppStore.createChat('ws-1', '/repo')
    expect(AppStore.getChat(chat.appChatId)).not.toBeNull()
    fs.unlinkSync(diskPath(chat.appChatId))
    expect(AppStore.getChat(chat.appChatId)).toBeNull()
    expect(AppStore.getChats().some((c) => c.appChatId === chat.appChatId)).toBe(false)
  })

  it('workspace filtering still applies on the cached sweep', () => {
    const a = AppStore.createChat('ws-a', '/repo-a')
    const b = AppStore.createChat('ws-b', '/repo-b')
    const wsA = AppStore.getChats('ws-a')
    expect(wsA.map((c) => c.appChatId)).toContain(a.appChatId)
    expect(wsA.map((c) => c.appChatId)).not.toContain(b.appChatId)
  })
})
