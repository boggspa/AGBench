import { describe, expect, it, vi } from 'vitest'
import { probeRelayFrontDoor, probeUrlForRelay } from './relayReachability'

describe('probeUrlForRelay', () => {
  it('maps wss:// to https:// preserving host and port', () => {
    const url = probeUrlForRelay('wss://chriss-mac-studio.tail2d0961.ts.net')
    expect(url?.protocol).toBe('https:')
    expect(url?.host).toBe('chriss-mac-studio.tail2d0961.ts.net')
    expect(url?.pathname).toBe('/')

    const withPort = probeUrlForRelay('wss://relay.example:8443/v1/session/abc?x=1')
    expect(withPort?.protocol).toBe('https:')
    expect(withPort?.port).toBe('8443')
    // The probe dials the origin, not a session path.
    expect(withPort?.pathname).toBe('/')
    expect(withPort?.search).toBe('')
  })

  it('maps ws:// to http://', () => {
    const url = probeUrlForRelay('ws://192.168.1.20:8787')
    expect(url?.protocol).toBe('http:')
    expect(url?.host).toBe('192.168.1.20:8787')
  })

  it('rejects non-websocket and unparseable URLs', () => {
    expect(probeUrlForRelay('https://example.com')).toBeNull()
    expect(probeUrlForRelay('not a url')).toBeNull()
  })
})

describe('probeRelayFrontDoor', () => {
  it('treats ANY HTTP response as reachable — 404 included', async () => {
    const request = vi.fn(async () => ({ statusCode: 404 }))
    const result = await probeRelayFrontDoor('wss://mac.tailnet.ts.net', { request })
    expect(result.reachable).toBe(true)
    expect(result.detail).toBe('HTTP 404 from mac.tailnet.ts.net')
    expect(request).toHaveBeenCalledTimes(1)
    const [url, timeoutMs] = request.mock.calls[0] as unknown as [URL, number]
    expect(url.protocol).toBe('https:')
    expect(timeoutMs).toBe(3_000)
  })

  it('surfaces the dial failure verbatim (the -1004 family)', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 100.99.131.73:443'), {
      code: 'ECONNREFUSED'
    })
    const result = await probeRelayFrontDoor('wss://mac.tailnet.ts.net', {
      request: vi.fn(async () => {
        throw refused
      })
    })
    expect(result.reachable).toBe(false)
    expect(result.detail).toBe('ECONNREFUSED: connect ECONNREFUSED 100.99.131.73:443')
  })

  it('reports timeouts with the configured budget', async () => {
    const result = await probeRelayFrontDoor('ws://192.168.1.20:8787', {
      timeoutMs: 1_500,
      request: vi.fn(async (_url: URL, timeoutMs: number) => {
        throw new Error(`timed out after ${timeoutMs}ms`)
      })
    })
    expect(result.reachable).toBe(false)
    expect(result.detail).toBe('timed out after 1500ms')
  })

  it('fails closed on a non-websocket URL without dialing', async () => {
    const request = vi.fn(async () => ({ statusCode: 200 }))
    const result = await probeRelayFrontDoor('https://example.com', { request })
    expect(result.reachable).toBe(false)
    expect(result.detail).toMatch(/not a ws:\/\/ or wss:\/\/ URL/)
    expect(request).not.toHaveBeenCalled()
  })
})
