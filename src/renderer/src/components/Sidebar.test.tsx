import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatRecord, WorkspaceRecord } from '../../../main/store/types'
import { Sidebar } from './Sidebar'

const EXPANDED_WORKSPACES_STORAGE_KEY = 'guigemini-sidebar-expanded-workspace-ids'
const COLLAPSED_SUB_THREAD_PARENTS_STORAGE_KEY = 'guigemini-sidebar-collapsed-sub-thread-parent-ids'

function makeWorkspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: 'ws-1',
    path: '/repo',
    displayName: 'Repo',
    lastOpenedAt: 1,
    createdAt: 1,
    pinned: false,
    ...overrides
  }
}

function makeChat(overrides: Partial<ChatRecord> = {}): ChatRecord {
  return {
    appChatId: 'parent-1',
    scope: 'workspace',
    provider: 'gemini',
    title: 'Parent thread',
    workspaceId: 'ws-1',
    workspacePath: '/repo',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    pinned: false,
    messages: [],
    runs: [],
    ...overrides
  }
}

function stubSidebarStorage(values: Record<string, string>) {
  const store = new Map(Object.entries(values))
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    }),
    clear: vi.fn(() => {
      store.clear()
    })
  })
}

function renderSidebar(chats: ChatRecord[]) {
  const workspace = makeWorkspace()
  return renderToStaticMarkup(
    <Sidebar
      workspaces={[workspace]}
      currentWorkspace={workspace}
      chats={chats}
      currentChat={chats[0] ?? null}
      currentRun={null}
      usageSummary={[]}
      runningChatIds={[]}
      onSelectWorkspace={() => {}}
      onRemoveWorkspace={() => {}}
      onSelectWorkspaceDialog={() => {}}
      onNewChat={() => {}}
      onNewGlobalChat={() => {}}
      onSelectChat={() => {}}
      onOpenSettings={() => {}}
    />
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Sidebar sub-thread collapse', () => {
  it('renders sub-thread children expanded by default', () => {
    stubSidebarStorage({
      [EXPANDED_WORKSPACES_STORAGE_KEY]: JSON.stringify(['ws-1'])
    })

    const html = renderSidebar([
      makeChat(),
      makeChat({
        appChatId: 'child-1',
        provider: 'codex',
        title: 'Child thread',
        parentChatId: 'parent-1',
        createdAt: 2,
        updatedAt: 2
      })
    ])

    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('sidebar-chat-children')
  })

  it('hides sub-thread children when the parent is persisted as collapsed', () => {
    stubSidebarStorage({
      [EXPANDED_WORKSPACES_STORAGE_KEY]: JSON.stringify(['ws-1']),
      [COLLAPSED_SUB_THREAD_PARENTS_STORAGE_KEY]: JSON.stringify(['parent-1'])
    })

    const html = renderSidebar([
      makeChat(),
      makeChat({
        appChatId: 'child-1',
        provider: 'codex',
        title: 'Child thread',
        parentChatId: 'parent-1',
        createdAt: 2,
        updatedAt: 2
      })
    ])

    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('sidebar-chat-children')
  })
})
