import type {
  AgenticServiceId,
  EnsembleParticipant,
  PermissionOverrides
} from '../../../main/store/types'

export function getParticipantToolGrantIds(
  participant: Pick<EnsembleParticipant, 'permissionOverrides'> | null | undefined
): Set<AgenticServiceId> {
  const services = participant?.permissionOverrides?.agenticServices || {}
  return new Set(
    Object.entries(services)
      .filter(([, policy]) => policy === 'allow')
      .map(([service]) => service as AgenticServiceId)
  )
}

export function buildParticipantToolGrantPatch(
  participant: EnsembleParticipant,
  service: AgenticServiceId,
  enabled: boolean
): Partial<EnsembleParticipant> {
  const currentOverrides = participant.permissionOverrides || {}
  const agenticServices = { ...(currentOverrides.agenticServices || {}) }
  if (enabled) {
    agenticServices[service] = 'allow'
  } else {
    delete agenticServices[service]
  }

  const nextOverrides: PermissionOverrides = { ...currentOverrides }
  if (Object.keys(agenticServices).length > 0) {
    nextOverrides.agenticServices = agenticServices
  } else {
    delete nextOverrides.agenticServices
  }

  const hasOverrides =
    nextOverrides.approvalMode !== undefined ||
    nextOverrides.networkAccess !== undefined ||
    nextOverrides.agenticServices !== undefined ||
    (nextOverrides.externalPathGrants?.length || 0) > 0

  const patch: Partial<EnsembleParticipant> = {
    permissionOverrides: hasOverrides ? nextOverrides : undefined
  }

  if (enabled && participant.permissionPresetId === 'read_only') {
    patch.permissionPresetId = 'custom'
  }

  return patch
}
