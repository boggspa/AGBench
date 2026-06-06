import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatRecord } from '../../../main/store/types'
import { LinkedChatsStrip } from './LinkedChatsStrip'

function makeChat(overrides: Partial<ChatRecord> = {}): ChatRecord {
  return {
    appChatId: 'parent-1',
    scope: 'workspace',
    provider: 'gemini',
    title: 'Parent',
    workspaceId: 'ws-1',
    workspacePath: '/repo',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    messages: [],
    runs: [],
    ...overrides
  }
}

describe('LinkedChatsStrip', () => {
  it('renders direct side chats and subthreads under the active parent', () => {
    const parent = makeChat()
    const sideChat = makeChat({
      appChatId: 'side-1',
      parentChatId: 'parent-1',
      parentChatRelation: 'sideChat',
      provider: 'codex',
      title: 'Scratch beside parent'
    })
    const subThread = makeChat({
      appChatId: 'sub-1',
      parentChatId: 'parent-1',
      parentChatRelation: 'subThread',
      provider: 'claude',
      title: 'Investigate tests'
    })
    const archived = makeChat({
      appChatId: 'archived-1',
      parentChatId: 'parent-1',
      parentChatRelation: 'sideChat',
      title: 'Archived child',
      archived: true
    })
    const unrelated = makeChat({
      appChatId: 'other-1',
      parentChatId: 'other-parent',
      parentChatRelation: 'sideChat',
      title: 'Other child'
    })

    const html = renderToStaticMarkup(
      <LinkedChatsStrip
        currentChat={parent}
        chats={[parent, sideChat, subThread, archived, unrelated]}
        runningChatIds={['sub-1']}
        onOpenBeside={() => {}}
        onOpenMain={() => {}}
      />
    )

    expect(html).toContain('Linked threads')
    expect(html).toContain('Side chat')
    expect(html).toContain('Scratch beside parent')
    expect(html).toContain('Agent sub-thread')
    expect(html).toContain('Investigate tests')
    expect(html).toContain('is-running')
    expect(html).not.toContain('Archived child')
    expect(html).not.toContain('Other child')
  })

  it('renders nothing without linked children', () => {
    const parent = makeChat()
    const html = renderToStaticMarkup(
      <LinkedChatsStrip
        currentChat={parent}
        chats={[parent]}
        runningChatIds={[]}
        onOpenBeside={() => {}}
      />
    )

    expect(html).toBe('')
  })
})
