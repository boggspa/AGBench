import { describe, expect, it, vi } from 'vitest'
import { detectTailscale } from './TailscaleDetector'

const SAMPLE_RUNNING = {
  Version: '1.56.1-tab1234',
  TailscaleIPs: ['100.64.10.20', 'fd7a:115c:a1e0::1'],
  Self: {
    HostName: 'chris-mac',
    DNSName: 'chris-mac.tail-abc.ts.net',
    TailscaleIPs: ['100.64.10.20', 'fd7a:115c:a1e0::1']
  },
  CurrentTailnet: {
    Name: 'tail-abc.ts.net',
    MagicDNSEnabled: true,
    MagicDNSSuffix: 'tail-abc.ts.net'
  },
  BackendState: 'Running'
}

const SAMPLE_NEEDS_LOGIN = {
  Version: '1.56.1',
  TailscaleIPs: [],
  Self: { HostName: 'chris-mac' },
  BackendState: 'NeedsLogin'
}

const SAMPLE_STOPPED = {
  Version: '1.56.1',
  TailscaleIPs: [],
  Self: { HostName: 'chris-mac' },
  BackendState: 'Stopped'
}

describe('detectTailscale', () => {
  it('returns available=false with a helpful reason when CLI is missing', async () => {
    const result = await detectTailscale({ cliPath: null })
    expect(result.available).toBe(false)
    expect(result.reason).toContain('not found')
  })

  it('returns parsed status when Tailscale is running with an IP', async () => {
    const result = await detectTailscale({
      cliPath: '/fake/tailscale',
      execFn: async () => ({ stdout: JSON.stringify(SAMPLE_RUNNING), stderr: '' })
    })
    expect(result.available).toBe(true)
    expect(result.cliPath).toBe('/fake/tailscale')
    expect(result.version).toBe('1.56.1-tab1234')
    expect(result.tailnetIPv4).toBe('100.64.10.20')
    expect(result.tailnetIPv6).toBe('fd7a:115c:a1e0::1')
    expect(result.hostname).toBe('chris-mac')
    expect(result.tailnetName).toBe('tail-abc.ts.net')
    expect(result.magicDNSEnabled).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('treats NeedsLogin as unavailable with a sign-in hint', async () => {
    const result = await detectTailscale({
      cliPath: '/fake/tailscale',
      execFn: async () => ({ stdout: JSON.stringify(SAMPLE_NEEDS_LOGIN), stderr: '' })
    })
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/sign in/i)
    expect(result.hostname).toBe('chris-mac')
  })

  it('treats Stopped backend as unavailable with a connect hint', async () => {
    const result = await detectTailscale({
      cliPath: '/fake/tailscale',
      execFn: async () => ({ stdout: JSON.stringify(SAMPLE_STOPPED), stderr: '' })
    })
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/stopped|connect/i)
  })

  it('returns available=false with a parse-error reason on malformed JSON', async () => {
    const result = await detectTailscale({
      cliPath: '/fake/tailscale',
      execFn: async () => ({ stdout: 'not json at all', stderr: '' })
    })
    expect(result.available).toBe(false)
    expect(result.reason).toContain('JSON parse failed')
  })

  it('returns available=false with a CLI-invocation reason on exec failure', async () => {
    const result = await detectTailscale({
      cliPath: '/fake/tailscale',
      execFn: async () => {
        throw new Error('command not found')
      }
    })
    expect(result.available).toBe(false)
    expect(result.reason).toContain('command not found')
  })

  it('handles missing Self.TailscaleIPs by falling back to top-level TailscaleIPs', async () => {
    const result = await detectTailscale({
      cliPath: '/fake/tailscale',
      execFn: async () => ({
        stdout: JSON.stringify({
          Version: '1.56',
          TailscaleIPs: ['100.99.0.1'],
          Self: { HostName: 'fallback-host' },
          BackendState: 'Running'
        }),
        stderr: ''
      })
    })
    expect(result.available).toBe(true)
    expect(result.tailnetIPv4).toBe('100.99.0.1')
    expect(result.hostname).toBe('fallback-host')
  })

  it('returns available=false with unknown-state reason when backend has neither Running nor a known offline state', async () => {
    const result = await detectTailscale({
      cliPath: '/fake/tailscale',
      execFn: async () => ({
        stdout: JSON.stringify({
          Version: '1.56',
          TailscaleIPs: [],
          BackendState: 'Starting'
        }),
        stderr: ''
      })
    })
    expect(result.available).toBe(false)
    expect(result.reason).toContain('Starting')
  })

  it('never throws even when the exec function returns garbage', async () => {
    // Defense in depth: the public contract is "never throws".
    const result = await detectTailscale({
      cliPath: '/fake/tailscale',
      execFn: async () => {
        return { stdout: '', stderr: '' }
      }
    })
    expect(result.available).toBe(false)
  })

  it('uses provided execFn rather than the real CLI', async () => {
    let capturedCmd: string | undefined
    let capturedArgs: string[] | undefined
    const execFn = vi.fn(async (cmd: string, args: string[]) => {
      capturedCmd = cmd
      capturedArgs = args
      return { stdout: JSON.stringify(SAMPLE_RUNNING), stderr: '' }
    })
    await detectTailscale({ cliPath: '/fake/tailscale', execFn })
    expect(execFn).toHaveBeenCalledTimes(1)
    expect(capturedCmd).toBe('/fake/tailscale')
    expect(capturedArgs).toEqual(['status', '--json'])
  })
})
