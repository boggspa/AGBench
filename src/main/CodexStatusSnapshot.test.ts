import { describe, expect, it } from 'vitest'
import { buildCodexStatusSnapshot } from './CodexStatusSnapshot'

describe('buildCodexStatusSnapshot', () => {
  it('marks app-server startup failures unavailable for preflight', () => {
    const snapshot = buildCodexStatusSnapshot({
      version: 'codex-cli 1.0.0',
      clientStarted: false,
      startupError: 'Codex app-server exited.'
    })
    expect(snapshot).toMatchObject({
      provider: 'codex',
      available: false,
      setupRequired: true,
      appServer: 'unavailable',
      error: 'Codex app-server exited.'
    })
  })

  it('keeps account metadata failures runnable after app-server startup succeeds', () => {
    const snapshot = buildCodexStatusSnapshot({
      version: 'codex-cli 1.0.0',
      clientStarted: true,
      accountStatus: { error: 'Rate-limit metadata failed' }
    })
    expect(snapshot.available).toBe(true)
    expect(snapshot.setupRequired).toBeUndefined()
    expect(snapshot.appServer).toBe('started')
    expect(snapshot.error).toBe('Rate-limit metadata failed')
  })
})
