import type { ChatMessage, ChatRecord } from '../../../main/store/types'
import {
  agentInvocationSourceClassName,
  agentInvocationSourceLabel,
  providerDisplayName
} from '../lib/AgentInvocationPresentation'
import { AgentIdentityIcon } from './icons/AgentIdentityIcon'
import { assignAgentIdentityFromSeed } from '../lib/agentIdentitySeed'
import { MarkdownMessage } from './MarkdownMessage'
import { subThreadReturnBody } from './SubThreadReturnCardModel'

interface SubThreadReturnCardProps {
  message: ChatMessage
  chat?: ChatRecord
  onOpenSubThread?: (chatId: string) => void
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function SubThreadReturnCard({ message, chat, onOpenSubThread }: SubThreadReturnCardProps) {
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
    <article className="subthread-return-card">
      <header className="subthread-return-header">
        <div className="subthread-return-heading">
          <span aria-hidden="true" className="subthread-return-glyph">
            ↩
          </span>
          <span className="subthread-return-label">Invocation result from</span>
          <span
            className={`agent-invocation-source-chip ${agentInvocationSourceClassName('agbench-subthread')}`}
          >
            {agentInvocationSourceLabel('agbench-subthread')}
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
        {subThreadId && onOpenSubThread && (
          <button
            type="button"
            className="subthread-return-open"
            onClick={() => onOpenSubThread(subThreadId)}
          >
            Open sub-thread
          </button>
        )}
      </header>
      <div className="subthread-return-body">
        <MarkdownMessage content={body} chat={chat} />
      </div>
    </article>
  )
}
