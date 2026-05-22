import { useMemo } from 'react'
import type { ChatRecord, ChildAgentThread, ProviderId } from '../../../main/store/types'
import { deriveChildAgentThreads } from '../lib/ChildAgentThreads'

interface BackgroundTasksPanelProps {
  chat?: ChatRecord
  /** The provider for this chat; used so identity-assignment in derive picks the right kind. */
  provider?: ProviderId
}

/**
 * Inspector tab content listing live subagents for the active chat.
 *
 * Renders a row per running/queued ChildAgentThread (colored status dot, name,
 * role, duration, and the latest activity stage). Clicking a row scrolls the
 * transcript to that agent's `ChildAgentThreadCard` via the `data-agent-id`
 * attribute set in ActivityStack.
 *
 * Completed agents drop out of this list — historical agents remain visible in
 * the transcript itself and via @-mention chips.
 */
export function BackgroundTasksPanel({ chat, provider }: BackgroundTasksPanelProps) {
  const liveThreads = useMemo<ChildAgentThread[]>(() => {
    if (!chat || !provider) return []
    const all = deriveChildAgentThreads(provider, chat.appChatId, chat.messages || [], chat)
    return all.filter((thread) => thread.state === 'running' || thread.state === 'queued')
  }, [chat, provider])

  const scrollToAgent = (agentId: string) => {
    if (typeof document === 'undefined') return
    const target = document.querySelector(`[data-agent-id="${CSS.escape(agentId)}"]`)
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.add('child-agent-thread-flash')
      window.setTimeout(() => target.classList.remove('child-agent-thread-flash'), 1200)
    }
  }

  return (
    <div className="background-tasks-panel">
      <div className="background-tasks-panel-header">
        <h3 className="background-tasks-panel-title">Background tasks</h3>
        <span className="background-tasks-panel-count">
          {liveThreads.length === 0 ? 'idle' : `${liveThreads.length} running`}
        </span>
      </div>
      {liveThreads.length === 0 ? (
        <div className="background-tasks-panel-empty">No background tasks running.</div>
      ) : (
        <ul className="background-tasks-panel-list">
          {liveThreads.map((thread) => (
            <BackgroundTaskRow key={thread.id} thread={thread} onActivate={scrollToAgent} />
          ))}
        </ul>
      )}
    </div>
  )
}

function BackgroundTaskRow({
  thread,
  onActivate
}: {
  thread: ChildAgentThread
  onActivate: (agentId: string) => void
}) {
  const identity = thread.identity
  const name = identity?.name || thread.name
  const role = identity?.role || thread.role
  const color = identity?.color
  const startedAt = thread.startedAt ? new Date(thread.startedAt) : null
  const elapsed = startedAt
    ? Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000))
    : null
  const elapsedLabel =
    elapsed === null
      ? null
      : elapsed < 60
        ? `${elapsed}s`
        : elapsed < 3600
          ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
          : `${Math.floor(elapsed / 3600)}h`

  return (
    <li className={`background-task-row state-${thread.state}`}>
      <button
        type="button"
        className="background-task-row-button"
        onClick={() => onActivate(thread.id)}
        title="Scroll to this agent's card in the transcript"
      >
        <span
          className={`background-task-dot state-${thread.state}`}
          style={color ? { background: color, boxShadow: `0 0 0 3px ${color}33` } : undefined}
          aria-hidden
        />
        <span className="background-task-name" style={color ? { color } : undefined}>
          {name}
        </span>
        {role && <span className="background-task-role">({role})</span>}
        {elapsedLabel && (
          <span className="background-task-elapsed" title="Time since this agent started">
            {elapsedLabel}
          </span>
        )}
        <span className="background-task-state">
          {thread.state === 'running' ? 'Running' : 'Queued'}
        </span>
      </button>
    </li>
  )
}
