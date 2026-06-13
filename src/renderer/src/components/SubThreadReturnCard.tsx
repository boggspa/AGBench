import type { CSSProperties } from 'react'
import type { ChatMessage, ChatRecord } from '../../../main/store/types'
import {
  agentInvocationSourceClassName,
  agentInvocationSourceLabel,
  providerDisplayName
} from '../lib/AgentInvocationPresentation'
import { AgentIdentityIcon } from './icons/AgentIdentityIcon'
import { assignAgentIdentityFromSeed } from '../lib/agentIdentitySeed'
import { MarkdownMessage } from './MarkdownMessage'
import { MessageActionsChip } from './MessageActionsChip'
import { subThreadReturnBody } from './SubThreadReturnCardModel'

interface SubThreadReturnCardProps {
  message: ChatMessage
  chat?: ChatRecord
  onOpenSubThread?: (chatId: string) => void
  onOpenSubThreadInSidePanel?: (chatId: string, presentation?: 'split' | 'drawer') => void
  onCopyMessage?: (messageId: string, content: string) => void
  onDeleteMessage?: (messageId: string) => void
  onTogglePinMessage?: (messageId: string) => void
  onOpenSideChatFromMessage?: (message: ChatMessage) => void
  pinned?: boolean
  copied?: boolean
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function SubThreadReturnCard({
  message,
  chat,
  onOpenSubThread,
  onOpenSubThreadInSidePanel,
  onCopyMessage,
  onDeleteMessage,
  onTogglePinMessage,
  onOpenSideChatFromMessage,
  pinned = false,
  copied = false
}: SubThreadReturnCardProps) {
  const metadata = message.metadata || {}
  const provider = metadata.subThreadProvider
  const providerName = providerDisplayName(typeof provider === 'string' ? provider : undefined)
  const title = textValue(metadata.subThreadTitle) || 'Untitled sub-thread'
  const subThreadId = textValue(metadata.subThreadId)
  // Deterministic per-sub-thread identity (same id -> same character on
  // every delegation surface: this card, the Agent-Invocation card, the
  // delegation timeline). Seeded by the sub-thread chat id.
  const agentIdentity = subThreadId ? assignAgentIdentityFromSeed(subThreadId) : null
  const body = subThreadReturnBody(message.content)

  return (
    <article
      className="subthread-return-card"
      style={agentIdentity ? ({ ['--agent-rim']: agentIdentity.accent } as CSSProperties) : undefined}
    >
      <header className="subthread-return-header">
        <div className="subthread-return-heading">
          <span aria-hidden="true" className="subthread-return-glyph">
            ↩
          </span>
          <span className="subthread-return-label">Invocation result from</span>
          <span
            className={`agent-invocation-source-chip ${agentInvocationSourceClassName('taskwraith-subthread')}`}
          >
            {agentInvocationSourceLabel('taskwraith-subthread')}
          </span>
          {agentIdentity && (
            <span className="subthread-return-agent" title={agentIdentity.name}>
              <AgentIdentityIcon
                name={agentIdentity.key}
                color={agentIdentity.accent}
                size={36}
                className="subthread-return-agent-icon"
                title={agentIdentity.name}
              />
              <span className="subthread-return-agent-name">{agentIdentity.name}</span>
            </span>
          )}
          <span className={`subthread-return-provider provider-${provider || 'unknown'}`}>
            {providerName}
          </span>
          <strong className="subthread-return-title">{title}</strong>
        </div>
        {subThreadId && (onOpenSubThread || onOpenSubThreadInSidePanel) && (
          <div className="subthread-return-actions">
            {onOpenSubThreadInSidePanel && (
              <button
                type="button"
                className="subthread-return-open"
                onClick={() => onOpenSubThreadInSidePanel(subThreadId)}
              >
                Open beside
              </button>
            )}
            {onOpenSubThreadInSidePanel && (
              <button
                type="button"
                className="subthread-return-open"
                onClick={() => onOpenSubThreadInSidePanel(subThreadId, 'drawer')}
              >
                Open drawer
              </button>
            )}
            {onOpenSubThread && (
              <button
                type="button"
                className="subthread-return-open"
                onClick={() => onOpenSubThread(subThreadId)}
              >
                Open sub-thread
              </button>
            )}
          </div>
        )}
      </header>
      <div className="subthread-return-body">
        <MarkdownMessage content={body} chat={chat} />
      </div>
      {onCopyMessage && (
        <MessageActionsChip
          onCopy={() => onCopyMessage(message.id, body)}
          onTogglePin={onTogglePinMessage ? () => onTogglePinMessage(message.id) : undefined}
          onDelete={onDeleteMessage ? () => onDeleteMessage(message.id) : undefined}
          onOpenSideChat={
            onOpenSideChatFromMessage ? () => onOpenSideChatFromMessage(message) : undefined
          }
          pinned={pinned}
          copied={copied}
          label="sub-thread result"
        />
      )}
    </article>
  )
}
