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
 * Extract the first ensemble-dm participant id mentioned in a
 * composer prompt. Used on send to translate an `@participant`
 * mention into the `dmTargetParticipantId` field on the run
 * payload — the orchestrator scopes the round to just that
 * participant when set.
 *
 * Matches the markdown link form inserted by the participant
 * mention pick handler: `[@Role](ensemble-dm://participant-id)`.
 * Returns the first match only; if a user wrote `@A @B` we DM A.
 */
export function extractFirstEnsembleDmTarget(prompt: string): string | null {
  const match = prompt.match(/\]\(ensemble-dm:\/\/([^)\s]+)\)/)
  return match ? match[1] : null
}
