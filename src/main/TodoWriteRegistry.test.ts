import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearChatTodoList,
  getChatTodoList,
  handleChatTodoWrite,
  resetTodoWriteRegistryForTests
} from './TodoWriteRegistry'

describe('TodoWriteRegistry', () => {
  beforeEach(() => {
    resetTodoWriteRegistryForTests()
  })

  it('merges per-chat todo state when merge is true', () => {
    handleChatTodoWrite('chat-1', [{ id: '1', content: 'Plan', status: 'pending' }], false)
    const merged = handleChatTodoWrite(
      'chat-1',
      [{ id: '1', content: 'Plan', status: 'completed' }],
      true
    )
    expect(merged).toEqual([{ id: '1', content: 'Plan', status: 'completed' }])
    expect(getChatTodoList('chat-1')).toEqual(merged)
  })

  it('replaces per-chat todo state when merge is false', () => {
    handleChatTodoWrite('chat-1', [{ id: '1', content: 'Old', status: 'pending' }], false)
    handleChatTodoWrite('chat-1', [{ id: '2', content: 'New', status: 'pending' }], false)
    expect(getChatTodoList('chat-1')).toEqual([{ id: '2', content: 'New', status: 'pending' }])
  })

  it('clears chat state', () => {
    handleChatTodoWrite('chat-1', [{ id: '1', content: 'Plan', status: 'pending' }], false)
    clearChatTodoList('chat-1')
    expect(getChatTodoList('chat-1')).toEqual([])
  })
})
