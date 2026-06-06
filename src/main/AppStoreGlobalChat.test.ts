import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import { join } from 'path'
import { AppStore } from './store'
import type { ChatRecord } from './store/types'

const userDataPath = vi.hoisted(() => `/tmp/taskwraith-global-chat-test-${process.pid}`)

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataPath
  }
}))

describe('AppStore global chats', () => {
  beforeEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true })
    fs.mkdirSync(join(userDataPath, 'chats'), { recursive: true })
  })

  it('creates, saves, and loads global chats without workspace fields', () => {
    const chat = AppStore.createGlobalChat()

    expect(chat.scope).toBe('global')
    expect(chat.workspaceId).toBeUndefined()
    expect(chat.workspacePath).toBeUndefined()

    AppStore.saveChat({
      ...chat,
      title: 'Planning',
      workspaceId: 'forged-workspace',
      workspacePath: '/tmp/forged-workspace',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          content: 'Search and plan.',
          timestamp: '2026-05-08T00:00:00.000Z'
        }
      ]
    } as ChatRecord)

    const loaded = AppStore.getChat(chat.appChatId)
    expect(loaded).toMatchObject({
      appChatId: chat.appChatId,
      scope: 'global',
      title: 'Planning'
    })
    expect(loaded?.workspaceId).toBeUndefined()
    expect(loaded?.workspacePath).toBeUndefined()
    expect(loaded?.messages).toHaveLength(1)
  })

  it('defaults legacy chats to workspace scope', () => {
    const workspaceChat = AppStore.normalizeChatRecord({
      appChatId: 'legacy-chat',
      provider: 'gemini',
      title: 'Legacy',
      workspaceId: 'workspace-1',
      workspacePath: '/repo',
      createdAt: 1,
      updatedAt: 1,
      archived: false,
      messages: [],
      runs: []
    })

    expect(workspaceChat.scope).toBe('workspace')
    expect(workspaceChat.workspacePath).toBe('/repo')
  })

  it('keeps chat ids inside the chat persistence directory', () => {
    const settingsPath = join(userDataPath, 'settings.json')
    fs.writeFileSync(settingsPath, '{"sentinel":true}', 'utf8')

    expect(AppStore.getChat('../settings')).toBeNull()
    expect(() =>
      AppStore.saveChat({
        appChatId: '../settings',
        scope: 'global',
        provider: 'gemini',
        title: 'Traversal',
        createdAt: 1,
        updatedAt: 1,
        archived: false,
        messages: [],
        runs: []
      } as ChatRecord)
    ).toThrow(/safe chat id/)
    expect(() => AppStore.deleteChat('../settings')).toThrow(/safe chat id/)
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe('{"sentinel":true}')
  })
})
