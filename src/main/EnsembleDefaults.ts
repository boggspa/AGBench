import type { EnsembleConfig, EnsembleParticipant, PermissionPresetId, ProviderId } from './store/types'

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
  const participants: EnsembleParticipant[] = DEFAULT_ENSEMBLE_ROLES.map((entry) => ({
    id: `ensemble-${entry.provider}`,
    provider: entry.provider,
    enabled: entry.provider === activeProvider || entry.provider === 'claude' || entry.provider === 'codex',
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

