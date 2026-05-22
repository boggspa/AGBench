import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatRecord, ChildAgentThread, ProviderId } from '../../../main/store/types'
import { deriveChildAgentThreads } from '../lib/ChildAgentThreads'

interface AgentMentionMenuProps {
  chat?: ChatRecord
  provider?: ProviderId
  /** The current composer prompt value. We watch this for `@<query>` patterns. */
  prompt: string
  /** Caller-controlled visibility. Parent toggles this on `@` keypress. */
  open: boolean
  /** Anchor element (the textarea) used to position the popover. */
  anchorRef: React.RefObject<HTMLElement | null>
  /** Filter substring (what comes after the trailing `@`). */
  query: string
  /** Replace the `@<query>` token in the prompt with `[@Name](agent://uuid) `. */
  onPick: (mention: { agentId: string; name: string }) => void
  /** Dismiss without picking. */
  onDismiss: () => void
}

/**
 * Floating popover anchored to the composer textarea that lists the active
 * subagents (queued + running) in the current chat. Triggered by the parent
 * detecting an `@` keystroke; selecting an item inserts the canonical
 * markdown mention `[@Name](agent://uuid) ` at the cursor position.
 *
 * Keyboard handling lives here:
 *   ArrowUp / ArrowDown — navigate
 *   Enter             — select highlighted item
 *   Escape            — dismiss
 *   Tab               — select + close
 *
 * v1 anchors the popover above the textarea (fixed offset). A future iteration
 * could chase the caret via the mirror-div technique, but for stability we use
 * a single getBoundingClientRect against the anchor.
 */
export function AgentMentionMenu({
  chat,
  provider,
  open,
  anchorRef,
  query,
  onPick,
  onDismiss
}: AgentMentionMenuProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  // Active subagents for the current chat (queued + running).
  const candidates = useMemo<ChildAgentThread[]>(() => {
    if (!chat || !provider) return []
    const all = deriveChildAgentThreads(provider, chat.appChatId, chat.messages || [], chat)
    return all.filter((t) => t.state === 'running' || t.state === 'queued')
  }, [chat, provider])

  // Substring filter on the trailing `@<query>` token.
  const filtered = useMemo(() => {
    if (!query) return candidates
    const needle = query.toLowerCase()
    return candidates.filter((t) => {
      const name = (t.identity?.name || t.name).toLowerCase()
      return name.includes(needle)
    })
  }, [candidates, query])

  // Recompute popover position when the anchor moves / when opening.
  useEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    // Anchor the popover ABOVE the textarea (Codex's composer popover also
    // floats above so it doesn't shove the input down). Right-align to the
    // textarea's left edge so a wide menu doesn't fall off-screen.
    setPosition({ left: rect.left + 8, top: rect.top - 8 })
  }, [open, anchorRef, query])

  // Reset highlight when filtered list changes.
  useEffect(() => {
    setHighlight(0)
  }, [filtered])

  // Listen for the keyboard events bubbling up from the textarea.
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
        if (choice) {
          onPick({ agentId: choice.id, name: choice.identity?.name || choice.name })
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, filtered, highlight, onPick, onDismiss])

  // Click outside dismisses.
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

  return (
    <div
      ref={popoverRef}
      className="agent-mention-menu"
      role="listbox"
      aria-label="Active subagents"
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
            ? 'No active subagents in this chat'
            : `No agents match "${query}"`}
        </div>
      ) : (
        <ul className="agent-mention-menu-list">
          {filtered.map((thread, index) => {
            const identity = thread.identity
            const name = identity?.name || thread.name
            const role = identity?.role || thread.role
            const color = identity?.color
            const isHighlighted = index === highlight
            return (
              <li
                key={thread.id}
                role="option"
                aria-selected={isHighlighted}
                className={`agent-mention-menu-item ${isHighlighted ? 'is-highlighted' : ''}`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => onPick({ agentId: thread.id, name })}
              >
                <span
                  className="agent-mention-menu-dot"
                  style={color ? { background: color } : undefined}
                  aria-hidden
                />
                <span className="agent-mention-menu-name" style={color ? { color } : undefined}>
                  {name}
                </span>
                {role && <span className="agent-mention-menu-role">({role})</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
