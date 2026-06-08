import type { McpToolExecutionResult } from '../index.types'

export type WebMcpToolName = 'web_fetch' | 'web_search'

const MAX_WEB_TEXT_CHARS = 20_000
const WEB_TOOL_TIMEOUT_MS = 20_000

export function isWebMcpToolName(toolName: string): toolName is WebMcpToolName {
  return toolName === 'web_fetch' || toolName === 'web_search'
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const num = Number(code)
      return Number.isFinite(num) ? String.fromCodePoint(num) : ' '
    })
}

function htmlToText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/** Strip a full HTML document down to its title + readable body text.
 * Drops `<head>`, scripts, styles, and other non-content noise so a model
 * receives prose instead of CSS/markup soup. Block-level tags become line
 * breaks so structure survives. */
function htmlDocumentToReadableText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? htmlToText(titleMatch[1]) : ''

  // Prefer the <body> when present so we skip <head> metadata/styles entirely.
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)
  const source = bodyMatch ? bodyMatch[1] : html

  const withBreaks = source
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br|header|footer|nav|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')

  const text = decodeHtmlEntities(withBreaks)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { title, text }
}

function looksLikeHtml(contentType: string, raw: string): boolean {
  if (/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType)) return true
  if (contentType) return false
  return /<html[\s>]|<!doctype html|<body[\s>]/i.test(raw)
}

function truncateWebText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_WEB_TEXT_CHARS) return { text, truncated: false }
  return {
    text: `${text.slice(0, MAX_WEB_TEXT_CHARS)}\n...[truncated]`,
    truncated: true
  }
}

async function fetchWithTimeout(url: string, userAgent: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WEB_TOOL_TIMEOUT_MS)
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': userAgent }
    })
  } finally {
    clearTimeout(timer)
  }
}

async function executeWebFetch(args: Record<string, unknown>): Promise<McpToolExecutionResult> {
  const url = String(args.url || args.uri || '').trim()
  if (!/^https?:\/\//i.test(url)) {
    return {
      text: 'web_fetch error: url must be an absolute http(s) URL.',
      isError: true,
      structuredContent: { ok: false, tool: 'web_fetch', error: 'invalid_url' }
    }
  }
  const response = await fetchWithTimeout(url, 'TaskWraith-web_fetch/1.0')
  const raw = await response.text()
  const contentType = String(response.headers?.get?.('content-type') || '')
  const isHtml = looksLikeHtml(contentType, raw)
  // Convert HTML to readable prose BEFORE truncating so the character budget
  // is spent on page content, not on <head>/<style>/<script> markup. Non-HTML
  // bodies (JSON, plain text, etc.) are passed through verbatim.
  let title = ''
  let extracted = raw
  if (isHtml) {
    const readable = htmlDocumentToReadableText(raw)
    title = readable.title
    extracted = readable.text || htmlToText(raw)
  }
  const { text: body, truncated } = truncateWebText(extracted)
  const headerLines = [
    `HTTP ${response.status} ${response.statusText || ''} for ${url}`.trim(),
    title ? `Title: ${title}` : '',
    isHtml ? 'Extracted readable page text:' : ''
  ].filter(Boolean)
  const text = `${headerLines.join('\n')}\n\n${body}`
  return {
    text,
    isError: !response.ok,
    structuredContent: {
      ok: response.ok,
      tool: 'web_fetch',
      url,
      status: response.status,
      statusText: response.statusText || '',
      contentType,
      isHtml,
      ...(title ? { title } : {}),
      truncated
    }
  }
}

function parseDuckDuckGoResults(html: string, query: string): string[] {
  const results: string[] = []
  const re = /<a\b[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null && results.length < 8) {
    let href = match[1]
    const uddg = href.match(/[?&]uddg=([^&]+)/)
    if (uddg) {
      try {
        href = decodeURIComponent(uddg[1])
      } catch {
        // Keep the original href if decoding fails.
      }
    }
    const title = htmlToText(match[2])
    if (title && href) results.push(`- ${title}\n  ${href}`)
  }
  if (results.length > 0) return results
  const fallbackText = htmlToText(html)
  return fallbackText
    ? [`No structured results parsed for "${query}". Search page text preview:\n${fallbackText.slice(0, 2000)}`]
    : []
}

async function executeWebSearch(args: Record<string, unknown>): Promise<McpToolExecutionResult> {
  const query = String(args.query || args.q || '').trim()
  if (!query) {
    return {
      text: 'web_search error: query must be a non-empty string.',
      isError: true,
      structuredContent: { ok: false, tool: 'web_search', error: 'missing_query' }
    }
  }
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const response = await fetchWithTimeout(url, 'TaskWraith-web_search/1.0')
  const html = await response.text()
  const results = parseDuckDuckGoResults(html, query)
  const text =
    results.length > 0
      ? `Top web results for "${query}":\n\n${results.join('\n')}`
      : `No results parsed for "${query}" (search returned HTTP ${response.status}).`
  return {
    text,
    isError: !response.ok,
    structuredContent: {
      ok: response.ok,
      tool: 'web_search',
      query,
      status: response.status,
      resultCount: results.length
    }
  }
}

export async function executeWebMcpTool(
  toolName: WebMcpToolName,
  args: Record<string, unknown>
): Promise<McpToolExecutionResult> {
  try {
    if (toolName === 'web_fetch') return await executeWebFetch(args)
    return await executeWebSearch(args)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      text: `${toolName} error: ${message}`,
      isError: true,
      structuredContent: { ok: false, tool: toolName, error: message }
    }
  }
}
