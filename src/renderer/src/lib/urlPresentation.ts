export interface LinkPresentationTarget {
  url: string
  origin: string
  host: string
}

const HTTP_URL_REGEX = /\bhttps?:\/\/[^\s<>"'`]+/gi
const HARD_TRAILING_PUNCTUATION = /[.,;:!?]+$/

export function normalizeHttpUrlTarget(input: string): LinkPresentationTarget | null {
  const trimmed = trimTrailingUrlPunctuation(String(input || '').trim())
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.username = ''
    url.password = ''
    url.hash = ''
    return {
      url: url.toString(),
      origin: url.origin,
      host: url.hostname.replace(/^www\./i, '')
    }
  } catch {
    return null
  }
}

export function displayHostForUrl(input: string): string {
  return normalizeHttpUrlTarget(input)?.host || ''
}

export function extractHttpUrls(text: string, limit = 6): LinkPresentationTarget[] {
  if (!text || !/https?:\/\//i.test(text)) return []
  const results: LinkPresentationTarget[] = []
  const seen = new Set<string>()
  HTTP_URL_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = HTTP_URL_REGEX.exec(text)) !== null) {
    const target = normalizeHttpUrlTarget(match[0])
    if (!target || seen.has(target.url)) continue
    seen.add(target.url)
    results.push(target)
    if (results.length >= limit) break
  }
  return results
}

export function mergeLinkPresentationTargets(
  groups: Array<Iterable<LinkPresentationTarget>>,
  limit = 6
): LinkPresentationTarget[] {
  const results: LinkPresentationTarget[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    for (const target of group) {
      if (seen.has(target.url)) continue
      seen.add(target.url)
      results.push(target)
      if (results.length >= limit) return results
    }
  }
  return results
}

function trimTrailingUrlPunctuation(input: string): string {
  let value = input.replace(HARD_TRAILING_PUNCTUATION, '')
  value = stripUnbalancedTrailing(value, ')', '(')
  value = stripUnbalancedTrailing(value, ']', '[')
  value = stripUnbalancedTrailing(value, '}', '{')
  return value
}

function stripUnbalancedTrailing(value: string, close: string, open: string): string {
  let next = value
  while (next.endsWith(close) && countChar(next, close) > countChar(next, open)) {
    next = next.slice(0, -1)
  }
  return next
}

function countChar(value: string, needle: string): number {
  let count = 0
  for (const char of value) {
    if (char === needle) count += 1
  }
  return count
}
