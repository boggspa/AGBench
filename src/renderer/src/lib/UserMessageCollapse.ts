/**
 * UserMessageCollapse — pure helpers for deciding when a user message in the
 * transcript should be truncated, and for building the collapsed preview.
 *
 * Why this matters: long pasted briefs dominate the transcript scroll viewport
 * and push later assistant output off-screen. Collapsing them by default keeps
 * the conversation legible while preserving full content behind a "Show more"
 * toggle.
 *
 * The thresholds are intentionally generous: most ordinary prompts stay
 * uncollapsed, and only the heavy briefs (multi-paragraph plans, code dumps,
 * spec documents) get clipped.
 */

export interface UserMessageCollapseThresholds {
  /** Lines beyond this trigger collapse. */
  readonly maxLines: number;
  /** Characters beyond this trigger collapse. */
  readonly maxChars: number;
  /** Lines shown when collapsed. */
  readonly previewLines: number;
  /** Characters shown when collapsed. */
  readonly previewChars: number;
}

/**
 * Default thresholds: a message over 12 lines or 800 chars collapses, and the
 * preview shows 8 lines / 500 chars. Picked to cover typical pasted briefs
 * while keeping ordinary multi-sentence prompts intact.
 */
export const DEFAULT_USER_MESSAGE_COLLAPSE_THRESHOLDS: UserMessageCollapseThresholds = {
  maxLines: 12,
  maxChars: 800,
  previewLines: 8,
  previewChars: 500
};

function countLines(content: string): number {
  if (content.length === 0) return 0;
  // Splitting on \n counts an N-line block as N lines even without a trailing
  // newline — that matches what a reader visually sees in the bubble.
  return content.split('\n').length;
}

/**
 * Returns true when the message should be rendered in collapsed form.
 * Whitespace-only or empty strings never collapse: there is nothing to hide.
 */
export function shouldCollapseUserMessage(
  content: string,
  thresholds: UserMessageCollapseThresholds = DEFAULT_USER_MESSAGE_COLLAPSE_THRESHOLDS
): boolean {
  if (typeof content !== 'string') return false;
  if (content.trim().length === 0) return false;
  if (content.length > thresholds.maxChars) return true;
  if (countLines(content) > thresholds.maxLines) return true;
  return false;
}

/**
 * Trim a string to end at a word boundary at or before `maxChars`.
 * Falls back to a hard cut if there is no whitespace in the run, so we never
 * exceed the budget.
 */
function truncateAtWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  // Look for the last whitespace inside the slice. The match position is the
  // index of the trailing whitespace+word run we want to drop. Anything > 0
  // is a safe place to cut — we just need *some* word to remain in the
  // preview, otherwise the bubble would look empty.
  const lastWs = slice.search(/\s\S*$/);
  if (lastWs > 0) {
    return slice.slice(0, lastWs);
  }
  return slice;
}

/**
 * Build the collapsed preview for a message that already passed
 * `shouldCollapseUserMessage`. The returned string is never longer than
 * `previewChars` and respects `previewLines` as a soft upper bound.
 *
 * The cut is taken at a word boundary so the preview reads as a coherent
 * sentence fragment, not "Lorem ips" mid-word.
 *
 * Markdown fences (```) are honoured: if the preview cut would leave a fenced
 * block unterminated, we step back to before the opening fence so the preview
 * never shows a broken half-block.
 */
export function truncateUserMessagePreview(
  content: string,
  thresholds: UserMessageCollapseThresholds = DEFAULT_USER_MESSAGE_COLLAPSE_THRESHOLDS
): string {
  if (typeof content !== 'string' || content.length === 0) return '';

  const lines = content.split('\n');
  let byLines: string;
  if (lines.length > thresholds.previewLines) {
    byLines = lines.slice(0, thresholds.previewLines).join('\n');
  } else {
    byLines = content;
  }

  const byChars = truncateAtWordBoundary(byLines, thresholds.previewChars);

  // Guard against breaking a markdown code fence in half. If the preview
  // contains an odd number of ``` fences, walk back to before the unclosed
  // opener so the bubble never renders a dangling block.
  const fenceCount = (byChars.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) {
    const lastFenceIdx = byChars.lastIndexOf('```');
    if (lastFenceIdx > 0) {
      return byChars.slice(0, lastFenceIdx).replace(/\s+$/, '');
    }
  }

  return byChars;
}
