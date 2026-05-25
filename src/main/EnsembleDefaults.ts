import type { EnsembleConfig, EnsembleParticipant, PermissionPresetId, ProviderId } from './store/types'

/*
 * F2 (1.0.3) — the per-provider participant defaults below MUST stay in
 * lockstep with `getDefaultEnsembleParticipantConfig` in
 * `src/renderer/src/lib/ensembleProviderDefaults.ts`, which is the
 * renderer-side single source-of-truth for the same values (model,
 * permissionPresetId, plus the reasoning/fast/thinking fallbacks the
 * composer pickers read at runtime). The two modules can't share a
 * file because the renderer module imports renderer-only types from
 * `CombinedModelPicker` and bundling main → renderer would tangle the
 * electron-vite build graph. Treat the renderer module as canonical;
 * if you change a default here, change it there too (the
 * `ensembleProviderDefaults.test.ts` fixtures pin the values).
 */
const DEFAULT_ENSEMBLE_ROLES: Array<{
  provider: ProviderId
  role: string
  instructions: string
  permissionPresetId: PermissionPresetId
}> = [
  {
    provider: 'claude',
    role: 'Explorer',
    instructions: 'Explore the request, identify constraints, and propose the safest path forward.',
    permissionPresetId: 'read_only'
  },
  {
    provider: 'codex',
    role: 'Worker',
    instructions: 'Implement concrete code or workflow changes when the round calls for action.',
    permissionPresetId: 'workspace_write'
  },
  {
    provider: 'gemini',
    role: 'Researcher',
    instructions: 'Use broad context to find supporting facts, references, and alternate approaches.',
    permissionPresetId: 'read_only'
  },
  {
    provider: 'kimi',
    role: 'Reviewer',
    instructions: 'Review prior responses for gaps, edge cases, and test coverage.',
    permissionPresetId: 'read_only'
  }
]

export function createDefaultEnsembleConfig(activeProvider?: ProviderId): EnsembleConfig {
  const orderedProviders = rotateProviderFirst(
    DEFAULT_ENSEMBLE_ROLES.map((entry) => entry.provider),
    activeProvider
  )
  const orderByProvider = new Map(orderedProviders.map((provider, index) => [provider, index + 1]))
  // Slice F (1.0.3) — every provider is enabled by default now that
  // the in-composer chip strip + flyout let the user disable them
  // inline with one click. Previously we only enabled `activeProvider`
  // + claude + codex, which left Gemini / Kimi feeling like
  // second-class members of the ensemble surface.
  const participants: EnsembleParticipant[] = DEFAULT_ENSEMBLE_ROLES.map((entry) => ({
    id: `ensemble-${entry.provider}`,
    provider: entry.provider,
    enabled: true,
    role: entry.role,
    instructions: entry.instructions,
    order: orderByProvider.get(entry.provider) || 99,
    model: 'cli-default',
    permissionPresetId: entry.permissionPresetId
  })).sort((a, b) => a.order - b.order)

  return {
    enabled: true,
    maxParticipants: 4,
    participants,
    updatedAt: new Date().toISOString()
  }
}

function rotateProviderFirst(providers: ProviderId[], activeProvider?: ProviderId): ProviderId[] {
  if (!activeProvider || !providers.includes(activeProvider)) return providers
  return [activeProvider, ...providers.filter((provider) => provider !== activeProvider)]
}

