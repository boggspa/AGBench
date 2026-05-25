import { Fragment } from 'react'
import type { EnsembleParticipant, ProviderId } from '../../../main/store/types'

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
 * textarea itself stays as a plain `<textarea>` (transparent
 * `color`, visible `caret-color`) so input handling stays normal —
 * this component only owns the painted text.
 *
 * Pattern is the standard syntax-highlight overlay used by code
 * editors that wrap a textarea: match font / padding / line-height
 * exactly, mirror the text content, layer behind. See the matching
 * CSS in `main.css` for the `.composer-textarea-wrap` +
 * `.composer-textarea-highlight` rules.
 *
 * Resolution mirrors `extractFirstEnsembleDmTarget` (id → provider
 * name → role, case-insensitive). Skipped reserved tokens
 * (`me`/`self`/`user`/`human`) and any unresolved tokens render as
 * plain text — same fall-through pattern as the transcript-side
 * `ParticipantMention` chip.
 */
export function ComposerHighlightOverlay({
  value,
  participants
}: ComposerHighlightOverlayProps): React.JSX.Element {
  const segments = tokeniseForHighlight(value, participants || [])
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

interface HighlightSegment {
  kind: 'text' | 'mention'
  text: string
  provider?: ProviderId
}

const MENTION_REGEX = /(^|[\s(\[{<>"'`!?,;:.])@([A-Za-z][A-Za-z0-9_-]{0,32})/g

function tokeniseForHighlight(
  value: string,
  participants: EnsembleParticipant[]
): HighlightSegment[] {
  if (!value) return []
  if (!value.includes('@') || participants.length === 0) {
    return [{ kind: 'text', text: value }]
  }
  const segments: HighlightSegment[] = []
  let lastIndex = 0
  MENTION_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MENTION_REGEX.exec(value)) !== null) {
    const [whole, prefix, token] = match
    const atIndex = match.index + prefix.length
    const resolved = resolveParticipantToken(token, participants)
    if (!resolved) continue
    if (atIndex > lastIndex) {
      segments.push({ kind: 'text', text: value.slice(lastIndex, atIndex) })
    }
    segments.push({
      kind: 'mention',
      text: `@${token}`,
      provider: resolved.provider
    })
    lastIndex = atIndex + 1 + token.length
    if (whole.length === 0) break
  }
  if (segments.length === 0) {
    return [{ kind: 'text', text: value }]
  }
  if (lastIndex < value.length) {
    segments.push({ kind: 'text', text: value.slice(lastIndex) })
  }
  return segments
}

function resolveParticipantToken(
  token: string,
  participants: EnsembleParticipant[]
): EnsembleParticipant | null {
  const trimmed = token.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (lower === 'me' || lower === 'self' || lower === 'user' || lower === 'human') {
    return null
  }
  return (
    participants.find((p) => p.id === trimmed) ||
    participants.find((p) => p.provider.toLowerCase() === lower) ||
    participants.find((p) => (p.role || '').trim().toLowerCase() === lower) ||
    null
  )
}
