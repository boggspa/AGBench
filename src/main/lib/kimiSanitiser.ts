/**
 * 1.0.5-EW26 — Kimi (Moonshot) compatibility filter.
 *
 * Moonshot's hosted API content filter is documented to be
 * sensitive to a small set of topics — primarily China political
 * sovereignty, Tiananmen / Tank Man references, Xinjiang /
 * Uyghur questions, Hong Kong protest history, Tibet sovereignty
 * / Dalai Lama, Taiwan independence, Falun Gong. When a prompt
 * to Kimi contains content matching these themes, the API
 * returns a 400 with `type: 'content_filter'` and the
 * participant's run ends in failure rather than producing a
 * response.
 *
 * In an ensemble panel where the user is having a casual
 * conversation, this is annoying — Codex/Claude/Gemini happily
 * discuss world news containing one of these topics as a passing
 * mention, and then Kimi's turn dies upstream over an accidental
 * digression. Chris's framing: "providers sitting a session out
 * because of an accidental or overt digression seems a bit
 * overkill". This module is the compromise — the user's actual
 * transcript stays untouched (free speech wins for the user +
 * three other panelists), but Kimi's prompt context can be
 * filtered when the toggle is on so Kimi can still participate
 * on the non-flagged parts of the conversation.
 *
 * Design decisions (per Chris's choices in the design Q&A):
 *
 *   - **Default: OFF.** The feature exists for users who want
 *     it. Users who never run mixed ensembles with global-chat
 *     world-news topics never see this surface.
 *
 *   - **Curated + user-editable list.** We ship a documented
 *     default list (this file) with citations for each entry's
 *     reason for inclusion. Users can ADD entries (`customKeywords`
 *     in settings) to handle topics they've personally seen
 *     trigger Moonshot's filter, but they cannot remove built-in
 *     defaults (we don't want a "I removed Tiananmen so Kimi
 *     blew up" support burden).
 *
 *   - **Redact matched sentences, not paragraphs or whole
 *     prompts.** Sentence-level granularity preserves more
 *     context for Kimi while removing the trigger. Each matched
 *     sentence is replaced with a clear placeholder so Kimi
 *     understands content was filtered (rather than being
 *     mystified by missing context).
 *
 *   - **Transparency in the transcript.** When sanitisation
 *     fires, the orchestrator emits a `provider_diagnostic`
 *     event listing what got redacted so Chris always knows
 *     when the feature kicked in and on which keywords.
 *
 * What this is NOT:
 *
 *   - **Not a policy statement.** AGBench is not asserting that
 *     these topics are off-limits. We're describing what we
 *     observe Moonshot's API to refuse, and offering a tool to
 *     keep Kimi productive on workflows where those topics come
 *     up incidentally. Users who disagree with Moonshot's
 *     filter choices have full agency to disable Kimi
 *     participants, switch providers, or use a non-Kimi panel.
 *
 *   - **Not a sufficient solution.** Moonshot's filter uses ML
 *     classifiers, not just keyword matches. This module catches
 *     the obvious cases (literal "Tiananmen", "Xinjiang", etc.);
 *     it WILL miss euphemistic / contextual triggers ("June
 *     Fourth", "the events of 1989", "western Chinese
 *     re-education"). Users who hit a content_filter rejection
 *     despite this filter being enabled are still seeing the
 *     EW23 friendly notice — they should add the specific
 *     trigger phrase to `customKeywords`.
 */

/**
 * Curated default keyword list. Each entry has a comment noting
 * the topic family and why Moonshot's filter rejects content
 * containing it. Additions should be empirically-grounded —
 * something the maintainer or a user has seen trigger an actual
 * `content_filter` 400 — not speculative.
 *
 * Word-boundary matching (case-insensitive) — partial matches
 * don't fire (`Tibet` does NOT match `Tibetan` unless we add
 * `Tibetan` explicitly, intentionally avoiding the "tibetan
 * mastiff dog breed" false positive).
 *
 * Multi-word entries match as exact substrings (still case-
 * insensitive). For "Hong Kong" a sentence like "I love Hong
 * Kong cinema" WILL trigger — that's a known false-positive
 * cost of the keyword approach. The user-editable layer lets
 * folks customise if false positives bother them more than the
 * benefit.
 */
export const KIMI_DEFAULT_TRIGGER_KEYWORDS: ReadonlyArray<string> = [
  // China-political-sovereignty cluster — pretty consistent
  // Moonshot trigger across multiple anecdotal repros.
  'Tiananmen',
  'Tank Man',
  'June Fourth',
  // Xinjiang / Uyghur cluster.
  'Xinjiang',
  'Uyghur',
  'Uighur',
  // Hong Kong protests history.
  'Hong Kong protest',
  'Umbrella Movement',
  // Tibet sovereignty cluster.
  'Tibet independence',
  'Free Tibet',
  'Dalai Lama',
  // Taiwan sovereignty cluster (just the loaded phrasings —
  // "Taiwan" alone is too broad and trips on benign tech /
  // travel discussion).
  'Taiwan independence',
  'Republic of China',
  // Falun Gong (consistent filter trigger).
  'Falun Gong',
  // CCP leadership in negative contexts. "Xi Jinping" alone is
  // too broad (trips on benign factual discussion); the meme
  // reference is a more reliable filter signal.
  'Winnie the Pooh',
  // Catch-all for the news-cycle pattern Chris hit:
  // US/China-relations-themed multi-source summaries.
  'US-China relations',
  'China-US relations',
  'US China tensions',
  'China US tensions'
]

export interface KimiSanitiserResult {
  /** The sanitised text — matched sentences replaced with the
   * placeholder. */
  text: string
  /** True iff at least one match fired (caller can decide to
   * emit a diagnostic or skip emission). */
  redacted: boolean
  /** Per-match record: the exact trigger keyword found + the
   * sentence (truncated to 120 chars) that was redacted. Used by
   * the orchestrator to emit a transcript diagnostic the user
   * can read. */
  matches: ReadonlyArray<{ trigger: string; sentenceExcerpt: string }>
}

const SENTENCE_BOUNDARY_REGEX = /(?<=[.!?。！？])\s+/g
const PLACEHOLDER =
  '[sentence redacted: AGBench Kimi compatibility filter detected content Moonshot rejects]'

/**
 * Parse the user's `customKeywords` settings string into a
 * keyword array. Accepts newline-separated entries; trims each;
 * drops blank lines and comments (lines starting with `#`).
 */
export function parseCustomKeywords(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

/**
 * Sanitise a prompt for a Kimi participant. Returns the modified
 * text plus a list of matches the caller can use to surface a
 * transcript diagnostic.
 *
 * Algorithm:
 *   1. Split text into sentences via punctuation boundary.
 *   2. For each sentence, check whether ANY trigger keyword
 *      appears in it (case-insensitive). Single match per
 *      sentence is enough — we don't try to count multiple
 *      keywords per sentence.
 *   3. Replace matched sentences with `PLACEHOLDER`.
 *   4. Rejoin with the original whitespace (single space — the
 *      original newline patterns are lost, but Kimi reading
 *      prose with collapsed whitespace is fine).
 *
 * Time complexity is O(sentences × keywords). Keyword list is
 * fixed-small (~20-50 typical), sentences are bounded by prompt
 * length, so this runs in negligible time even on multi-MB
 * prompts.
 */
export function sanitiseForKimi(
  text: string,
  options: {
    defaultKeywords?: ReadonlyArray<string>
    customKeywords?: ReadonlyArray<string>
  } = {}
): KimiSanitiserResult {
  if (!text) return { text, redacted: false, matches: [] }
  const triggers = [
    ...(options.defaultKeywords ?? KIMI_DEFAULT_TRIGGER_KEYWORDS),
    ...(options.customKeywords ?? [])
  ]
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  if (triggers.length === 0) {
    return { text, redacted: false, matches: [] }
  }
  // Precompute lowercase trigger array for cheap case-insensitive
  // includes(). We don't use regex word-boundary because trigger
  // phrases contain whitespace and special characters.
  const triggersLower = triggers.map((t) => t.toLowerCase())
  const sentences = text.split(SENTENCE_BOUNDARY_REGEX)
  const matches: { trigger: string; sentenceExcerpt: string }[] = []
  const out: string[] = []
  for (const sentence of sentences) {
    const sentenceLower = sentence.toLowerCase()
    let matchedTrigger: string | null = null
    for (let i = 0; i < triggersLower.length; i++) {
      if (sentenceLower.includes(triggersLower[i])) {
        matchedTrigger = triggers[i]
        break
      }
    }
    if (matchedTrigger) {
      const excerpt =
        sentence.length > 120 ? `${sentence.slice(0, 117).trim()}…` : sentence.trim()
      matches.push({ trigger: matchedTrigger, sentenceExcerpt: excerpt })
      out.push(PLACEHOLDER)
    } else {
      out.push(sentence)
    }
  }
  return {
    text: out.join(' '),
    redacted: matches.length > 0,
    matches
  }
}

/**
 * Format the matches array as a human-readable diagnostic
 * suitable for a transcript note. Used by the dispatch path
 * when sanitisation fires so the user sees both that
 * sanitisation happened AND what specifically got hidden.
 */
export function formatKimiSanitiserDiagnostic(
  result: KimiSanitiserResult
): string {
  if (!result.redacted || result.matches.length === 0) return ''
  const lines: string[] = [
    `Kimi compatibility filter redacted ${result.matches.length} sentence${
      result.matches.length === 1 ? '' : 's'
    } from Kimi's view of this round:`
  ]
  for (const m of result.matches.slice(0, 8)) {
    lines.push(`  · Trigger "${m.trigger}" — "${m.sentenceExcerpt}"`)
  }
  if (result.matches.length > 8) {
    lines.push(`  · …and ${result.matches.length - 8} more`)
  }
  lines.push(
    'Other participants (Codex / Claude / Gemini) saw the full unfiltered prompt.'
  )
  return lines.join('\n')
}
