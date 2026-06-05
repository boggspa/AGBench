// Phase M1 Step 6 — pure helper that resolves the user-visible runtime
// status string for the Gemini settings UI from the persisted runtime
// mode (`'auto' | 'always' | 'never'`) and the configured auth profiles.
//
// The actual API-vs-CLI dispatch lives in main (src/main/GeminiApiProvider.ts).
// This helper exists solely to mirror that decision to the user in the
// Settings panel so they can see which path a fresh run will take given
// the current selection — it is NOT consulted by the run pipeline.
//
// Inputs are minimal on purpose so the helper is trivially testable
// without spinning up a store / IPC mock.
import type { GeminiApiRuntimeMode, GeminiAuthProfileSummary } from '../../../main/store/types'

export type GeminiRuntimeStatusKind = 'api' | 'cli' | 'api-misconfigured'

export interface GeminiRuntimeStatus {
  /** Symbolic kind — useful for choosing a swatch color in the UI. */
  kind: GeminiRuntimeStatusKind
  /** Human-readable single-line description. */
  message: string
}

export interface ResolveGeminiRuntimeStatusInput {
  mode: GeminiApiRuntimeMode | undefined
  profiles: GeminiAuthProfileSummary[] | undefined
  /** The id of the currently-selected active profile (or null/undefined
   * if the user hasn't picked one — in that case TaskWraith falls back to
   * inherited CLI auth env). */
  activeProfileId?: string | null
}

/**
 * Compute the runtime status row the Settings panel should render given
 * the user's current selection.
 *
 * Rules (mirrored from Phase M1 Step 1 semantics):
 *
 * - `never` → CLI is forced regardless of profiles.
 * - `always` + an api-key profile is selected → API path.
 * - `always` + no api-key profile is selected → API requested but no key
 *   configured; the run will fail. We surface this as a warning so the
 *   user sees the misconfiguration immediately in Settings rather than
 *   only at run dispatch time.
 * - `auto` + an api-key profile is selected → API path.
 * - `auto` + only OAuth/Vertex (or no) profiles → CLI fallback.
 *
 * If `mode` is missing/unknown we treat it as `auto` (matches the main
 * store coercion in src/main/store/index.ts).
 */
export function resolveGeminiRuntimeStatus(
  input: ResolveGeminiRuntimeStatusInput
): GeminiRuntimeStatus {
  const mode: GeminiApiRuntimeMode =
    input.mode === 'always' || input.mode === 'never' || input.mode === 'auto' ? input.mode : 'auto'

  if (mode === 'never') {
    return { kind: 'cli', message: 'Runtime: CLI (forced)' }
  }

  const apiKeyProfileSelected = hasSelectedApiKeyProfile(input.profiles, input.activeProfileId)

  if (mode === 'always') {
    if (apiKeyProfileSelected) {
      return { kind: 'api', message: 'Runtime: API (in-process)' }
    }
    return {
      kind: 'api-misconfigured',
      message: 'Runtime: API requested but no API key configured — runs will fail until you add one'
    }
  }

  // mode === 'auto'
  if (apiKeyProfileSelected) {
    return { kind: 'api', message: 'Runtime: API (in-process)' }
  }
  return { kind: 'cli', message: 'Runtime: CLI (auto — no API key available)' }
}

function hasSelectedApiKeyProfile(
  profiles: GeminiAuthProfileSummary[] | undefined,
  activeProfileId: string | null | undefined
): boolean {
  if (!Array.isArray(profiles) || profiles.length === 0) return false
  // If the user has explicitly picked a profile, the runtime resolution
  // honours that pick — we only return true if THAT profile is an
  // api-key profile.
  if (typeof activeProfileId === 'string' && activeProfileId.length > 0) {
    const active = profiles.find((profile) => profile.id === activeProfileId)
    return Boolean(active && active.kind === 'api-key' && active.configured)
  }
  // No active profile chosen → fall back to "any configured api-key
  // profile counts" so the auto/always paths can still resolve to API
  // when the user has set up a default in the JSON but the active id
  // hasn't been pushed back from main yet.
  return profiles.some((profile) => profile.kind === 'api-key' && profile.configured)
}
