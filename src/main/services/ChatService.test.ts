import { describe, expect, it, vi } from 'vitest'
import { ChatService, type ChatServiceDeps, type ChatServiceStore } from './ChatService'
import type { ChatRecord, ProviderId, WorkspaceRecord } from '../store/types'

function makeChat(overrides: Partial<ChatRecord> = {}): ChatRecord {
  return {
    appChatId: 'chat-1',
    scope: 'workspace',
    provider: 'gemini',
    title: 'Chat',
    workspaceId: 'workspace-1',
    workspacePath: '/repo',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    messages: [],
    runs: [],
    ...overrides
  }
}

function makeWorkspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: 'workspace-1',
    path: '/repo',
    displayName: 'repo',
    createdAt: 1,
    lastOpenedAt: 1,
    pinned: false,
    ...overrides
  }
}

function makeStore(overrides: Partial<ChatServiceStore> = {}): ChatServiceStore {
  return {
    getChats: vi.fn(() => [makeChat()]),
    getChat: vi.fn(() => makeChat()),
    createChat: vi.fn((workspaceId: string, workspacePath: string) =>
      makeChat({ workspaceId, workspacePath })
    ),
    createGlobalChat: vi.fn(() =>
      makeChat({ scope: 'global', workspaceId: undefined, workspacePath: undefined })
    ),
    createEnsembleChat: vi.fn((args) =>
      makeChat({
        appChatId: 'ensemble-1',
        chatKind: 'ensemble',
        title: 'New Ensemble',
        scope: args?.workspaceId ? 'workspace' : 'global',
        workspaceId: args?.workspaceId,
        workspacePath: args?.workspacePath
      })
    ),
    createSubThread: vi.fn((args) =>
      makeChat({
        appChatId: 'sub-thread-1',
        provider: args.provider,
        parentChatId: args.parentChatId,
        delegationContext: {
          createdAt: 2,
          parentProvider: 'gemini',
          delegationPrompt: args.delegationPrompt,
          returnResultToParent: args.returnResultToParent
        }
      })
    ),
    getChildChats: vi.fn(() => [makeChat({ appChatId: 'sub-thread-1', parentChatId: 'chat-1' })]),
    saveChat: vi.fn(),
    deleteChat: vi.fn(),
    clearChats: vi.fn(),
    ...overrides
  }
}

function makeDeps(overrides: Partial<ChatServiceDeps> = {}): {
  deps: ChatServiceDeps
  store: ChatServiceStore
} {
  const store = makeStore()
  const deps: ChatServiceDeps = {
    appStore: store,
    findRegisteredWorkspace: vi.fn(() => makeWorkspace()),
    canonicalPath: vi.fn((value: string) => `/canonical${value}`),
    sanitizeChatForSave: vi.fn((chat: ChatRecord) => ({ ...chat, title: chat.title.trim() })),
    appendDurableRunEventForRoute: vi.fn(),
    ...overrides
  }
  return { deps, store: deps.appStore }
}

describe('ChatService', () => {
  it('forwards getChats workspace filters to the store', () => {
    const { deps, store } = makeDeps()
    const service = new ChatService(deps)
    expect(service.getChats('workspace-1')).toEqual([makeChat()])
    expect(store.getChats).toHaveBeenCalledWith('workspace-1')
  })

  it('creates workspace chats only for a matching registered workspace', () => {
    const { deps, store } = makeDeps()
    const service = new ChatService(deps)
    const chat = service.createChat('workspace-1', '/repo')
    expect(chat.workspacePath).toBe('/canonical/repo')
    expect(deps.findRegisteredWorkspace).toHaveBeenCalledWith('/repo')
    expect(deps.canonicalPath).toHaveBeenCalledWith('/repo')
    expect(store.createChat).toHaveBeenCalledWith('workspace-1', '/canonical/repo')
  })

  it('throws the original validation error for unregistered chat workspaces', () => {
    const { deps, store } = makeDeps({
      findRegisteredWorkspace: vi.fn(() => undefined)
    })
    const service = new ChatService(deps)
    expect(() => service.createChat('workspace-1', '/missing')).toThrow(
      'Chat workspace must be a registered AGBench workspace.'
    )
    expect(store.createChat).not.toHaveBeenCalled()
  })

  it('sanitizes chats before saving', () => {
    const { deps, store } = makeDeps()
    const service = new ChatService(deps)
    service.saveChat(makeChat({ title: '  Needs trim  ' }))
    expect(deps.sanitizeChatForSave).toHaveBeenCalledTimes(1)
    expect(store.saveChat).toHaveBeenCalledWith(makeChat({ title: 'Needs trim' }))
  })

  it('creates sub-threads and writes the same best-effort audit event', () => {
    const { deps, store } = makeDeps()
    const service = new ChatService(deps)
    const subThread = service.createSubThread({
      parentChatId: 'chat-1',
      provider: 'codex',
      delegationPrompt: 'Investigate this',
      returnResultToParent: true
    })
    expect(subThread.appChatId).toBe('sub-thread-1')
    expect(store.createSubThread).toHaveBeenCalledWith({
      parentChatId: 'chat-1',
      provider: 'codex',
      delegationPrompt: 'Investigate this',
      returnResultToParent: true,
      workspaceId: undefined,
      workspacePath: undefined
    })
    expect(deps.appendDurableRunEventForRoute).toHaveBeenCalledWith(
      'gemini',
      { appChatId: 'chat-1' },
      'subthread_spawned',
      'control',
      'Delegated to codex sub-thread',
      {
        subThreadId: 'sub-thread-1',
        provider: 'codex',
        delegationPrompt: 'Investigate this',
        returnResultToParent: true
      }
    )
  })

  it('creates workspace ensemble chats only for a matching registered workspace', () => {
    const { deps, store } = makeDeps()
    const service = new ChatService(deps)
    const chat = service.createEnsembleChat({ workspaceId: 'workspace-1', workspacePath: '/repo' })
    expect(chat.chatKind).toBe('ensemble')
    expect(store.createEnsembleChat).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      workspacePath: '/canonical/repo'
    })
  })

  it('lets AppStore max-depth validation errors propagate without auditing', () => {
    const maxDepthError = new Error(
      'Cannot create sub-thread: parent chat-1 is itself a sub-thread (max depth 1 in v1)'
    )
    const store = makeStore({
      createSubThread: vi.fn(() => {
        throw maxDepthError
      })
    })
    const { deps } = makeDeps({ appStore: store })
    const service = new ChatService(deps)
    expect(() =>
      service.createSubThread({
        parentChatId: 'chat-1',
        provider: 'claude',
        delegationPrompt: 'Delegate',
        returnResultToParent: false
      })
    ).toThrow(maxDepthError)
    expect(deps.appendDurableRunEventForRoute).not.toHaveBeenCalled()
  })

  it('keeps sub-thread creation successful when the audit write fails', () => {
    const { deps } = makeDeps({
      appendDurableRunEventForRoute: vi.fn(() => {
        throw new Error('no active run')
      })
    })
    const service = new ChatService(deps)
    expect(
      service.createSubThread({
        parentChatId: 'chat-1',
        provider: 'kimi',
        delegationPrompt: 'Delegate',
        returnResultToParent: false
      }).appChatId
    ).toBe('sub-thread-1')
  })

  it('validates sub-thread provider and parent id like the original handler', () => {
    const { deps, store } = makeDeps()
    const service = new ChatService(deps)
    expect(() =>
      service.createSubThread({
        parentChatId: '',
        provider: 'codex',
        delegationPrompt: 'Prompt',
        returnResultToParent: false
      })
    ).toThrow('Parent chat id is required.')
    expect(() =>
      service.createSubThread({
        parentChatId: 'chat-1',
        provider: 'bad-provider' as ProviderId,
        delegationPrompt: 'Prompt',
        returnResultToParent: false
      })
    ).toThrow('Provider is invalid.')
    expect(store.createSubThread).not.toHaveBeenCalled()
  })

  it('validates getSubThreads parent id before reading children', () => {
    const { deps, store } = makeDeps()
    const service = new ChatService(deps)
    expect(() => service.getSubThreads('')).toThrow('Parent chat id is required.')
    expect(store.getChildChats).not.toHaveBeenCalled()
    service.getSubThreads('chat-1')
    expect(store.getChildChats).toHaveBeenCalledWith('chat-1')
  })
})
