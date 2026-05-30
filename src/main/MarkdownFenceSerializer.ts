export interface MarkdownFenceState {
  char: '`' | '~'
  length: number
}

export interface MarkdownTruncationOptions {
  marker?: string
  minimumUsefulSafeCutRatio?: number
}

const DEFAULT_TRUNCATION_MARKER = '[... truncated]'

export function longestBacktickRun(text: string): number {
  let longest = 0
  let current = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 96) {
      current += 1
      longest = Math.max(longest, current)
    } else {
      current = 0
    }
  }
  return longest
}

export function markdownFenceFor(text: string, minimum = 3): string {
  const safeMinimum = Number.isFinite(minimum) ? Math.max(3, Math.trunc(minimum)) : 3
  return '`'.repeat(Math.max(safeMinimum, longestBacktickRun(text) + 1))
}

export function sanitizeMarkdownFenceInfo(info?: string): string {
  if (!info) return ''
  if (info.includes('`')) {
    throw new Error('Markdown fence info string must not contain backticks.')
  }
  return info.replace(/\s+/g, ' ').trim()
}

export function wrapOpaqueMarkdownBlock(text: string, info?: string): string {
  const fence = markdownFenceFor(text)
  const safeInfo = sanitizeMarkdownFenceInfo(info)
  const opening = safeInfo ? `${fence} ${safeInfo}` : fence
  return `${opening}\n${text}\n${fence}`
}

function stripLineEnding(line: string): string {
  return line.replace(/\r?\n$|\r$/, '')
}

function lineEndIncludingNewline(text: string, start: number): number {
  const newlineIndex = text.indexOf('\n', start)
  return newlineIndex === -1 ? text.length : newlineIndex + 1
}

function parseFenceLine(line: string): MarkdownFenceState | null {
  const stripped = stripLineEnding(line)
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(stripped)
  if (!match) return null
  const marker = match[2]
  const rest = match[3] || ''
  const char = marker[0] as '`' | '~'
  if (char === '`' && rest.includes('`')) return null
  return { char, length: marker.length }
}

function isClosingFenceLine(line: string, active: MarkdownFenceState): boolean {
  const stripped = stripLineEnding(line)
  const match = /^( {0,3})(`{3,}|~{3,})([ \t]*)$/.exec(stripped)
  if (!match) return false
  const marker = match[2]
  return marker[0] === active.char && marker.length >= active.length
}

function fenceStateBeforeLimit(
  text: string,
  limit: number
): {
  activeFence: MarkdownFenceState | null
  lastSafeCut: number
} {
  const boundedLimit = Math.max(0, Math.min(text.length, Math.trunc(limit)))
  let activeFence: MarkdownFenceState | null = null
  let lastSafeCut = 0
  let position = 0

  while (position < boundedLimit) {
    const lineEnd = lineEndIncludingNewline(text, position)
    if (lineEnd > boundedLimit) break
    const line = text.slice(position, lineEnd)
    if (activeFence) {
      if (isClosingFenceLine(line, activeFence)) {
        activeFence = null
        lastSafeCut = lineEnd
      }
    } else {
      const opener = parseFenceLine(line)
      if (opener) {
        activeFence = opener
      } else {
        lastSafeCut = lineEnd
      }
    }
    position = lineEnd
  }

  return { activeFence, lastSafeCut }
}

function appendMarker(prefix: string, marker: string): string {
  const trimmedPrefix = prefix.replace(/[ \t\r\n]+$/, '')
  return trimmedPrefix ? `${trimmedPrefix}\n${marker}` : marker
}

export function truncateOpaqueMarkdown(
  text: string,
  maxChars: number,
  options: MarkdownTruncationOptions = {}
): string {
  const boundedMax = Number.isFinite(maxChars) ? Math.trunc(maxChars) : 0
  if (boundedMax <= 0) return options.marker || DEFAULT_TRUNCATION_MARKER
  if (text.length <= boundedMax) return text

  const marker = options.marker || DEFAULT_TRUNCATION_MARKER
  const { activeFence, lastSafeCut } = fenceStateBeforeLimit(text, boundedMax)
  const safeCutRatio = options.minimumUsefulSafeCutRatio ?? 0.6
  const usefulSafeCut = lastSafeCut > 0 && lastSafeCut >= boundedMax * safeCutRatio

  if (usefulSafeCut) {
    return appendMarker(text.slice(0, lastSafeCut), marker)
  }

  const prefix = appendMarker(text.slice(0, boundedMax), marker)
  if (!activeFence) return prefix
  return `${prefix}\n${activeFence.char.repeat(activeFence.length)}`
}
