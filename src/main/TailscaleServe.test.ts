import { describe, expect, it } from 'vitest'
import {
  disableTailscaleServe,
  enableTailscaleServe,
  getTailscaleServeStatus,
  type ServeExec
} from './TailscaleServe'

const CLI = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'

function execReturning(stdout: string, stderr = ''): ServeExec {
  return async () => ({ stdout, stderr })
}

describe('getTailscaleServeStatus', () => {
  it('detects our relay-port proxy mapping (and its HTTPS port)', async () => {
    const config = JSON.stringify({
      TCP: { '443': { HTTPS: true } },
      Web: {
        'chriss-mac-studio.tail-abc.ts.net:443': {
          Handlers: { '/': { Proxy: 'http://127.0.0.1:8787' } }
        }
      }
    })
    const status = await getTailscaleServeStatus({
      cliPath: CLI,
      relayPort: 8787,
      exec: execReturning(config)
    })
    expect(status).toEqual({
      configured: true,
      httpsPort: 443,
      proxyTarget: 'http://127.0.0.1:8787'
    })
  })

  it('reports unconfigured when serve fronts a DIFFERENT port', async () => {
    const config = JSON.stringify({
      Web: {
        'host.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } }
      }
    })
    const status = await getTailscaleServeStatus({
      cliPath: CLI,
      relayPort: 8787,
      exec: execReturning(config)
    })
    expect(status.configured).toBe(false)
  })

  it('treats prose / empty output as unconfigured (no serve config)', async () => {
    expect(
      (
        await getTailscaleServeStatus({
          cliPath: CLI,
          relayPort: 8787,
          exec: execReturning('No serve config\n')
        })
      ).configured
    ).toBe(false)
    expect(
      (
        await getTailscaleServeStatus({
          cliPath: CLI,
          relayPort: 8787,
          exec: execReturning('')
        })
      ).configured
    ).toBe(false)
  })

  it('surfaces exec failures as an error, not a throw', async () => {
    const status = await getTailscaleServeStatus({
      cliPath: CLI,
      relayPort: 8787,
      exec: async () => {
        throw new Error('daemon not running')
      }
    })
    expect(status.configured).toBe(false)
    expect(status.error).toContain('daemon not running')
  })
})

describe('enableTailscaleServe', () => {
  it('runs `serve --bg <port>` and reports ok', async () => {
    let seen: string[] = []
    const result = await enableTailscaleServe({
      cliPath: CLI,
      relayPort: 8787,
      exec: async (_cmd, args) => {
        seen = args
        return { stdout: 'Available within your tailnet:\nhttps://host.ts.net/\n', stderr: '' }
      }
    })
    expect(seen).toEqual(['serve', '--bg', '8787'])
    expect(result.ok).toBe(true)
  })

  it('surfaces the CLI guidance verbatim on failure (HTTPS not enabled)', async () => {
    const result = await enableTailscaleServe({
      cliPath: CLI,
      relayPort: 8787,
      exec: async () => {
        const err = new Error('exit 1') as Error & { stderr?: string }
        err.stderr =
          'error: HTTPS is not enabled on this tailnet. Enable it at https://login.tailscale.com/admin/dns'
        throw err
      }
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('HTTPS is not enabled')
    expect(result.message).toContain('admin/dns')
  })
})

describe('disableTailscaleServe', () => {
  it('turns off ONLY our https port mapping', async () => {
    let seen: string[] = []
    const result = await disableTailscaleServe({
      cliPath: CLI,
      httpsPort: 443,
      exec: async (_cmd, args) => {
        seen = args
        return { stdout: '', stderr: '' }
      }
    })
    expect(seen).toEqual(['serve', '--https=443', 'off'])
    expect(result.ok).toBe(true)
  })
})
