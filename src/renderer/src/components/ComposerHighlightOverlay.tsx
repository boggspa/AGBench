import { Fragment, useLayoutEffect, useRef, type RefObject } from 'react'
import type { EnsembleParticipant } from '../../../main/store/types'
import { tokeniseMentions } from '../lib/mentionHighlight'

interface ComposerHighlightOverlayProps {
  value: string
  /** Ensemble participants for the chat. Undefined / empty disables
   * the resolver — tokens just render as regular text in that case
   * since there's no participant to colour against. */
  participants?: EnsembleParticipant[]
  /**
   * 1.0.4 — Source-of-truth ref to the textarea this overlay is
   * mirroring. We read its `getComputedStyle()` and copy the
   * glyph-positioning properties onto the overlay so the two
   * layers stay metric-aligned regardless of per-shell or
   * per-theme CSS variation. Without this, every composer shell
   * needs hand-written CSS that mirrors the textarea's font /
   * padding / border — fragile, repetitive, and prone to drift.
   * See ledger `1.0.4 → 1.0.5 trajectory` for the contenteditable
   * migration that replaces this two-layer pattern entirely.
   */
  textareaRef: RefObject<HTMLTextAreaElement | null>
  /**
   * Changing this value forces a metric re-sync even when the
   * `textareaRef` identity hasn't changed. Parent uses it to
   * trigger sync on composer-style switches, theme flips, welcome
   * mode toggles — anything that might restyle the textarea
   * without resizing it (so the ResizeObserver wouldn't fire).
   * Any primitive works as a useLayoutEffect dep; we accept
   * string | number so the parent can compose a readable key
   * like `"codex|dark|welcome"` instead of hashing into an int.
   */
  syncEpoch: string | number
}

/**
 * Visual layer that sits OVER the composer textarea and renders
 * the same prompt text, except `@Token` mentions that resolve to a
 * participant get wrapped in a provider-tinted span. The textarea
 * itself stays as a plain `<textarea>` (handles caret, IME,
 * selection, paste); only when an `@-mention` is actually resolved
 * does the parent apply the `has-mention-overlay` class to make
 * the textarea text transparent so the overlay reads as the only
 * visible text source.
 *
 * Architecture (1.0.4):
 *   - The overlay's font / padding / border / line-height /
 *     letter-spacing are NOT set via CSS per-shell. They're copied
 *     from the textarea's `getComputedStyle()` at runtime via the
 *     `useLayoutEffect` below. That way every composer shell's
 *     textarea metrics flow through to the overlay automatically,
 *     no matter how many per-shell rules the shell stack adds.
 *   - A `ResizeObserver` on the textarea catches any size-changing
 *     style update (font-family swap, padding change, etc.) and
 *     re-syncs the overlay. Plus an explicit `syncEpoch` from the
 *     parent for shell-/theme-changes that don't actually resize.
 *
 * Why this exists: see `docs/VERSION-LEDGER.md → 1.0.5 trajectory`
 * for the planned `contenteditable` migration (Option B) that
 * eliminates the two-layer pattern entirely. This module is
 * Option A — the right short-term answer with zero risk to the
 * native typing UX.
 *
 * The actual tokenisation lives in `lib/mentionHighlight.ts` so the
 * same logic powers the transcript user-message bubbles and the
 * queued-messages above-row body text via `MentionHighlightedText`.
 */
export function ComposerHighlightOverlay({
  value,
  participants,
  textareaRef,
  syncEpoch
}: ComposerHighlightOverlayProps): React.JSX.Element {
  const segments = tokeniseMentions(value, participants || [])
  const overlayRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    const overlay = overlayRef.current
    if (!textarea || !overlay) return

    /**
     * Copy the textarea's computed glyph-positioning properties
     * onto the overlay. These are the ones that affect WHERE each
     * character sits — change any of them and the two layers
     * diverge.
     *
     * NOT copied:
     *   - `color` (textarea is transparent when has-mention-overlay
     *     is active; overlay needs its own color cascade)
     *   - `background` (per-shell chrome stays on the textarea;
     *     overlay sits over the top with no bg)
     *   - `outline` / `box-shadow` (textarea-specific affordances)
     *   - `text-align` / `direction` (inherit normally)
     *
     * Border space is matched with a transparent border on the
     * overlay so its content area is inset by the same number of
     * pixels as the textarea's (border-box accounting).
     */
    const syncStyles = (): void => {
      const cs = getComputedStyle(textarea)
      overlay.style.fontFamily = cs.fontFamily
      overlay.style.fontSize = cs.fontSize
      overlay.style.fontWeight = cs.fontWeight
      overlay.style.fontStyle = cs.fontStyle
      overlay.style.fontVariant = cs.fontVariant
      overlay.style.lineHeight = cs.lineHeight
      overlay.style.letterSpacing = cs.letterSpacing
      overlay.style.wordSpacing = cs.wordSpacing
      overlay.style.textTransform = cs.textTransform
      overlay.style.textIndent = cs.textIndent
      overlay.style.paddingTop = cs.paddingTop
      overlay.style.paddingRight = cs.paddingRight
      overlay.style.paddingBottom = cs.paddingBottom
      overlay.style.paddingLeft = cs.paddingLeft
      overlay.style.boxSizing = cs.boxSizing
      overlay.style.borderTopWidth = cs.borderTopWidth
      overlay.style.borderRightWidth = cs.borderRightWidth
      overlay.style.borderBottomWidth = cs.borderBottomWidth
      overlay.style.borderLeftWidth = cs.borderLeftWidth
      overlay.style.borderStyle = 'solid'
      overlay.style.borderColor = 'transparent'
    }

    // Initial sync
    syncStyles()

    // Catch any subsequent style change that affects the textarea's
    // size. `ResizeObserver` fires when content-box / border-box
    // dimensions change, which covers padding swaps, font-size
    // swaps, and most font-family swaps (different glyph widths
    // change the intrinsic size). For pure-styling changes that
    // don't resize (rare), the `syncEpoch` dep below handles it.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(syncStyles)
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [textareaRef, syncEpoch])

  return (
    <div ref={overlayRef} className="composer-textarea-highlight" aria-hidden="true">
      {segments.map((segment, idx) => {
        if (segment.kind === 'text') {
          return <Fragment key={idx}>{segment.text}</Fragment>
        }
        return (
          <span
            key={idx}
            className="composer-mention-token"
            style={{ color: `var(--provider-${segment.provider}-color, var(--accent))` }}
          >
            {segment.text}
          </span>
        )
      })}
      {/* Trailing newline so the overlay's last line gets line-height
          treatment even when `value` ends with `\n`. textareas treat
          a trailing newline as a real line; pre-wrap divs would
          collapse without this. */}
      {'\n'}
    </div>
  )
}
