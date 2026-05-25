import { Fragment } from 'react'
import type { EnsembleParticipant } from '../../../main/store/types'
import { tokeniseMentions } from '../lib/mentionHighlight'

interface ComposerHighlightOverlayProps {
  value: string
  /** Ensemble participants for the chat. Undefined / empty disables
   * the resolver — tokens just render as regular text in that case
   * since there's no participant to colour against. */
  participants?: EnsembleParticipant[]
}

/**
 * Visual layer that sits BEHIND the composer textarea and renders
 * the same prompt text, except `@Token` mentions that resolve to a
 * participant get wrapped in a bold, provider-tinted span. The
 * textarea itself stays as a plain `<textarea>` — only when an
 * `@-mention` is actually resolved in the prompt does the parent
 * apply the `has-mention-overlay` class to make the textarea text
 * transparent so the overlay shows through. Without that gate, the
 * overlay's slightly-different per-shell padding (Claude / Codex /
 * Kimi / etc. each override padding) caused the text to drift away
 * from the caret on the welcome screen — Chris's "user entry prompt
 * text is invisible" / "vertical padding out of sync" report.
 *
 * Pattern is the standard syntax-highlight overlay used by code
 * editors that wrap a textarea: match font / padding / line-height
 * exactly, mirror the text content, layer behind. See the matching
 * CSS in `main.css` for the `.composer-textarea-wrap` +
 * `.composer-textarea-highlight` rules.
 *
 * The actual tokenisation lives in `lib/mentionHighlight.ts` so the
 * same logic powers the transcript user-message bubbles and the
 * queued-messages above-row body text via `MentionHighlightedText`.
 */
export function ComposerHighlightOverlay({
  value,
  participants
}: ComposerHighlightOverlayProps): React.JSX.Element {
  const segments = tokeniseMentions(value, participants || [])
  return (
    <div className="composer-textarea-highlight" aria-hidden="true">
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
