import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ComposerStyle } from '../../../main/store/types'
import {
  COMPOSER_SLASH_GROUP_ORDER,
  filterComposerSlashCommands,
  type CommandPaletteGroup,
  type ComposerSlashCommand
} from '../lib/ComposerSlashCommands'

interface ComposerSlashMenuProps {
  /** Caller-controlled visibility. Parent toggles open on `/` keystroke. */
  open: boolean
  /** Anchor element (the composer textarea) used to position the popover. */
  anchorRef: React.RefObject<HTMLElement | null>
  /** Filter substring — the text the user has typed AFTER the leading `/`. */
  query: string
  /** Full registry of slash commands available in the current chat / provider
   * context. The picker filters this list against `query` internally. */
  commands: ComposerSlashCommand[]
  /** Replace the slash token in the prompt with the selected command. */
  onPick: (command: ComposerSlashCommand) => void
  /** Dismiss without picking (Escape, click outside, blur). */
  onDismiss: () => void
  /**
   * 1.0.6-EW67 — Active composer shell, mirrored onto the portal
   * root as `shell-${composerStyle}`. The popover is portaled to
   * document.body (outside the composer subtree), so this class is
   * how the theme-immune Obsidian / Alabaster popover CSS reaches it.
   */
  composerStyle?: ComposerStyle
}

/**
 * Floating popover anchored to the composer textarea that lists provider-
 * aware slash commands. Triggered by the parent detecting a `/` keystroke
 * at start-of-line or after whitespace; selecting an item dispatches via
 * `onPick` which the parent then routes through the slash-command
 * dispatcher (`palette-passthrough` → existing `handlePaletteCommand`,
 * `gemini-pty` → `writeGeminiSession`, etc.).
 *
 * Visually + interactively mirrors `AgentMentionMenu` (the `@`-mention
 * picker that lives right below in App.tsx) — same fixed positioning,
 * same capture-phase keydown listener, same click-outside dismiss — so
 * the two popovers feel identical to the user even though they target
 * different surfaces.
 *
 * Keyboard handling:
 *   ArrowUp / ArrowDown — navigate
 *   Enter / Tab         — select highlighted item
 *   Escape              — dismiss
 *
 * Items are grouped by `group` (Core / Discovery / Memory / Inspectors /
 * Custom); group headers are non-interactive and don't participate in
 * keyboard navigation.
 */
export function ComposerSlashMenu({
  open,
  anchorRef,
  query,
  commands,
  onPick,
  onDismiss,
  composerStyle
}: ComposerSlashMenuProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  // Filtered + grouped command list. Filter substring lives entirely
  // inside the menu; the parent just hands us the full registry.
  const filtered = useMemo(() => {
    return filterComposerSlashCommands(commands, query)
  }, [commands, query])

  // Group commands keyed by their `group` field, in the canonical order
  // exported from the registry module. Used to render section headers
  // between item runs.
  const grouped = useMemo(() => {
    const groups: { group: CommandPaletteGroup; entries: ComposerSlashCommand[] }[] = []
    for (const group of COMPOSER_SLASH_GROUP_ORDER) {
      const entries = filtered.filter((entry) => entry.group === group)
      if (entries.length > 0) groups.push({ group, entries })
    }
    return groups
  }, [filtered])

  // Flat list (in render order) used by keyboard nav. Kept in lockstep
  // with the grouped render via `flatIndexFor`.
  const flat = useMemo(() => grouped.flatMap((block) => block.entries), [grouped])

  // Recompute popover position when the anchor moves / when opening.
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
      // Anchor the popover ABOVE the textarea so the input never gets
      // pushed down when the picker opens. Right-shift by 8px to match
      // the AgentMentionMenu's offset for visual continuity.
      setPosition({ left: rect.left + 8, top: rect.top - 8 })
    })
    return () => {
      cancelled = true
    }
  }, [open, anchorRef, query])

  // Reset highlight to the first item when the filter changes.
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setHighlight(0)
    })
    return () => {
      cancelled = true
    }
  }, [flat.length])

  // Keyboard handlers — capture phase so Enter inside the picker beats
  // the textarea's send-on-Enter. Same approach as AgentMentionMenu.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (!open) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onDismiss()
        return
      }
      if (flat.length === 0) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlight((current) => (current + 1) % flat.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlight((current) => (current - 1 + flat.length) % flat.length)
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const choice = flat[highlight]
        if (choice) onPick(choice)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, flat, highlight, onPick, onDismiss])

  // Click outside dismisses (anchor clicks bubble back into the textarea
  // and don't count as outside-clicks).
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

  // Build the row-index → flat-index map so we can highlight + dispatch
  // by clicking on grouped entries without losing nav coherence.
  let flatIndex = -1

  // Portal into document.body so the popover escapes any transformed
  // ancestor (notably `.welcome-mode .composer-area` which carries a
  // `transform: translateY(-18%)` on the new-chat landing). Without
  // the portal, that transform would trap `position: fixed`, causing
  // the popover to anchor against the transformed container instead
  // of the viewport — landing at the wrong vertical offset. Same
  // escape pattern as `SidebarOverflowMenu`.
  return createPortal(
    <div
      ref={popoverRef}
      className={`composer-slash-menu shell-${composerStyle || 'default'}`}
      role="listbox"
      aria-label="Slash command picker"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        transform: 'translateY(-100%)',
        zIndex: 50
      }}
    >
      {flat.length === 0 ? (
        <div className="composer-slash-menu-empty">
          {commands.length === 0 ? 'No slash commands available' : `No commands match "${query}"`}
        </div>
      ) : (
        <div className="composer-slash-menu-list">
          {grouped.map((block) => (
            <div key={block.group} className="composer-slash-menu-group">
              <div className="composer-slash-menu-group-title" aria-hidden>
                {block.group}
              </div>
              <ul className="composer-slash-menu-group-items" role="group">
                {block.entries.map((entry) => {
                  flatIndex += 1
                  const localFlatIndex = flatIndex
                  const isHighlighted = localFlatIndex === highlight
                  return (
                    <li
                      key={entry.id}
                      role="option"
                      aria-selected={isHighlighted}
                      className={`composer-slash-menu-item ${
                        isHighlighted ? 'is-highlighted' : ''
                      }`}
                      onMouseEnter={() => setHighlight(localFlatIndex)}
                      onClick={() => onPick(entry)}
                    >
                      <span className="composer-slash-menu-command">{entry.command}</span>
                      <span className="composer-slash-menu-copy">
                        <span className="composer-slash-menu-label">{entry.label}</span>
                        <span className="composer-slash-menu-description">{entry.description}</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body
  )
}
