/*
 * MarkdownBlockSplit — pure block-level splitter for streaming markdown.
 *
 * The streaming hot path (assistant_message_delta) appends a few chars to
 * `messages[].content` 5–60× per second. The old `MarkdownMessage`
 * re-parsed the entire string via `ReactMarkdown` on every tick — at 5K
 * tokens that's hundreds of mdast traversals per second.
 *
 * Phase L1a fixes this by splitting the markdown into BLOCKS (paragraphs,
 * fenced code, headings, lists, tables) before we hand any text to
 * ReactMarkdown. Each block gets a stable id derived from its content
 * (cheap djb2 hash — no crypto dependency). `MarkdownMessage` then
 * renders each block through a `React.memo`-wrapped subtree keyed by id.
 *
 * Append-only contract — this is the property that makes the memo work.
 * When new characters arrive at the END of the stream:
 *   1. The "stable" prefix (blocks separated from the tail by at least
 *      one blank line, or closed code fences) must have IDENTICAL ids
 *      across successive calls.
 *   2. Only the trailing `tail` block changes (its id rolls with each
 *      keystroke). React unmounts the old tail subtree and mounts a new
 *      one — but the stable prefix passes referential equality on the
 *      `key` prop and short-circuits inside `React.memo`.
 *
 * No mdast — pure string scan. This is deliberate:
 *   - mdast parsing IS the cost we're avoiding.
 *   - The splitter only needs to find boundaries, not understand them.
 *   - `ReactMarkdown` re-parses each block inside `StableMarkdownBlock`,
 *     so any block-level mistake here surfaces as a visible artifact and
 *     can be tightened later.
 */

export type MarkdownBlockType = 'paragraph' | 'code' | 'list' | 'heading' | 'table' | 'other'

export interface MarkdownBlockChunk {
  /** Stable id derived from content hash (djb2). */
  id: string
  type: MarkdownBlockType
  /** Raw markdown for this block, including any trailing newlines. */
  raw: string
  /** True if the block has a definitive closer (fence closed, blank
   * line follows, etc). The tail is the only block that ever has
   * `complete: false`. */
  complete: boolean
}

export interface MarkdownSplit {
  stable: MarkdownBlockChunk[]
  /** The currently-being-typed block. Null when content ends on a blank
   * line — at that point every block is committed and the tail will be
   * the next paragraph once typing resumes. */
  tail: MarkdownBlockChunk | null
}

/**
 * djb2 — Daniel J. Bernstein's classic non-cryptographic string hash.
 * Inlined here so we don't pull in a hash dependency. Output is a
 * radix-36 string for compactness; collisions don't matter because the
 * id is only used as a React `key`, not for security.
 */
function djb2(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    // `hash * 33 + c`, kept inside a 32-bit window by the |0 cast.
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
  }
  // Convert signed 32-bit into unsigned, then to radix-36.
  return (hash >>> 0).toString(36)
}

function makeChunk(raw: string, type: MarkdownBlockType, complete: boolean): MarkdownBlockChunk {
  return { id: djb2(raw), type, raw, complete }
}

const FENCE_RE = /^([`~]{3,})/

/** Returns the fence marker (e.g. "```" or "~~~~") if this line opens or
 * closes a code fence, otherwise null. */
function fenceMarker(line: string): string | null {
  const trimmed = line.replace(/^\s+/, '')
  const match = FENCE_RE.exec(trimmed)
  return match ? match[1] : null
}

function isHeadingLine(line: string): boolean {
  return /^\s{0,3}#{1,6}\s+\S/.test(line)
}

function isListLine(line: string): boolean {
  // Unordered: `- `, `* `, `+ `   |   Ordered: `1. `, `42. `
  return /^\s{0,3}([-*+]|\d{1,9}[.)])\s+\S/.test(line)
}

function isTableSeparatorLine(line: string): boolean {
  // `|---|---|`, `| :---: | ---: |`, etc. Must have at least one cell
  // boundary and only dashes / colons / spaces between pipes.
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') && !trimmed.includes('|')) return false
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(trimmed)
}

function isTableRowLine(line: string): boolean {
  // Loose check — a line that looks like `| cell | cell |`. We only
  // bless the block as a table after seeing a separator row.
  return /^\s*\|.+\|/.test(line) || /\S\s*\|\s*\S/.test(line)
}

/**
 * Group consecutive non-blank lines into a single block. A blank line
 * acts as a paragraph break in CommonMark, so we use it as our cheap
 * boundary signal. Code fences are handled separately by the caller
 * because they span blank lines.
 */
function classifyBlock(raw: string): MarkdownBlockType {
  const lines = raw.split('\n').filter((l) => l.length > 0)
  if (lines.length === 0) return 'paragraph'

  if (isHeadingLine(lines[0])) return 'heading'

  // Table needs a separator line within the first few lines.
  if (lines.length >= 2 && isTableRowLine(lines[0]) && isTableSeparatorLine(lines[1])) {
    return 'table'
  }

  if (isListLine(lines[0])) return 'list'

  return 'paragraph'
}

/**
 * Walk the input line-by-line and emit a MarkdownBlockChunk per
 * logical block. Block boundaries are:
 *   - A run of 1+ blank lines (newline-only).
 *   - The opening fence of a code block (the previous paragraph closes).
 *   - The closing fence of a code block (the fenced block closes).
 *
 * Each block's `raw` is the content of the block, including the
 * newline that terminates each non-final line, with EXACTLY ONE
 * trailing `\n` appended for stable blocks (so reassembling them
 * matches a canonical paragraph-per-line layout). The tail block has
 * no trailing newline added — it preserves whatever the user has
 * actually typed so far.
 *
 * This normalisation is what makes the append-only contract robust:
 * a closed paragraph at position N has the same raw whether it was
 * the last block when content ended without a trailing blank, or the
 * second-to-last block when the user later typed more after it.
 *
 * The very last block is the "tail" UNLESS:
 *   (a) the content ends with a blank line (`\n\n`), or
 *   (b) the last block is a closed code fence (a fence closer is a
 *       hard boundary — the next character starts a new block).
 */
export function splitMarkdownIntoBlocks(content: string): MarkdownSplit {
  if (content.length === 0) {
    return { stable: [], tail: null }
  }

  const lines = content.split('\n')
  // `lines` length is always `(# of \n) + 1`. If content ends with `\n`,
  // the final element is the empty string after that newline.

  type Block = { raw: string; type: MarkdownBlockType; complete: boolean; closedByFence: boolean }
  const blocks: Block[] = []
  // `buffer` holds the lines of the in-progress block (no newlines —
  // we reconstruct with `\n` joins so the trailing newline is uniform).
  let buffer: string[] = []
  let inFence = false
  let fenceMark: string | null = null

  const flushBuffer = (complete: boolean, closedByFence: boolean): void => {
    if (buffer.length === 0) return
    const raw = buffer.join('\n')
    if (raw.length === 0) {
      buffer = []
      return
    }
    blocks.push({ raw, type: classifyBlock(raw), complete, closedByFence })
    buffer = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (inFence) {
      buffer.push(line)
      const closer = fenceMarker(line)
      // CommonMark: a closing fence must start with the same character
      // as the opener and be at least as long. We approximate by
      // requiring an exact prefix-char match and a >= length.
      if (closer && fenceMark && closer[0] === fenceMark[0] && closer.length >= fenceMark.length) {
        // Closed fence. Flush as a complete code block.
        const raw = buffer.join('\n')
        blocks.push({ raw, type: 'code', complete: true, closedByFence: true })
        buffer = []
        inFence = false
        fenceMark = null
      }
      continue
    }

    // Not in a fence — check if this line opens one.
    const opener = fenceMarker(line)
    if (opener) {
      // Close out any in-flight paragraph before starting the code block.
      flushBuffer(true, false)
      buffer.push(line)
      inFence = true
      fenceMark = opener
      continue
    }

    if (line.length === 0) {
      // Blank line — paragraph break. Close the current buffer (if
      // any) as a stable block. Multiple consecutive blanks collapse
      // (they don't open new blocks).
      flushBuffer(true, false)
      continue
    }

    buffer.push(line)
  }

  // End of input. Whatever is in `buffer` is a still-open block — the
  // "tail" if we're streaming, or just the final block if the content
  // happens to end without a trailing blank.
  if (buffer.length > 0) {
    const raw = buffer.join('\n')
    const type = inFence ? 'code' : classifyBlock(raw)
    const complete = !inFence // an unclosed fence is the canonical "incomplete" block
    blocks.push({ raw, type, complete, closedByFence: false })
  }

  if (blocks.length === 0) {
    return { stable: [], tail: null }
  }

  // Decide what's tail. The last block is the tail UNLESS:
  //  (a) content ends with a blank line (`\n\n`) — the last block is
  //      then committed and the next character will start a fresh
  //      paragraph, OR
  //  (b) the last block is a CLOSED code fence — a closing fence is a
  //      hard boundary in CommonMark, so the next char will start a
  //      new block. We can safely commit it to stable.
  //
  // A single trailing `\n` after a paragraph still leaves that
  // paragraph as the tail: the user might keep typing on the next
  // line and we don't want to flicker the block id between "stable"
  // and "tail" between chars.
  const endsWithBlankLine = /\n\n[ \t]*$/.test(content) || /\n[ \t]*\n$/.test(content)
  const lastBlock = blocks[blocks.length - 1]
  const lastIsClosedFence = lastBlock.closedByFence

  // For stable blocks we append a `\n` to the raw so that the
  // normalized form (the form hashed and rendered) is independent of
  // whether the block was last-without-trailing-blank vs.
  // earlier-with-trailing-blank in some prior call. This is the
  // append-only invariant: once a block is committed to stable, its
  // raw doesn't change across subsequent calls.
  const finalizeStable = (b: Block): MarkdownBlockChunk =>
    makeChunk(b.raw.endsWith('\n') ? b.raw : b.raw + '\n', b.type, true)

  if (endsWithBlankLine || lastIsClosedFence) {
    return {
      stable: blocks.map(finalizeStable),
      tail: null
    }
  }

  const lastIndex = blocks.length - 1
  const stable: MarkdownBlockChunk[] = []
  for (let i = 0; i < lastIndex; i++) {
    stable.push(finalizeStable(blocks[i]))
  }
  const last = blocks[lastIndex]
  // The tail keeps whatever raw the user actually typed (no trailing
  // newline normalisation) — its id rolls per keystroke anyway.
  const tail = makeChunk(last.raw, last.type, last.complete)
  return { stable, tail }
}
