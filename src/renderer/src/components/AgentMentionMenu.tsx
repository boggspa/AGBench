import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  ChatRecord,
  ChildAgentThread,
  ExternalPathGrant,
  ProviderId,
  WorkspaceFileEntry
} from '../../../main/store/types'
import { deriveChildAgentThreads } from '../lib/ChildAgentThreads'

export type ComposerMentionKind = 'agent' | 'workspace-file' | 'external-grant'

export interface ComposerMentionPick {
  kind: ComposerMentionKind
  name: string
  agentId?: string
  path?: string
  isDirectory?: boolean
  access?: ExternalPathGrant['access']
}

export interface ComposerMentionCandidate extends ComposerMentionPick {
  id: string
  detail?: string
  color?: string
}

interface AgentMentionMenuProps {
  chat?: ChatRecord
  provider?: ProviderId
  workspacePath?: string
  externalPathGrants?: ExternalPathGrant[]
  /** The current composer prompt value. Kept for compatibility with existing callers. */
  prompt?: string
  /** Caller-controlled visibility. Parent toggles this on `@` keypress. */
  open: boolean
  /** Anchor element (the textarea) used to position the popover. */
  anchorRef: React.RefObject<HTMLElement | null>
  /** Filter substring (what comes after the trailing `@`). */
  query: string
  /** Replace the `@<query>` token in the prompt with the selected mention target. */
  onPick: (mention: ComposerMentionPick) => void
  /** Dismiss without picking. */
  onDismiss: () => void
}

export function filterComposerMentionCandidates(
  candidates: ComposerMentionCandidate[],
  query: string,
  limit = 80
): ComposerMentionCandidate[] {
  const trimmed = query.trim().toLowerCase()
  const filtered = trimmed
    ? candidates.filter((candidate) => {
        const haystack = [
          candidate.name,
          candidate.detail,
          candidate.path,
          candidate.kind.replace('-', ' ')
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(trimmed)
      })
    : candidates
  return filtered.slice(0, limit)
}

function nameFromPath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '')
  return trimmed.split('/').pop() || trimmed
}

/**
 * Floating popover anchored to the composer textarea that lists active
 * subagents, workspace files, and already-granted external paths. Selecting
 * a subagent inserts the canonical agent markdown mention; selecting a file
 * or grant inserts plain path text only.
 */
export function AgentMentionMenu({
  chat,
  provider,
  workspacePath,
  externalPathGrants = [],
  open,
  anchorRef,
  query,
  onPick,
  onDismiss
}: AgentMentionMenuProps): React.JSX.Element | null {
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const workspaceFileCacheRef = useRef<Map<string, WorkspaceFileEntry[]>>(new Map())
  const loadingWorkspacePathsRef = useRef<Set<string>>(new Set())
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileEntry[]>([])
  const [highlight, setHighlight] = useState(0)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!open || !workspacePath) {
      setWorkspaceFiles([])
      return
    }
    const cached = workspaceFileCacheRef.current.get(workspacePath)
    if (cached) {
      setWorkspaceFiles(cached)
      return
    }
    if (loadingWorkspacePathsRef.current.has(workspacePath)) return
    let cancelled = false
    loadingWorkspacePathsRef.current.add(workspacePath)
    window.api
      .listWorkspaceFiles(workspacePath)
      .then((files) => {
        workspaceFileCacheRef.current.set(workspacePath, files)
        if (!cancelled) setWorkspaceFiles(files)
      })
      .catch(() => {
        if (!cancelled) setWorkspaceFiles([])
      })
      .finally(() => {
        loadingWorkspacePathsRef.current.delete(workspacePath)
      })
    return () => {
      cancelled = true
    }
  }, [open, workspacePath])

  const activeSubagents = useMemo<ChildAgentThread[]>(() => {
    if (!chat || !provider) return []
    const all = deriveChildAgentThreads(provider, chat.appChatId, chat.messages || [], chat)
    return all.filter((thread) => thread.state === 'running' || thread.state === 'queued')
  }, [chat, provider])

  const candidates = useMemo<ComposerMentionCandidate[]>(() => {
    const agentItems = activeSubagents.map<ComposerMentionCandidate>((thread) => {
      const identity = thread.identity
      const name = identity?.name || thread.name
      return {
        id: `agent:${thread.id}`,
        kind: 'agent',
        agentId: thread.id,
        name,
        detail: identity?.role || thread.role || 'Agent',
        color: identity?.color
      }
    })
    const workspaceItems = workspaceFiles.map<ComposerMentionCandidate>((entry) => ({
      id: `workspace:${entry.path}`,
      kind: 'workspace-file',
      name: entry.path,
      path: entry.path,
      isDirectory: entry.isDirectory,
      detail: entry.isDirectory ? 'Workspace folder' : 'Workspace file'
    }))
    const externalItems = externalPathGrants.map<ComposerMentionCandidate>((grant) => ({
      id: `external:${grant.id || grant.path}`,
      kind: 'external-grant',
      name: nameFromPath(grant.path),
      path: grant.path,
      isDirectory: grant.kind === 'directory',
      access: grant.access,
      detail: `${grant.access === 'write' ? 'Editable' : 'Readable'} external path`
    }))
    return [...agentItems, ...workspaceItems, ...externalItems]
  }, [activeSubagents, externalPathGrants, workspaceFiles])

  const filtered = useMemo(
    () => filterComposerMentionCandidates(candidates, query),
    [candidates, query]
  )

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      if (!open) {
        setPosition(null)
        return
      }
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      setPosition({ left: rect.left + 8, top: rect.top - 8 })
    })
    return () => {
      cancelled = true
    }
  }, [open, anchorRef, query])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setHighlight(0)
    })
    return () => {
      cancelled = true
    }
  }, [filtered])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (!open) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onDismiss()
        return
      }
      if (filtered.length === 0) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlight((current) => (current + 1) % filtered.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlight((current) => (current - 1 + filtered.length) % filtered.length)
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const choice = filtered[highlight]
        if (choice) onPick(choice)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, filtered, highlight, onPick, onDismiss])

  useEffect(() => {
    if (!open) return
    const onMouse = (event: MouseEvent) => {
      const popover = popoverRef.current
      const anchor = anchorRef.current
      if (popover?.contains(event.target as Node)) return
      if (anchor?.contains(event.target as Node)) return
      onDismiss()
    }
    window.addEventListener('mousedown', onMouse, true)
    return () => window.removeEventListener('mousedown', onMouse, true)
  }, [open, anchorRef, onDismiss])

  if (!open || !position) return null

  return createPortal(
    <div
      ref={popoverRef}
      className="agent-mention-menu"
      role="listbox"
      aria-label="Mentions"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        transform: 'translateY(-100%)',
        zIndex: 50
      }}
    >
      {filtered.length === 0 ? (
        <div className="agent-mention-menu-empty">
          {candidates.length === 0
            ? 'No agents or files available'
            : `No matches for "${query}"`}
        </div>
      ) : (
        <ul className="agent-mention-menu-list">
          {filtered.map((candidate, index) => {
            const isHighlighted = index === highlight
            return (
              <li
                key={candidate.id}
                role="option"
                aria-selected={isHighlighted}
                className={`agent-mention-menu-item ${isHighlighted ? 'is-highlighted' : ''}`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => onPick(candidate)}
              >
                <span
                  className={`agent-mention-menu-dot kind-${candidate.kind}`}
                  style={candidate.color ? { background: candidate.color } : undefined}
                  aria-hidden
                />
                <span className="agent-mention-menu-copy">
                  <span
                    className="agent-mention-menu-name"
                    style={candidate.color ? { color: candidate.color } : undefined}
                  >
                    {candidate.name}
                  </span>
                  {candidate.detail && (
                    <span className="agent-mention-menu-role">{candidate.detail}</span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>,
    document.body
  )
}
