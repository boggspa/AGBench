/**
 * 1.0.4-AE — PII redaction for the Gemini provider auth status as
 * exposed to MCP tool consumers (agents).
 *
 * Background: `summarizeGeminiAuthStatusForMcp` in `src/main/index.ts`
 * was passing the entire profile list (including `oauthEmail`) through
 * to MCP responses. Agents calling `provider_auth_status` could read
 * the user's Google account email — a clear PII leak for what should
 * be a config-shape probe.
 *
 * This module is intentionally side-effect-free and split out of
 * `index.ts` so the regression suite can exercise the redactor
 * directly without booting the Electron main process.
 *
 * The renderer-side Settings → Auth panel reaches profile data via
 * `getGeminiAuthStatusSnapshot` (legitimate UI surface that still
 * needs the email to display). Only the MCP path runs through this
 * redactor.
 */
import type { GeminiAuthStatus } from './store/types'

export type GeminiAuthProfileSummary = GeminiAuthStatus['profiles'][number]

/**
 * Strip `oauthEmail` and replace it with a flag-only `oauthEmailPresent:
 * boolean` so agents can tell whether a Google identity is configured
 * without learning which one. Other profile fields (kind, configured,
 * authState, vertexProject, vertexLocation, OAuth login status) pass
 * through unchanged because they're configuration shape rather than
 * personal identifiers.
 */
export function redactGeminiProfileForMcp(
  profile: GeminiAuthProfileSummary
): GeminiAuthProfileSummary {
  const { oauthEmail, ...rest } = profile as GeminiAuthProfileSummary & {
    oauthEmail?: string
  }
  return {
    ...rest,
    ...(typeof oauthEmail === 'string' && oauthEmail
      ? { oauthEmailPresent: true }
      : { oauthEmailPresent: false })
  } as unknown as GeminiAuthProfileSummary
}
