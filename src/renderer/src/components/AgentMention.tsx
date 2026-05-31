import { useContext, type ReactNode } from 'react'
import { AgentIdentityContext } from './AgentIdentityContext'
import { findIdentity } from '../lib/agentIdentity'
import { AgentIdenticon } from './icons/AgentIdenticon'

interface AgentMentionProps {
  agentId: string
  /** The link text — usually the raw "@Name" string from the markdown. We
   * prefer the identity-registered name when present, but fall back to this. */
  children?: ReactNode
}

/**
 * Inline @-mention chip. Renders a colored pill referencing a subagent by id.
 *
 * The chip color and display name come from the chat's identity registry
 * (`chat.providerMetadata.agentIdentities`). If no identity has been assigned
 * for the given id, we render the raw link text in neutral styling so the
 * message still reads cleanly.
 *
 * Clicking the chip scrolls the transcript to the matching
 * `ChildAgentThreadCard` (via the `data-agent-id` attribute set in
 * ActivityStack) and briefly flashes it.
 */
export function AgentMention({ agentId, children }: AgentMentionProps) {
  const chat = useContext(AgentIdentityContext)
  const identity = findIdentity(chat, agentId)

  const displayName =
    identity?.name ||
    (typeof children === 'string'
      ? children.replace(/^@+/, '')
      : Array.isArray(children) && typeof children[0] === 'string'
        ? (children[0] as string).replace(/^@+/, '')
        : agentId.slice(0, 8))

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (typeof document === 'undefined') return
    const target = document.querySelector(`[data-agent-id="${CSS.escape(agentId)}"]`)
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.add('child-agent-thread-flash')
      window.setTimeout(() => target.classList.remove('child-agent-thread-flash'), 1200)
    }
  }

  const color = identity?.color
  const titleParts: string[] = []
  if (identity?.role) titleParts.push(identity.role)
  if (identity?.source === 'platform') titleParts.push('platform-assigned')

  return (
    <button
      type="button"
      className={`agent-mention ${identity ? 'has-identity' : 'unknown-identity'}`}
      style={color ? { color, borderColor: color } : undefined}
      onClick={handleClick}
      title={titleParts.join(' · ') || `Agent ${agentId}`}
    >
      {identity && (
        <AgentIdenticon
          seed={identity.agentId || agentId}
          color={color}
          size={13}
          className="agent-mention-icon"
        />
      )}
      @{displayName}
    </button>
  )
}
