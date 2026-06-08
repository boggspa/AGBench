import type { McpToolExecutionResult } from '../index.types'

export type WebMcpToolName = 'web_fetch' | 'web_search'

const MAX_WEB_TEXT_CHARS = 20_000
const WEB_TOOL_TIMEOUT_MS = 20_000

export function isWebMcpToolName(toolName: string): toolName is WebMcpToolName {
  return toolName === 'web_fetch' || toolName === 'web_search'
}

function htmlToText(value: string): string {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
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
  const { text: body, truncated } = truncateWebText(raw)
  const text = `HTTP ${response.status} ${response.statusText || ''} for ${url}\n\n${body}`
  return {
    text,
    isError: !response.ok,
    structuredContent: {
      ok: response.ok,
      tool: 'web_fetch',
      url,
      status: response.status,
      statusText: response.statusText || '',
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
