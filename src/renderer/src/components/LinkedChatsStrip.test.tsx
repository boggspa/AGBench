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
      title: 'Scratch beside parent',
      sideChatContext: {
        createdAt: 2,
        lifecycleState: 'active',
        originMessageId: 'message-1',
        mode: 'singleProvider',
        transcriptVisibility: 'selected'
      }
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
    const terminated = makeChat({
      appChatId: 'terminated-1',
      parentChatId: 'parent-1',
      parentChatRelation: 'sideChat',
      title: 'Terminated child',
      sideChatContext: {
        createdAt: 2,
        lifecycleState: 'terminated'
      }
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
        chats={[parent, sideChat, subThread, archived, terminated, unrelated]}
        runningChatIds={['sub-1']}
        onOpenBeside={() => {}}
        onOpenMain={() => {}}
      />
    )

    expect(html).toContain('Side chats opened')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('2 linked | 1 running | 1 side chat | 1 agent')
    expect(html).toContain('Side chat')
    expect(html).toContain('Scratch beside parent')
    expect(html).toContain('Active')
    expect(html).toContain('Single provider')
    expect(html).toContain('Seeded from message')
    expect(html).toContain('Agent sub-thread')
    expect(html).toContain('Investigate tests')
    expect(html).toContain('Delegated agent')
    expect(html).toContain('Delegation context')
    expect(html).toContain('is-running')
    expect(html).not.toContain('Archived child')
    expect(html).not.toContain('Terminated child')
    expect(html).not.toContain('Other child')
  })

  it('can render the linked marker collapsed to a summary', () => {
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

    const html = renderToStaticMarkup(
      <LinkedChatsStrip
        currentChat={parent}
        chats={[parent, sideChat, subThread]}
        runningChatIds={['sub-1']}
        onOpenBeside={() => {}}
        defaultCollapsed
      />
    )

    expect(html).toContain('Side chats opened')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('2 linked | 1 running | 1 side chat | 1 agent')
    expect(html).not.toContain('Scratch beside parent')
    expect(html).not.toContain('Investigate tests')
  })

  it('labels fan-out side chats distinctly from ensemble clones', () => {
    const parent = makeChat()
    const fanOut = makeChat({
      appChatId: 'fan-out-1',
      parentChatId: 'parent-1',
      parentChatRelation: 'sideChat',
      chatKind: 'ensemble',
      provider: 'gemini',
      title: 'Parallel branch',
      sideChatContext: {
        createdAt: 2,
        lifecycleState: 'active',
        mode: 'fanOut',
        transcriptVisibility: 'none'
      }
    })

    const html = renderToStaticMarkup(
      <LinkedChatsStrip
        currentChat={parent}
        chats={[parent, fanOut]}
        runningChatIds={[]}
        onOpenBeside={() => {}}
      />
    )

    expect(html).toContain('Fan-out side chat')
    expect(html).toContain('Fan-out')
    expect(html).toContain('No parent context')
  })

  it('labels participant-dedicated side chats with the selected participant', () => {
    const parent = makeChat()
    const participantSideChat = makeChat({
      appChatId: 'participant-side-1',
      parentChatId: 'parent-1',
      parentChatRelation: 'sideChat',
      provider: 'codex',
      title: 'Reviewer branch',
      sideChatContext: {
        createdAt: 2,
        lifecycleState: 'active',
        mode: 'singleProvider',
        transcriptVisibility: 'none'
      },
      providerMetadata: {
        sideChatSelectedParticipantId: 'reviewer-codex',
        sideChatSelectedParticipantRole: 'Reviewer'
      }
    })

    const html = renderToStaticMarkup(
      <LinkedChatsStrip
        currentChat={parent}
        chats={[parent, participantSideChat]}
        runningChatIds={[]}
        onOpenBeside={() => {}}
      />
    )

    expect(html).toContain('Side chat')
    expect(html).toContain('Reviewer branch')
    expect(html).toContain('Participant: Reviewer')
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
