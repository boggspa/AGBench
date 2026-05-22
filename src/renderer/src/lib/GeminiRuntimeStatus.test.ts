import { describe, expect, it } from 'vitest'
import { resolveGeminiRuntimeStatus } from './GeminiRuntimeStatus'
import type { GeminiAuthProfileSummary } from '../../../main/store/types'

function makeProfile(
  overrides: Partial<GeminiAuthProfileSummary> & Pick<GeminiAuthProfileSummary, 'id' | 'kind'>
): GeminiAuthProfileSummary {
  return {
    label: `${overrides.kind} profile`,
    configured: true,
    isDefault: false,
    authState: 'authenticated',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('resolveGeminiRuntimeStatus', () => {
  it('returns CLI (forced) when mode is never, regardless of profiles', () => {
    const status = resolveGeminiRuntimeStatus({
      mode: 'never',
      profiles: [makeProfile({ id: 'key-1', kind: 'api-key' })],
      activeProfileId: 'key-1'
    })
    expect(status.kind).toBe('cli')
    expect(status.message).toBe('Runtime: CLI (forced)')
  })

  it('returns API (in-process) when always + selected profile is api-key', () => {
    const status = resolveGeminiRuntimeStatus({
      mode: 'always',
      profiles: [makeProfile({ id: 'key-1', kind: 'api-key' })],
      activeProfileId: 'key-1'
    })
    expect(status.kind).toBe('api')
    expect(status.message).toBe('Runtime: API (in-process)')
  })

  it('returns api-misconfigured warning when always + only OAuth profile is selected', () => {
    const status = resolveGeminiRuntimeStatus({
      mode: 'always',
      profiles: [makeProfile({ id: 'oauth-1', kind: 'google-oauth' })],
      activeProfileId: 'oauth-1'
    })
    expect(status.kind).toBe('api-misconfigured')
    expect(status.message).toContain('no API key configured')
  })

  it('returns api-misconfigured when always + no profiles configured', () => {
    const status = resolveGeminiRuntimeStatus({
      mode: 'always',
      profiles: [],
      activeProfileId: null
    })
    expect(status.kind).toBe('api-misconfigured')
  })

  it('returns API (in-process) when auto + selected profile is api-key', () => {
    const status = resolveGeminiRuntimeStatus({
      mode: 'auto',
      profiles: [makeProfile({ id: 'key-1', kind: 'api-key' })],
      activeProfileId: 'key-1'
    })
    expect(status.kind).toBe('api')
    expect(status.message).toBe('Runtime: API (in-process)')
  })

  it('returns CLI (auto) when auto + only OAuth profile is selected', () => {
    const status = resolveGeminiRuntimeStatus({
      mode: 'auto',
      profiles: [makeProfile({ id: 'oauth-1', kind: 'google-oauth' })],
      activeProfileId: 'oauth-1'
    })
    expect(status.kind).toBe('cli')
    expect(status.message).toContain('CLI (auto')
    expect(status.message).toContain('no API key available')
  })

  it('returns CLI (auto) when auto + only Vertex profile is selected', () => {
    const status = resolveGeminiRuntimeStatus({
      mode: 'auto',
      profiles: [makeProfile({ id: 'vertex-1', kind: 'vertex-ai' })],
      activeProfileId: 'vertex-1'
    })
    expect(status.kind).toBe('cli')
  })

  it('returns CLI (auto) when auto + no profiles configured at all', () => {
    const status = resolveGeminiRuntimeStatus({
      mode: 'auto',
      profiles: [],
      activeProfileId: null
    })
    expect(status.kind).toBe('cli')
  })

  it('treats missing / unknown mode as auto', () => {
    const status = resolveGeminiRuntimeStatus({
      mode: undefined,
      profiles: [makeProfile({ id: 'key-1', kind: 'api-key' })],
      activeProfileId: 'key-1'
    })
    expect(status.kind).toBe('api')
  })

  it('falls back to "any configured api-key profile counts" when no active profile is selected', () => {
    // Edge case: user has an api-key profile saved but the UI hasn't
    // synced an activeProfileId yet. Resolution should still prefer API
    // because main will pick the default api-key profile at dispatch.
    const status = resolveGeminiRuntimeStatus({
      mode: 'auto',
      profiles: [makeProfile({ id: 'key-1', kind: 'api-key', isDefault: true })],
      activeProfileId: null
    })
    expect(status.kind).toBe('api')
  })

  it('does not count an unconfigured api-key profile as usable', () => {
    // A profile with `configured: false` means the api key isn't stored
    // (e.g. crypto unavailable / decrypt failed). It should not satisfy
    // the api-key requirement for either auto or always.
    const status = resolveGeminiRuntimeStatus({
      mode: 'always',
      profiles: [makeProfile({ id: 'key-1', kind: 'api-key', configured: false })],
      activeProfileId: 'key-1'
    })
    expect(status.kind).toBe('api-misconfigured')
  })
})
