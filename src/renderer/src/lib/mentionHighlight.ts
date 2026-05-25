import type { EnsembleParticipant, ProviderId } from '../../../main/store/types'
import {
  findAllMentions,
  findFirstMention,
  resolvePhraseToParticipant
} from '../../../main/services/EnsembleMentionAlias'

/**
 * Shared `@Token` mention tokeniser. Used by:
 *   - `ComposerHighlightOverlay` (composer textarea overlay)
 *   - `MentionHighlightedText` (user message bubbles + queued rows)
 *
 * Boundary + alias rules now live in
 * `src/main/services/EnsembleMentionAlias.ts` so the same logic
 * powers the renderer-side overlay AND the orchestrator's auto-
 * promotion path — no more drift between the two when we extend
 * the matcher (e.g. multi-word model aliases).
 *
 * Resolution priority (longest-prefix wins):
 *   1. 4-word phrase ("gpt 5 codex spark")
 *   2. 3-word phrase ("kimi k2 thinking")
 *   3. 2-word phrase ("gpt 5.5", "sonnet 4.7", "flash lite")
 *   4. 1-word phrase ("codex", "claude", "planner", "5.5")
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

/**
 * Legacy single-token resolver. Kept for callers that already
 * extracted the bare token (no leading `@`, no multi-word phrase).
 * New code should prefer the multi-word `findFirstMention` /
 * `findAllMentions` path via this module's higher-level functions.
 */
export function resolveParticipantToken(
  token: string,
  participants: EnsembleParticipant[]
): EnsembleParticipant | null {
  return resolvePhraseToParticipant(token, participants)
}

export function tokeniseMentions(
  value: string,
  participants: EnsembleParticipant[]
): MentionTokenSegment[] {
  if (!value) return []
  if (!value.includes('@') || participants.length === 0) {
    return [{ kind: 'text', text: value }]
  }
  const mentions = findAllMentions(value, participants)
  if (mentions.length === 0) {
    return [{ kind: 'text', text: value }]
  }
  const segments: MentionTokenSegment[] = []
  let lastIndex = 0
  for (const match of mentions) {
    if (match.atIndex > lastIndex) {
      segments.push({ kind: 'text', text: value.slice(lastIndex, match.atIndex) })
    }
    segments.push({
      kind: 'mention',
      text: `@${match.text}`,
      provider: match.participant.provider
    })
    lastIndex = match.atIndex + match.consumedLength
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
  return findFirstMention(value, participants) !== null
}
