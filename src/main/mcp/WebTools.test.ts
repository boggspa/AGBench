import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeWebMcpTool, isWebMcpToolName } from './WebTools'

describe('WebTools', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('recognizes canonical web MCP tool names', () => {
    expect(isWebMcpToolName('web_search')).toBe(true)
    expect(isWebMcpToolName('web_fetch')).toBe(true)
    expect(isWebMcpToolName('workspace_search')).toBe(false)
  })

  it('fetches absolute http(s) URLs as read-only text', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<html><body>Hello web</body></html>'
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeWebMcpTool('web_fetch', { url: 'https://example.com' })

    expect(result.isError).toBe(false)
    expect(result.text).toContain('HTTP 200 OK for https://example.com')
    expect(result.text).toContain('Hello web')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ redirect: 'follow' })
    )
  })

  it('parses DuckDuckGo result links for web_search', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com">Example &amp; Result</a>'
      }))
    )

    const result = await executeWebMcpTool('web_search', { query: 'example' })

    expect(result.isError).toBe(false)
    expect(result.text).toContain('Top web results for "example"')
    expect(result.text).toContain('Example & Result')
    expect(result.text).toContain('https://example.com')
  })
})
