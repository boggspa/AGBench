import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface ComposerTextareaContextMenuProps {
  anchor: { x: number; y: number } | null
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onValueChange: (value: string) => void
  onClose: () => void
}

interface MenuItem {
  id: string
  label: string
  shortcut?: string
  disabled?: boolean
  onSelect: () => void
}

function applyTextareaValue(
  textarea: HTMLTextAreaElement,
  nextValue: string,
  selectionStart: number,
  selectionEnd: number,
  onValueChange: (value: string) => void
): void {
  onValueChange(nextValue)
  requestAnimationFrame(() => {
    textarea.focus()
    textarea.setSelectionRange(selectionStart, selectionEnd)
  })
}

function hasSelection(textarea: HTMLTextAreaElement): boolean {
  return textarea.selectionStart !== textarea.selectionEnd
}

export function useComposerTextareaContextMenu(): {
  anchor: { x: number; y: number } | null
  setAnchor: (anchor: { x: number; y: number } | null) => void
  handleContextMenu: (event: MouseEvent<HTMLTextAreaElement>) => void
} {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)

  const handleContextMenu = (event: MouseEvent<HTMLTextAreaElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    setAnchor({ x: event.clientX, y: event.clientY })
  }

  return { anchor, setAnchor, handleContextMenu }
}

export function ComposerTextareaContextMenu({
  anchor,
  textareaRef,
  onValueChange,
  onClose
}: ComposerTextareaContextMenuProps): React.JSX.Element | null {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!anchor) return
    const handlePointerDown = (event: globalThis.MouseEvent): void => {
      const target = event.target as Node
      if (menuRef.current?.contains(target)) return
      onClose()
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('mousedown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [anchor, onClose])

  if (!anchor) return null

  const textarea = textareaRef.current
  const selectionActive = textarea ? hasSelection(textarea) : false
  const hasText = Boolean(textarea?.value)

  const items: MenuItem[] = [
    {
      id: 'cut',
      label: 'Cut',
      shortcut: '⌘X',
      disabled: !selectionActive,
      onSelect: () => {
        if (!textarea || !selectionActive) return
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const selected = textarea.value.slice(start, end)
        void navigator.clipboard.writeText(selected).catch(() => undefined)
        const nextValue = textarea.value.slice(0, start) + textarea.value.slice(end)
        applyTextareaValue(textarea, nextValue, start, start, onValueChange)
        onClose()
      }
    },
    {
      id: 'copy',
      label: 'Copy',
      shortcut: '⌘C',
      disabled: !selectionActive,
      onSelect: () => {
        if (!textarea || !selectionActive) return
        const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)
        void navigator.clipboard.writeText(selected).catch(() => undefined)
        onClose()
      }
    },
    {
      id: 'paste',
      label: 'Paste',
      shortcut: '⌘V',
      onSelect: () => {
        if (!textarea) return
        void navigator.clipboard
          .readText()
          .then((text) => {
            const start = textarea.selectionStart
            const end = textarea.selectionEnd
            const nextValue = textarea.value.slice(0, start) + text + textarea.value.slice(end)
            const caret = start + text.length
            applyTextareaValue(textarea, nextValue, caret, caret, onValueChange)
            onClose()
          })
          .catch(() => {
            textarea.focus()
            document.execCommand('paste')
            applyTextareaValue(
              textarea,
              textarea.value,
              textarea.selectionStart,
              textarea.selectionEnd,
              onValueChange
            )
            onClose()
          })
      }
    },
    {
      id: 'select-all',
      label: 'Select All',
      shortcut: '⌘A',
      disabled: !hasText,
      onSelect: () => {
        if (!textarea || !hasText) return
        textarea.focus()
        textarea.select()
        onClose()
      }
    }
  ]

  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - 200))
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - 180))

  return createPortal(
    <div
      ref={menuRef}
      className="composer-textarea-context-menu"
      style={{ position: 'fixed', left: `${left}px`, top: `${top}px` }}
      role="menu"
      aria-label="Composer text actions"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className="composer-textarea-context-menu-item"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return
            item.onSelect()
          }}
        >
          <span className="composer-textarea-context-menu-label">{item.label}</span>
          {item.shortcut ? (
            <span className="composer-textarea-context-menu-shortcut">{item.shortcut}</span>
          ) : null}
        </button>
      ))}
    </div>,
    document.body
  )
}
