/**
 * Composer mention trigger detection.
 *
 * Two triggers, each preceded by whitespace or start-of-line so they
 * don't fire inside ordinary words like `email@example.com` or
 * `flag--@disabled`:
 *
 *   - `@<query>` → mention trigger. In normal chats this surfaces
 *     active sub-agents; in ensemble chats it surfaces participants
 *     so the user can DM-target a specific provider for the next
 *     round (routed via `dmTargetParticipantId`).
 *   - `-@<query>` → file mention trigger. Lists workspace files
 *     and already-granted external paths — the legacy behaviour
 *     that `@` used to own before participant-DM mentions took
 *     it over.
 *
 * The order matters: file trigger checked first so `-@` doesn't
 * accidentally match the plain `@` regex (the regex requires
 * whitespace before `@`, which `-` doesn't satisfy, so the
 * disambiguation is mechanical — but checking explicitly leaves no
 * room for someone tightening the regex later and creating a
 * silent overlap).
 */

export type ComposerMentionTriggerKind = 'mention' | 'file-mention'

export interface ComposerMentionTrigger {
  /** Index in `value` where the trigger character(s) begin. The
   * caller uses this + `triggerLength` + `query.length` to splice
   * the inserted mention text in place. */
  anchorIndex: number
  /** 1 for `@`, 2 for `-@`. The pick handler needs this to know
   * how many characters to strip when replacing the trigger with
   * the picked mention's markdown. */
  triggerLength: number
  kind: ComposerMentionTriggerKind
  query: string
}

export function parseComposerMentionTrigger(
  value: string,
  caretIndex: number = value.length
): ComposerMentionTrigger | null {
  const caret = Math.max(0, Math.min(caretIndex, value.length))
  const before = value.slice(0, caret)

  // File trigger: `-@<query>` preceded by whitespace or start-of-line.
  // Anchor lands at the index of the `-`.
  const fileMatch = before.match(/(^|\s)-@([^\s@]*)$/)
  if (fileMatch) {
    return {
      anchorIndex: caret - (fileMatch[2].length + 2),
      triggerLength: 2,
      kind: 'file-mention',
      query: fileMatch[2]
    }
  }

  // Plain mention: `@<query>` preceded by whitespace or start-of-line.
  // Anchor lands at the index of the `@`.
  const mentionMatch = before.match(/(^|\s)@([^\s@]*)$/)
  if (mentionMatch) {
    return {
      anchorIndex: caret - (mentionMatch[2].length + 1),
      triggerLength: 1,
      kind: 'mention',
      query: mentionMatch[2]
    }
  }
  return null
}

export function formatComposerPathMention(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''
  if (/\s/.test(trimmed)) return `${JSON.stringify(trimmed)} `
  return `${trimmed} `
}

/**
 * Resolver shape for the participant lookup. Keeps this module from
 * importing the full `EnsembleParticipant` type — only the three
 * fields the matcher actually reads.
 */
export interface EnsembleDmCandidate {
  id: string
  role?: string
  provider: string
}

/**
 * Extract the first ensemble-dm participant id mentioned in a
 * composer prompt. Used on send to translate an `@participant`
 * mention into the `dmTargetParticipantId` field on the run
 * payload — the orchestrator scopes the round to just that
 * participant when set.
 *
 * Two recognised forms (in priority order):
 *
 *   1. Markdown link form `[@Role](ensemble-dm://participant-id)`.
 *      Legacy from the first pass of the @-mention work — kept so
 *      historical prompts still route correctly.
 *
 *   2. Plain `@Token` (token = word chars + dashes). Resolved
 *      against the supplied participants list, matching first by
 *      role (case-insensitive, trimmed) then by provider name.
 *      This is what the composer's mention picker now inserts —
 *      readable in the textarea, no markdown noise, and free-typed
 *      `@Gemini` works the same way as a picker click.
 *
 * Returns the FIRST match found. If a user wrote `@A @B` we DM A.
 */
export function extractFirstEnsembleDmTarget(
  prompt: string,
  participants?: EnsembleDmCandidate[]
): string | null {
  // Markdown form — always wins because the link unambiguously
  // carries the participant id.
  const linkMatch = prompt.match(/\]\(ensemble-dm:\/\/([^)\s]+)\)/)
  if (linkMatch) return linkMatch[1]

  if (!participants || participants.length === 0) return null
  // Plain `@Token` — match at word boundaries so emails like
  // `chris@example.com` don't get picked up. Pattern mirrors the
  // transcript-side `ParticipantMention` tokeniser in
  // `StableMarkdownBlock`.
  const re = /(^|[\s(\[{<>"'`!?,;:.])@([A-Za-z][A-Za-z0-9_-]{0,32})/g
  let match: RegExpExecArray | null
  while ((match = re.exec(prompt)) !== null) {
    const token = match[2]
    const lower = token.toLowerCase()
    const byRole = participants.find(
      (p) => (p.role || '').trim().toLowerCase() === lower
    )
    if (byRole) return byRole.id
    const byProvider = participants.find((p) => p.provider.toLowerCase() === lower)
    if (byProvider) return byProvider.id
  }
  return null
}
