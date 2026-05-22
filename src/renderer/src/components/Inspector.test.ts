import { describe, expect, it } from 'vitest'
import { buildDelegationTree } from './Inspector'
import type { ChatRecord } from '../../../main/store/types'

function makeChat(overrides: Partial<ChatRecord> & Pick<ChatRecord, 'appChatId'>): ChatRecord {
  const { appChatId, ...rest } = overrides
  return {
    appChatId,
    scope: 'workspace',
    provider: 'gemini',
    title: `Chat ${appChatId}`,
    workspaceId: 'ws',
    workspacePath: '/repo',
    createdAt: 0,
    updatedAt: 0,
    archived: false,
    messages: [],
    runs: [],
    ...rest
  }
}

describe('buildDelegationTree', () => {
  it('returns null when no focus chat id is provided', () => {
    const chats = [makeChat({ appChatId: 'root' })]
    expect(buildDelegationTree(chats)).toBeNull()
  })

  it('returns null when focus id does not match any chat', () => {
    const chats = [makeChat({ appChatId: 'root' })]
    expect(buildDelegationTree(chats, 'missing')).toBeNull()
  })

  it('walks up to the root and nests descendants in createdAt order', () => {
    const chats: ChatRecord[] = [
      makeChat({ appChatId: 'root', createdAt: 1 }),
      makeChat({ appChatId: 'sub-a', parentChatId: 'root', createdAt: 3, provider: 'kimi' }),
      makeChat({ appChatId: 'sub-b', parentChatId: 'root', createdAt: 2, provider: 'codex' }),
      makeChat({ appChatId: 'leaf', parentChatId: 'sub-a', createdAt: 4, provider: 'claude' })
    ]

    const tree = buildDelegationTree(chats, 'leaf')
    expect(tree?.chat.appChatId).toBe('root')
    expect(tree?.children.map((c) => c.chat.appChatId)).toEqual(['sub-b', 'sub-a'])
    const subA = tree?.children.find((c) => c.chat.appChatId === 'sub-a')
    expect(subA?.children).toHaveLength(1)
    expect(subA?.children[0].chat.appChatId).toBe('leaf')
    expect(subA?.children[0].isCurrent).toBe(true)
  })

  it('handles a chat that is its own root with no children', () => {
    const chats = [makeChat({ appChatId: 'solo' })]
    const tree = buildDelegationTree(chats, 'solo')
    expect(tree?.chat.appChatId).toBe('solo')
    expect(tree?.children).toEqual([])
    expect(tree?.isCurrent).toBe(true)
  })
})
