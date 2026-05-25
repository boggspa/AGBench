import type { EnsembleParticipant, ProviderId } from '../../../main/store/types'

/**
 * Shared `@Token` mention tokeniser. Used by:
 *   - `ComposerHighlightOverlay` (composer textarea overlay)
 *   - `MentionHighlightedText` (user message bubbles + queued rows)
 *
 * Same boundary rules as the transcript-side tokeniser in
 * `StableMarkdownBlock.tsx` so coverage stays aligned — `@email.com`
 * style false-positives are filtered by requiring a word boundary
 * (start of string OR a whitespace / punctuation char) before `@`.
 *
 * Resolution priority mirrors `resolveYieldTargetIndex` /
 * `extractFirstEnsembleDmTarget`:
 *   1. exact participant.id
 *   2. case-insensitive provider name
 *   3. case-insensitive role match
 *
 * Reserved words (me/self/user/human) never resolve — agents
 * referencing the user shouldn't paint as a participant.
 */

export interface MentionTokenSegment {
  kind: 'text' | 'mention'
  text: string
  /** Provider id for `kind === 'mention'` — drives the tint via
   * `var(--provider-{name}-color)`. Undefined for text segments. */
  provider?: ProviderId
}

const MENTION_REGEX = /(^|[\s(\[{<>"'`!?,;:.])@([A-Za-z][A-Za-z0-9_-]{0,32})/g

const RESERVED_TOKENS = new Set(['me', 'self', 'user', 'human'])

export function resolveParticipantToken(
  token: string,
  participants: EnsembleParticipant[]
): EnsembleParticipant | null {
  const trimmed = token.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (RESERVED_TOKENS.has(lower)) return null
  return (
    participants.find((p) => p.id === trimmed) ||
    participants.find((p) => p.provider.toLowerCase() === lower) ||
    participants.find((p) => (p.role || '').trim().toLowerCase() === lower) ||
    null
  )
}

export function tokeniseMentions(
  value: string,
  participants: EnsembleParticipant[]
): MentionTokenSegment[] {
  if (!value) return []
  if (!value.includes('@') || participants.length === 0) {
    return [{ kind: 'text', text: value }]
  }
  const segments: MentionTokenSegment[] = []
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

/** Fast predicate — does this value contain at least one resolved
 * `@Token` mention? Used by the composer to decide whether to
 * activate the overlay (and zero-out the textarea's text colour).
 * Cheaper than calling `tokeniseMentions` when callers only need
 * the boolean. */
export function hasResolvedMention(
  value: string,
  participants: EnsembleParticipant[]
): boolean {
  if (!value || !value.includes('@') || participants.length === 0) return false
  MENTION_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MENTION_REGEX.exec(value)) !== null) {
    if (resolveParticipantToken(match[2], participants)) return true
  }
  return false
}
