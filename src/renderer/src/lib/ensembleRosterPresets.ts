import type {
  EnsembleConfig,
  EnsembleOrchestrationMode,
  EnsembleParticipant,
  PermissionOverrides,
  PermissionPresetId,
  ProviderId
} from '../../../main/store/types'

const STORAGE_KEY = 'taskwraith-ensemble-roster-presets'

export type EnsembleRosterParticipantSnapshot = {
  provider: ProviderId
  enabled: boolean
  role: string
  instructions: string
  order: number
  model?: string
  runtimeProfileId?: string
  geminiAuthProfileId?: string | null
  permissionPresetId?: PermissionPresetId
  permissionOverrides?: PermissionOverrides
  reasoningEffort?: string
  fastModeEnabled?: boolean
  thinkingEnabled?: boolean
  serviceTier?: string
}

export type EnsembleRosterPreset = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  orchestrationMode: EnsembleOrchestrationMode
  maxParticipants: number
  maxContinuationHops?: number
  concurrentModeEnabled?: boolean
  ensembleContextChars?: number
  participants: EnsembleRosterParticipantSnapshot[]
}

function clonePermissionOverrides(
  overrides: PermissionOverrides | undefined
): PermissionOverrides | undefined {
  if (!overrides) return undefined
  return {
    ...overrides,
    ...(overrides.agenticServices
      ? { agenticServices: { ...overrides.agenticServices } }
      : {}),
    ...(overrides.externalPathGrants
      ? { externalPathGrants: [...overrides.externalPathGrants] }
      : {})
  }
}

function readRawPresets(): EnsembleRosterPreset[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isEnsembleRosterPreset)
  } catch {
    return []
  }
}

function isEnsembleRosterParticipantSnapshot(
  value: unknown
): value is EnsembleRosterParticipantSnapshot {
  if (!value || typeof value !== 'object') return false
  const entry = value as EnsembleRosterParticipantSnapshot
  return (
    typeof entry.provider === 'string' &&
    typeof entry.enabled === 'boolean' &&
    typeof entry.role === 'string' &&
    typeof entry.instructions === 'string' &&
    typeof entry.order === 'number'
  )
}

function isEnsembleRosterPreset(value: unknown): value is EnsembleRosterPreset {
  if (!value || typeof value !== 'object') return false
  const entry = value as EnsembleRosterPreset
  return (
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.name === 'string' &&
    entry.name.length > 0 &&
    typeof entry.createdAt === 'number' &&
    typeof entry.updatedAt === 'number' &&
    (entry.orchestrationMode === 'turn_bound' || entry.orchestrationMode === 'continuous') &&
    typeof entry.maxParticipants === 'number' &&
    Array.isArray(entry.participants) &&
    entry.participants.every(isEnsembleRosterParticipantSnapshot)
  )
}

function writeRawPresets(presets: EnsembleRosterPreset[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
}

export function listEnsembleRosterPresets(): EnsembleRosterPreset[] {
  return readRawPresets().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function saveEnsembleRosterPreset(
  name: string,
  ensemble: EnsembleConfig
): EnsembleRosterPreset {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Preset name is required.')
  }
  const now = Date.now()
  const preset = buildEnsembleRosterPresetFromConfig(trimmed, ensemble, now)
  const presets = readRawPresets()
  presets.unshift(preset)
  writeRawPresets(presets)
  return preset
}

export function renameEnsembleRosterPreset(id: string, name: string): EnsembleRosterPreset | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const presets = readRawPresets()
  const index = presets.findIndex((preset) => preset.id === id)
  if (index < 0) return null
  const next: EnsembleRosterPreset = {
    ...presets[index],
    name: trimmed,
    updatedAt: Date.now()
  }
  presets[index] = next
  writeRawPresets(presets)
  return next
}

export function deleteEnsembleRosterPreset(id: string): void {
  writeRawPresets(readRawPresets().filter((preset) => preset.id !== id))
}

export function buildEnsembleRosterPresetFromConfig(
  name: string,
  ensemble: EnsembleConfig,
  now = Date.now()
): EnsembleRosterPreset {
  const sorted = [...(ensemble.participants || [])].sort((a, b) => a.order - b.order)
  return {
    id: `ensemble-roster-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    orchestrationMode:
      ensemble.orchestrationMode === 'continuous' ? 'continuous' : 'turn_bound',
    maxParticipants: ensemble.maxParticipants,
    ...(typeof ensemble.maxContinuationHops === 'number'
      ? { maxContinuationHops: ensemble.maxContinuationHops }
      : {}),
    ...(typeof ensemble.concurrentModeEnabled === 'boolean'
      ? { concurrentModeEnabled: ensemble.concurrentModeEnabled }
      : {}),
    ...(typeof ensemble.ensembleContextChars === 'number'
      ? { ensembleContextChars: ensemble.ensembleContextChars }
      : {}),
    participants: sorted.map((participant, index) => snapshotParticipant(participant, index + 1))
  }
}

function snapshotParticipant(
  participant: EnsembleParticipant,
  order: number
): EnsembleRosterParticipantSnapshot {
  return {
    provider: participant.provider,
    enabled: participant.enabled,
    role: participant.role,
    instructions: participant.instructions,
    order,
    ...(participant.model ? { model: participant.model } : {}),
    ...(participant.runtimeProfileId ? { runtimeProfileId: participant.runtimeProfileId } : {}),
    ...(participant.geminiAuthProfileId != null
      ? { geminiAuthProfileId: participant.geminiAuthProfileId }
      : {}),
    ...(participant.permissionPresetId
      ? { permissionPresetId: participant.permissionPresetId }
      : {}),
    ...(participant.permissionOverrides
      ? { permissionOverrides: clonePermissionOverrides(participant.permissionOverrides) }
      : {}),
    ...(participant.reasoningEffort ? { reasoningEffort: participant.reasoningEffort } : {}),
    ...(typeof participant.fastModeEnabled === 'boolean'
      ? { fastModeEnabled: participant.fastModeEnabled }
      : {}),
    ...(typeof participant.thinkingEnabled === 'boolean'
      ? { thinkingEnabled: participant.thinkingEnabled }
      : {}),
    ...(participant.serviceTier ? { serviceTier: participant.serviceTier } : {})
  }
}

function nextParticipantId(existing: Set<string>, index: number): string {
  for (let attempt = index; attempt < index + 32; attempt += 1) {
    const id = `ensemble-participant-${attempt}`
    if (!existing.has(id)) return id
  }
  return `ensemble-participant-${Date.now().toString(36)}`
}

export function materializeParticipantsFromPreset(
  snapshots: EnsembleRosterParticipantSnapshot[]
): EnsembleParticipant[] {
  const sorted = [...snapshots].sort((a, b) => a.order - b.order)
  const existing = new Set<string>()
  return sorted.map((snapshot, index) => {
    const id = nextParticipantId(existing, index + 1)
    existing.add(id)
    return {
      id,
      provider: snapshot.provider,
      enabled: snapshot.enabled,
      role: snapshot.role,
      instructions: snapshot.instructions,
      order: index + 1,
      ...(snapshot.model ? { model: snapshot.model } : {}),
      ...(snapshot.runtimeProfileId ? { runtimeProfileId: snapshot.runtimeProfileId } : {}),
      geminiAuthProfileId:
        snapshot.provider === 'gemini' ? (snapshot.geminiAuthProfileId ?? null) : null,
      ...(snapshot.permissionPresetId
        ? { permissionPresetId: snapshot.permissionPresetId }
        : {}),
      ...(snapshot.permissionOverrides
        ? { permissionOverrides: clonePermissionOverrides(snapshot.permissionOverrides) }
        : {}),
      ...(snapshot.reasoningEffort ? { reasoningEffort: snapshot.reasoningEffort } : {}),
      ...(typeof snapshot.fastModeEnabled === 'boolean'
        ? { fastModeEnabled: snapshot.fastModeEnabled }
        : {}),
      ...(typeof snapshot.thinkingEnabled === 'boolean'
        ? { thinkingEnabled: snapshot.thinkingEnabled }
        : {}),
      ...(snapshot.serviceTier ? { serviceTier: snapshot.serviceTier } : {}),
      linkedProviderSessionId: null
    }
  })
}
