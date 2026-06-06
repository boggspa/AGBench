import { useState } from 'react'
import type { ChatRecord, ProviderId } from '../../../main/store/types'
import { isSubThreadChat } from '../lib/chatScope'

interface LinkedChatsStripProps {
  currentChat: ChatRecord | null
  chats: ChatRecord[]
  runningChatIds: string[]
  onOpenBeside?: (chatId: string) => void
  onOpenMain?: (chatId: string) => void
  defaultCollapsed?: boolean
}

function providerLabel(provider?: ProviderId): string {
  if (provider === 'codex') return 'Codex'
  if (provider === 'claude') return 'Claude'
  if (provider === 'kimi') return 'Kimi'
  if (provider === 'grok') return 'Grok'
  if (provider === 'cursor') return 'Cursor'
  if (provider === 'gemini') return 'Gemini'
  return 'Chat'
}

function linkedKindLabel(chat: ChatRecord): string {
  if (chat.parentChatRelation === 'sideChat') {
    return chat.chatKind === 'ensemble' ? 'Side ensemble' : 'Side chat'
  }
  return 'Agent sub-thread'
}

function isTerminatedSideChat(chat: ChatRecord): boolean {
  if (chat.parentChatRelation !== 'sideChat') return false
  const state = chat.sideChatContext?.lifecycleState
  if (state === 'terminated') return true
  return chat.archived && !state
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function LinkedChatsStrip({
  currentChat,
  chats,
  runningChatIds,
  onOpenBeside,
  onOpenMain,
  defaultCollapsed = false
}: LinkedChatsStripProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  if (!currentChat) return null
  const runningSet = new Set(runningChatIds)
  const linkedChats = chats
    .filter(
      (chat) =>
        !chat.archived &&
        !isTerminatedSideChat(chat) &&
        chat.parentChatId === currentChat.appChatId &&
        (chat.parentChatRelation === 'sideChat' || isSubThreadChat(chat))
    )
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))

  if (linkedChats.length === 0) return null

  const visibleChats = linkedChats.slice(0, 4)
  const hiddenCount = linkedChats.length - visibleChats.length
  const sideChatCount = linkedChats.filter((chat) => chat.parentChatRelation === 'sideChat').length
  const subThreadCount = linkedChats.length - sideChatCount
  const runningCount = linkedChats.filter((chat) => runningSet.has(chat.appChatId)).length
  const summaryParts = [
    `${linkedChats.length} linked`,
    runningCount > 0 ? `${runningCount} running` : '',
    sideChatCount > 0 ? countLabel(sideChatCount, 'side chat') : '',
    subThreadCount > 0 ? countLabel(subThreadCount, 'agent') : ''
  ].filter(Boolean)
  const listId = `linked-chats-strip-list-${currentChat.appChatId}`

  return (
    <div
      className={`linked-chats-strip ${collapsed ? 'is-collapsed' : 'is-expanded'}`}
      aria-label="Linked chats"
    >
      <button
        type="button"
        className="linked-chats-strip-toggle"
        aria-expanded={!collapsed}
        aria-controls={listId}
        onClick={() => setCollapsed((value) => !value)}
        title={collapsed ? 'Show linked side chats' : 'Hide linked side chats'}
      >
        <span className="linked-chats-strip-caret" aria-hidden>
          {collapsed ? '+' : '-'}
        </span>
        <span className="linked-chats-strip-label">Linked threads</span>
        <span className="linked-chats-strip-summary">{summaryParts.join(' | ')}</span>
      </button>
      {!collapsed && (
        <div id={listId} className="linked-chats-strip-list">
          {visibleChats.map((chat) => {
            const provider = chat.provider || 'gemini'
            const running = runningSet.has(chat.appChatId)
            const title = chat.title || linkedKindLabel(chat)
            const canOpenBeside = Boolean(onOpenBeside)
            return (
              <div
                key={chat.appChatId}
                className={`linked-chats-strip-item provider-${provider} ${
                  running ? 'is-running' : ''
                }`}
              >
                <button
                  type="button"
                  className="linked-chats-strip-open"
                  onClick={canOpenBeside ? () => onOpenBeside?.(chat.appChatId) : undefined}
                  disabled={!canOpenBeside}
                  title={`Open beside: ${title}`}
                >
                  <span
                    className="linked-chats-strip-provider-dot"
                    style={{ background: `var(--provider-${provider}-color)` }}
                    aria-hidden="true"
                  />
                  <span className="linked-chats-strip-provider">{providerLabel(provider)}</span>
                  <span className="linked-chats-strip-kind">{linkedKindLabel(chat)}</span>
                  <span className="linked-chats-strip-title">{title}</span>
                </button>
                {onOpenMain && (
                  <button
                    type="button"
                    className="linked-chats-strip-main"
                    onClick={() => onOpenMain(chat.appChatId)}
                    title={`Open as main chat: ${title}`}
                  >
                    Main
                  </button>
                )}
              </div>
            )
          })}
          {hiddenCount > 0 && (
            <span className="linked-chats-strip-more">+{hiddenCount} more</span>
          )}
        </div>
      )}
    </div>
  )
}
