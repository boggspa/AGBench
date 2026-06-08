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

  it('strips HTML markup so web_fetch returns readable prose, not CSS/scripts', async () => {
    const html = [
      '<!doctype html><html><head><title>Cambridge Weather</title>',
      '<style>.x{color:red}</style><script>var a=1;</script></head>',
      '<body><h1>Today</h1><p>Sunny with highs of 21C.</p>',
      '<p>Light breeze in the afternoon.</p></body></html>'
    ].join('')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () => html
      }))
    )

    const result = await executeWebMcpTool('web_fetch', { url: 'https://example.com/weather' })

    expect(result.isError).toBe(false)
    expect(result.text).toContain('Title: Cambridge Weather')
    expect(result.text).toContain('Sunny with highs of 21C.')
    expect(result.text).toContain('Light breeze in the afternoon.')
    // Markup, styles, and scripts must not leak through to the model.
    expect(result.text).not.toContain('color:red')
    expect(result.text).not.toContain('var a=1')
    expect(result.text).not.toContain('<p>')
  })

  it('passes non-HTML bodies (JSON) through verbatim for web_fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json' },
        text: async () => '{"temp":21,"unit":"C"}'
      }))
    )

    const result = await executeWebMcpTool('web_fetch', { url: 'https://api.example.com/w.json' })

    expect(result.isError).toBe(false)
    expect(result.text).toContain('{"temp":21,"unit":"C"}')
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
