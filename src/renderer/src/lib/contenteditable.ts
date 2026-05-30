/**
 * 1.0.5-C5 — Pure helpers for the contenteditable composer.
 *
 * The composer migration replaces the `<textarea>` +
 * `ComposerHighlightOverlay` two-layer pattern with a single
 * `contenteditable="true"` `<div>`. Mention spans become real
 * inline elements in the editable region rather than a parallel
 * overlay we have to keep visually aligned.
 *
 * This module is the testable substrate — the React wrapper in
 * `components/ContenteditableComposer.tsx` is a thin layer on top
 * that handles event wiring + ref forwarding. All DOM-touching
 * logic lives there; everything pure (HTML escape, plain-text
 * extract, mention-segment builder, paste normalisation) lives
 * here so vitest's Node environment can exercise it without
 * jsdom.
 *
 * **Single source of truth**: the plain text. We never read from
 * the DOM's textContent at submit time — instead the wrapper
 * keeps a controlled `value` string in React state, and the
 * helpers produce DOM HTML strings from it on render. This
 * matches the existing `composerInput` shape and lets the
 * orchestrator submit the plain string unchanged.
 */

/**
 * 1.0.5-C5 — Mention segment shape. Identical to what
 * `mentionHighlight.ts` already produces for the overlay, kept
 * structurally separate here so this module has zero dependencies
 * (eases testing + future extraction).
 */
export interface MentionSegment {
  /** Inclusive start offset in the plain text. */
  start: number
  /** Exclusive end offset in the plain text. */
  end: number
  /** What the mention resolves to (e.g. participant id,
   * provider name). Stored on the rendered span's data attribute
   * so renderer-side handlers can detect / style / route it. */
  data: string
  /** Optional CSS class added to the span (e.g.
   * `provider-codex`). */
  className?: string
}

/**
 * Escape a string for safe HTML interpolation. Same shape as
 * the standard 5-char escape; no entity name lookups, no double
 * escape. Used by `buildContenteditableHtml` to ensure user text
 * never gets parsed as HTML.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Build the HTML string the contenteditable surface renders. The
 * plain text is escaped + mention segments become `<span>`
 * elements with `data-mention` + optional `className`. Anything
 * outside a mention is wrapped in plain text nodes.
 *
 * Mentions are sorted + clamped — overlapping mentions throw
 * (caller should never produce them; the resolver guarantees
 * non-overlap, and a throw is louder than silent corruption).
 *
 * Empty text produces a `<br>` so the contenteditable has
 * non-zero height + the placeholder pseudo-element shows.
 */
export function buildContenteditableHtml(text: string, mentions: MentionSegment[]): string {
  if (!text) return '<br>'
  if (mentions.length === 0) return escapeHtml(text).replace(/\n/g, '<br>')
  // Sort + validate non-overlap.
  const sorted = [...mentions].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      throw new Error(
        `Overlapping mentions: [${sorted[i - 1].start},${sorted[i - 1].end}) and [${sorted[i].start},${sorted[i].end})`
      )
    }
  }
  let out = ''
  let cursor = 0
  for (const mention of sorted) {
    if (mention.start < cursor) continue // safety guard
    // Plain text up to the mention.
    if (mention.start > cursor) {
      out += escapeHtml(text.slice(cursor, mention.start)).replace(/\n/g, '<br>')
    }
    const classAttr = mention.className ? ` class="${escapeHtml(mention.className)}"` : ''
    out += `<span data-mention="${escapeHtml(mention.data)}"${classAttr}>${escapeHtml(text.slice(mention.start, mention.end))}</span>`
    cursor = mention.end
  }
  // Trailing plain text.
  if (cursor < text.length) {
    out += escapeHtml(text.slice(cursor)).replace(/\n/g, '<br>')
  }
  return out
}

/**
 * Extract plain text from arbitrary HTML — used to normalise
 * pasted clipboard content. Strips ALL tags + entities, turns
 * `<br>` and `<p>` into newlines, then collapses runs of
 * whitespace beyond what the user expects.
 *
 * Pure (no DOM); a simple regex pass since contenteditable
 * paste data tends to be small + well-formed. Edge cases that
 * matter:
 *   - `<br>` → `\n`
 *   - `<br/>` / `<br />` → `\n`
 *   - `</p>` / `</div>` → `\n` (paragraph break)
 *   - HTML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`,
 *     `&nbsp;`) decoded
 *   - All other tags stripped without leaving content gaps
 *   - Leading/trailing whitespace trimmed
 */
export function normalisePastedText(input: string): string {
  if (!input) return ''
  // Newline conversions first so we don't lose them in the
  // tag-strip pass. Block-level closers emit a double newline
  // so paragraph separation survives the collapse-3+-to-2 pass
  // below; `<br>` stays single-newline.
  let out = input.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n\n')
  // Strip remaining tags.
  out = out.replace(/<[^>]+>/g, '')
  // Decode common entities.
  out = out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
  // Collapse 3+ consecutive newlines to 2 (preserve paragraph
  // breaks but avoid huge runs from div-soup HTML).
  out = out.replace(/\n{3,}/g, '\n\n')
  // Trim leading/trailing whitespace (most pastes come with
  // surrounding ws that the user doesn't want).
  return out.trim()
}

/**
 * Compute where the caret will land after inserting `inserted`
 * at `caretOffset` in `value`. Returns the new total text +
 * the new caret offset. The React wrapper uses this on
 * `insertText` / `insertMention` so the caret restores
 * predictably without per-shell DOM traversal.
 *
 * Pure — caller passes current value + offset, gets back the
 * next value + offset.
 */
export function spliceTextAtCaret(input: {
  value: string
  caretOffset: number
  inserted: string
}): { value: string; caretOffset: number } {
  const safeOffset = Math.max(0, Math.min(input.value.length, input.caretOffset))
  return {
    value: input.value.slice(0, safeOffset) + input.inserted + input.value.slice(safeOffset),
    caretOffset: safeOffset + input.inserted.length
  }
}

/**
 * Compute a `(value, caretOffset)` pair for replacing the
 * "trigger" segment immediately before the caret with a mention.
 *
 * Use case: user types `@Cod`, the mention picker pops, user
 * selects `@Codex`. This replaces the partial `@Cod` with the
 * final mention text. Caret lands at end of inserted text.
 *
 * `triggerLength` is the number of characters BEFORE the caret
 * that should be replaced (e.g. 4 for `@Cod` including the `@`).
 */
export function replaceTriggerWithMention(input: {
  value: string
  caretOffset: number
  triggerLength: number
  mentionText: string
}): { value: string; caretOffset: number } {
  const safeCaret = Math.max(0, Math.min(input.value.length, input.caretOffset))
  const safeTrigger = Math.max(0, Math.min(safeCaret, input.triggerLength))
  const start = safeCaret - safeTrigger
  return {
    value: input.value.slice(0, start) + input.mentionText + input.value.slice(safeCaret),
    caretOffset: start + input.mentionText.length
  }
}
