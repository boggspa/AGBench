import { describe, expect, it } from 'vitest'
import { redactGeminiProfileForMcp } from './GeminiAuthRedaction'

/*
 * 1.0.4-AE — regression coverage for the OAuth email leak.
 *
 * Pre-fix, `provider_auth_status` (MCP tool) returned the full
 * Gemini auth profile shape via `summarizeGeminiAuthStatusForMcp`,
 * including the user's actual Google OAuth email. Agents calling
 * this tool could see PII they have no business knowing.
 *
 * The renderer-side Settings → Auth panel still needs the real
 * email to render — that's a legitimate UI flow. So the fix is
 * surgical: redact only on the MCP path via `redactGeminiProfileForMcp`,
 * which strips `oauthEmail` and replaces it with a flag-only
 * `oauthEmailPresent: boolean`.
 */
describe('redactGeminiProfileForMcp', () => {
  it('strips oauthEmail and emits oauthEmailPresent: true when an email is set', () => {
    const profile = {
      id: 'profile-1',
      label: 'Default',
      kind: 'google-oauth',
      authState: 'authenticated',
      configured: true,
      oauthConfigured: true,
      oauthEmail: 'chris@example.com'
    } as any
    const redacted = redactGeminiProfileForMcp(profile)
    expect((redacted as any).oauthEmail).toBeUndefined()
    expect((redacted as any).oauthEmailPresent).toBe(true)
    // Sanity: non-PII fields pass through unchanged.
    expect(redacted.id).toBe('profile-1')
    expect(redacted.kind).toBe('google-oauth')
    expect((redacted as any).oauthConfigured).toBe(true)
  })

  it('emits oauthEmailPresent: false when no email is configured', () => {
    const profile = {
      id: 'profile-2',
      label: 'API Key',
      kind: 'api-key',
      authState: 'authenticated',
      configured: true
    } as any
    const redacted = redactGeminiProfileForMcp(profile)
    expect((redacted as any).oauthEmail).toBeUndefined()
    expect((redacted as any).oauthEmailPresent).toBe(false)
  })

  it('treats an empty-string email as absent (still oauthEmailPresent: false)', () => {
    const profile = {
      id: 'profile-3',
      kind: 'google-oauth',
      oauthEmail: '',
      oauthConfigured: false
    } as any
    const redacted = redactGeminiProfileForMcp(profile)
    expect((redacted as any).oauthEmail).toBeUndefined()
    expect((redacted as any).oauthEmailPresent).toBe(false)
  })

  it('does not mutate the input profile', () => {
    // Defensive: the renderer-side flow reuses the same profile
    // objects via `getGeminiAuthStatusSnapshot`. If the MCP
    // redactor mutated in place we'd accidentally erase the real
    // email from the Settings UI.
    const profile = {
      id: 'profile-4',
      kind: 'google-oauth',
      oauthEmail: 'still-here@example.com'
    } as any
    redactGeminiProfileForMcp(profile)
    expect(profile.oauthEmail).toBe('still-here@example.com')
  })

  it('does not include oauthEmail under any alternative key in the result', () => {
    // Belt-and-braces — confirm we don't accidentally rename rather
    // than strip. JSON.stringify gives us a quick "no `@` symbol
    // anywhere in the serialised PII surface" smoke check.
    const profile = {
      id: 'profile-5',
      kind: 'google-oauth',
      oauthEmail: 'leak-detector@example.com'
    } as any
    const redacted = redactGeminiProfileForMcp(profile)
    const serialized = JSON.stringify(redacted)
    expect(serialized).not.toContain('leak-detector')
    expect(serialized).not.toContain('@example.com')
  })
})
