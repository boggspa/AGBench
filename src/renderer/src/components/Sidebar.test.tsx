import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatRecord, WorkspaceRecord } from '../../../main/store/types'
import { Sidebar } from './Sidebar'
import { assignAgentIdentityFromSeed } from '../lib/agentIdentitySeed'

const EXPANDED_WORKSPACES_STORAGE_KEY = 'taskwraith-sidebar-expanded-workspace-ids'
const COLLAPSED_SUB_THREAD_PARENTS_STORAGE_KEY = 'taskwraith-sidebar-collapsed-sub-thread-parent-ids'
const COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY = 'taskwraith-sidebar-collapsed-sections'

// Mirrors SIDEBAR_SECTION_IDS in Sidebar.tsx. The sidebar defaults every section
// to collapsed for new users (ec5bcad, "all-collapsed-v1"), so tests that assert
// on child rows opt the relevant section(s) open the way a user would by clicking
// the header. Persisting a non-empty collapsed list also bypasses the new-user
// default migration, pinning exactly these sections open.
const SIDEBAR_SECTION_IDS = ['pinned', 'recents', 'ensembles', 'workspaces', 'chats'] as const
function collapseSectionsExcept(...expanded: string[]): string {
  return JSON.stringify(SIDEBAR_SECTION_IDS.filter((id) => !expanded.includes(id)))
}

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

function renderSidebar(chats: ChatRecord[], options: { ensembleModeEnabled?: boolean } = {}) {
  const workspace = makeWorkspace()
  return renderToStaticMarkup(
    <Sidebar
      workspaces={[workspace]}
      currentWorkspace={workspace}
      chats={chats}
      currentChat={chats[0] ?? null}
      usageSummary={[]}
      runningChatIds={[]}
      onSelectWorkspace={() => {}}
      onRemoveWorkspace={() => {}}
      onSelectWorkspaceDialog={() => {}}
      onNewChat={() => {}}
      onNewGlobalChat={() => {}}
      onNewEnsemble={() => {}}
      ensembleModeEnabled={options.ensembleModeEnabled}
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
      [EXPANDED_WORKSPACES_STORAGE_KEY]: JSON.stringify(['ws-1']),
      [COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY]: collapseSectionsExcept('workspaces')
    })
    const childIdentity = assignAgentIdentityFromSeed('child-1')

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
    expect(html).toContain(childIdentity.name)
    expect(html).toContain('sidebar-sub-thread-identicon')
  })

  it('labels fan-out side-chat children distinctly in the sidebar', () => {
    stubSidebarStorage({
      [EXPANDED_WORKSPACES_STORAGE_KEY]: JSON.stringify(['ws-1']),
      [COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY]: collapseSectionsExcept('workspaces')
    })

    const html = renderSidebar([
      makeChat(),
      makeChat({
        appChatId: 'fan-out-side-1',
        provider: 'gemini',
        chatKind: 'ensemble',
        title: 'Parallel side branch',
        parentChatId: 'parent-1',
        parentChatRelation: 'sideChat',
        sideChatContext: {
          createdAt: 2,
          mode: 'fanOut',
          lifecycleState: 'active',
          transcriptVisibility: 'none'
        },
        createdAt: 2,
        updatedAt: 2
      })
    ])

    expect(html).toContain('Parallel side branch')
    expect(html).toContain('Fan-out side chat')
    expect(html).toContain('Parallel fan-out')
    expect(html).toContain('No parent context')
  })

  it('shows participant and context metadata for side-chat children', () => {
    stubSidebarStorage({
      [EXPANDED_WORKSPACES_STORAGE_KEY]: JSON.stringify(['ws-1']),
      [COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY]: collapseSectionsExcept('workspaces')
    })

    const html = renderSidebar([
      makeChat(),
      makeChat({
        appChatId: 'reviewer-side-1',
        provider: 'codex',
        title: 'Reviewer branch',
        parentChatId: 'parent-1',
        parentChatRelation: 'sideChat',
        sideChatContext: {
          createdAt: 2,
          mode: 'singleProvider',
          lifecycleState: 'closed',
          originMessageId: 'message-1',
          transcriptVisibility: 'selected'
        },
        providerMetadata: {
          sideChatSelectedParticipantId: 'reviewer-codex',
          sideChatSelectedParticipantRole: 'Reviewer'
        },
        createdAt: 2,
        updatedAt: 2
      })
    ])

    expect(html).toContain('Reviewer branch')
    expect(html).toContain('Side chat')
    expect(html).toContain('Participant: Reviewer')
    expect(html).toContain('Seeded from selected message')
    expect(html).toContain('Closed')
  })

  it('labels run-result seeded side-chat children explicitly', () => {
    stubSidebarStorage({
      [EXPANDED_WORKSPACES_STORAGE_KEY]: JSON.stringify(['ws-1']),
      [COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY]: collapseSectionsExcept('workspaces')
    })

    const html = renderSidebar([
      makeChat(),
      makeChat({
        appChatId: 'run-seeded-side-1',
        provider: 'claude',
        title: 'Run follow-up',
        parentChatId: 'parent-1',
        parentChatRelation: 'sideChat',
        sideChatContext: {
          createdAt: 2,
          mode: 'singleProvider',
          lifecycleState: 'active',
          originRunId: 'run-1',
          transcriptVisibility: 'snapshot'
        },
        createdAt: 2,
        updatedAt: 2
      })
    ])

    expect(html).toContain('Run follow-up')
    expect(html).toContain('Seeded from run result')
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

describe('Sidebar ensembles section', () => {
  it('renders a quick-create button beside the Ensembles header', () => {
    stubSidebarStorage({})

    const html = renderSidebar([])

    expect(html).toContain('sidebar-ensembles-section')
    expect(html).toContain('sidebar-ensemble-create')
    expect(html).toContain('aria-label="New Ensemble"')
  })

  it('hides the Ensembles section when Ensemble Mode is disabled', () => {
    stubSidebarStorage({})

    const html = renderSidebar([], { ensembleModeEnabled: false })

    expect(html).not.toContain('sidebar-ensembles-section')
    expect(html).not.toContain('sidebar-ensemble-create')
  })

  it('uses the silver ensemble dot in ensemble and pinned chat rows', () => {
    stubSidebarStorage({
      [COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY]: collapseSectionsExcept(
        'pinned',
        'recents',
        'ensembles'
      )
    })

    const html = renderSidebar([
      makeChat({
        appChatId: 'ensemble-1',
        chatKind: 'ensemble',
        title: 'Workspace ensemble',
        provider: 'codex',
        createdAt: 3,
        updatedAt: 3
      }),
      makeChat({
        appChatId: 'pinned-ensemble-1',
        chatKind: 'ensemble',
        title: 'Pinned ensemble',
        provider: 'claude',
        pinned: true,
        createdAt: 4,
        updatedAt: 4
      })
    ])

    expect(html).toContain('sidebar-ensemble-item')
    expect(html).toContain('sidebar-pinned-item')
    // 1.0.7 — three ensemble dots now: the unpinned ensemble renders in BOTH
    // the Ensembles section AND Recents (Recents includes ensembles as of
    // 1.0.7), plus the pinned ensemble in the Pinned section. Pinned ensembles
    // are excluded from Recents by selectRecentChats, so only the unpinned one
    // dual-surfaces.
    expect((html.match(/sidebar-provider-dot-ensemble/g) || []).length).toBe(3)
  })

  it('1.0.7 — surfaces an unpinned ensemble chat in the Recents section', () => {
    stubSidebarStorage({
      [COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY]: collapseSectionsExcept('recents')
    })

    const html = renderSidebar([
      makeChat({ appChatId: 'solo-1', title: 'Solo', updatedAt: 2 }),
      makeChat({
        appChatId: 'ensemble-recent',
        chatKind: 'ensemble',
        title: 'Recent ensemble',
        provider: 'codex',
        updatedAt: 5
      })
    ])

    // The ensemble chat (most recently updated) appears as a Recents item, not
    // only in the Ensembles section.
    expect(html).toContain('sidebar-recents-item')
    const recentsBlock = html.slice(html.indexOf('sidebar-recents-section'))
    expect(recentsBlock).toContain('Recent ensemble')
  })
})

describe('Sidebar Chats section', () => {
  it('keeps the Chats header visible while hiding global chats when collapsed', () => {
    stubSidebarStorage({
      [COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY]: JSON.stringify(['chats', 'recents'])
    })

    const html = renderSidebar([
      makeChat({
        appChatId: 'global-1',
        scope: 'global',
        title: 'Global thread',
        workspaceId: undefined,
        workspacePath: undefined
      })
    ])

    expect(html).toContain('Expand Chats')
    expect(html).toContain('New system chat')
    expect(html).not.toContain('Global thread')
  })
})
