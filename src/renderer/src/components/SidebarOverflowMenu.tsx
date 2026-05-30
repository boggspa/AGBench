import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

/**
 * Action item rendered inside the sidebar tile overflow menu. Items can be
 * grouped via the `group` discriminator: items in the same group render
 * together, the menu inserts a thin divider between groups so destructive
 * actions (delete) stay visually separated from neutral ones (pin, archive).
 */
export interface SidebarOverflowMenuItem {
  id: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  group?: 'primary' | 'secondary' | 'destructive'
}

interface SidebarOverflowMenuProps {
  /** Accessible label for the trigger button. Keeps the dots glyph
   * announceable for screen readers. */
  triggerLabel?: string
  /** Items to render in the menu. `undefined`-returning suppliers can be
   * trimmed by the caller before passing in. Empty list → menu trigger
   * still renders for layout consistency but presses no-op. */
  items: SidebarOverflowMenuItem[]
  /** When true the trigger button stays visible even at rest. Otherwise
   * the trigger fades in on tile hover via CSS (the tile is responsible
   * for setting :hover scope). */
  alwaysVisible?: boolean
  /** Optional className on the trigger button. */
  className?: string
}

const GROUP_ORDER: NonNullable<SidebarOverflowMenuItem['group']>[] = [
  'primary',
  'secondary',
  'destructive'
]

/**
 * Sidebar tile overflow menu. Tap the `…` glyph to open a popover with the
 * tile's actions; tap outside or press Escape to dismiss.
 *
 * The popover is rendered via `createPortal` into `document.body` and
 * positioned with `position: fixed` against the trigger's bounding rect.
 * This frees it from any sidebar scroll container's `overflow: hidden|auto`
 * (which would otherwise clip the menu and make items invisible/unclickable
 * — same pattern as `AgentMentionMenu`).
 */
export function SidebarOverflowMenu({
  triggerLabel = 'More actions',
  items,
  alwaysVisible = false,
  className
}: SidebarOverflowMenuProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null)
  // Trigger is rendered as a <span role="button"> rather than a real
  // <button> because tile rows are themselves buttons (chat tile = full
  // row click target) and nesting actual buttons is invalid HTML; the
  // sidebar uses the span+role pattern throughout for the same reason.
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()

  // Sort items by group so destructive lands at the bottom regardless of
  // caller ordering. Within a group, original order is preserved.
  const orderedItems = [...items].sort((a, b) => {
    const groupA = GROUP_ORDER.indexOf(a.group || 'primary')
    const groupB = GROUP_ORDER.indexOf(b.group || 'primary')
    return groupA - groupB
  })

  // Right-align the popover to the trigger's right edge; sit 4px below.
  // Expressed as a `right` offset from the viewport edge so the popover
  // doesn't slide off-screen on a narrow window.
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const right = Math.max(8, window.innerWidth - rect.right)
    const top = rect.bottom + 4
    setPosition({ top, right })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const handleDocumentMouseDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handleDocumentMouseDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  // Close on ancestor scroll (sidebar lists scroll, and we'd otherwise leave
  // a stale popover floating where the trigger used to be). Reposition on
  // viewport resize so the menu tracks layout changes.
  useEffect(() => {
    if (!open) return
    const handleScroll = () => setOpen(false)
    const handleResize = () => updatePosition()
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [open, updatePosition])

  // Reset focused index when menu closes so opening it again starts fresh.
  useEffect(() => {
    if (open) return
    const frame = window.requestAnimationFrame(() => setFocusedIndex(-1))
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const handleTriggerClick = (event: MouseEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setOpen((current) => !current)
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(true)
      setFocusedIndex(0)
    }
  }

  const handleItemSelect = (item: SidebarOverflowMenuItem) => {
    if (item.disabled) return
    setOpen(false)
    // Run the action after closing so any selection state in the menu
    // doesn't survive into the action's React updates.
    queueMicrotask(item.onSelect)
  }

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setFocusedIndex((index) => Math.min(orderedItems.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setFocusedIndex((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const target = orderedItems[focusedIndex]
      if (target) handleItemSelect(target)
    }
  }

  const triggerStyle: CSSProperties = alwaysVisible
    ? { opacity: 1 }
    : { opacity: open ? 1 : undefined }

  const popover =
    open && position
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            className="sidebar-overflow-menu-popover"
            style={{
              position: 'fixed',
              top: position.top,
              right: position.right,
              zIndex: 50
            }}
            onKeyDown={handleMenuKeyDown}
          >
            {orderedItems.map((item, index) => {
              const lastInGroup =
                index < orderedItems.length - 1 &&
                (orderedItems[index + 1].group || 'primary') !== (item.group || 'primary')
              return (
                <div key={item.id} className="sidebar-overflow-menu-item-wrap">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    className={`sidebar-overflow-menu-item ${item.danger ? 'is-danger' : ''} ${
                      focusedIndex === index ? 'is-focused' : ''
                    }`}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      handleItemSelect(item)
                    }}
                    onMouseEnter={() => setFocusedIndex(index)}
                  >
                    {item.icon && (
                      <span className="sidebar-overflow-menu-item-icon" aria-hidden>
                        {item.icon}
                      </span>
                    )}
                    <span className="sidebar-overflow-menu-item-label">{item.label}</span>
                  </button>
                  {lastInGroup && <div className="sidebar-overflow-menu-divider" aria-hidden />}
                </div>
              )
            })}
          </div>,
          document.body
        )
      : null

  return (
    <span className={`sidebar-overflow-menu ${open ? 'is-open' : ''}`}>
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        className={`sidebar-item-action sidebar-overflow-trigger ${className || ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={triggerLabel}
        title={triggerLabel}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        style={triggerStyle}
      >
        <span className="sf-symbol-icon" aria-hidden>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" role="img">
            <circle cx="3.2" cy="8" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="12.8" cy="8" r="1.4" />
          </svg>
        </span>
      </span>
      {popover}
    </span>
  )
}
