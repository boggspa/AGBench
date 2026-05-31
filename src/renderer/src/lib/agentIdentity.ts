import type {
  AgentIdentity,
  ChatRecord,
  ChildAgentThread,
  ProviderId,
  ToolActivity
} from '../../../main/store/types'

/**
 * Subagent identity registry.
 *
 * Each `ChildAgentThread` (spawned subagent) gets a visual identity — a
 * stable display name + accent color — that persists for the lifetime of the
 * chat it belongs to. Codex's UX assigns these from the platform side; we
 * mirror that semantic for our own purposes since:
 *
 *   1. Tool wire data rarely carries a usable display name (just the parent's
 *      persona prompt, which is for the model, not the UI).
 *   2. For Claude / Gemini / Kimi there's no native concept at all.
 *
 * Identity pairs are unique within a chat (no two "Harmonium"s in the same
 * conversation) and survive reloads via `chat.providerMetadata.agentIdentities`.
 */

const AGENT_NICKNAME_POOL: readonly string[] = [
  'Donny-Davis',
  'Harmonium',
  'Jenkinz',
  'Dexterman',
  'Croxley-Marvin',
  'Wendens-Ambo',
  'Georgioni',
  'Teleminster',
  'Korbis',
  'Wellson',
  'Baxter-Ravens',
  'Brian Brian Brian',
  'Imhotep',
  'Hubert Cumberdale',
  'Phobos',
  'Deimos',
  'Dogsbody',
  'Roboteknik',
  'Zandar',
  'Serafin',
  'Orzwald',
  'Channing',
  'Tobus Maximus',
  'Arxfold',
  'Persia',
  'Jakker',
  'Hilbert',
  'Dufus',
  'Sicklemas',
  'Frankenborg',
  'Chaxim',
  'Tre Solomon',
  'Eloque',
  'Xarxes',
  'Julio',
  'Jeremy Patchman',
  'Malek Malloc',
  'Tommy Tipper',
  'Jim The Mage',
  'Kevin The Karate King',
  'Master Maxwell',
  'Dorribald',
  'Marsham',
  'Yorris',
  'Bennison',
  'La Li Lu Le Lo',
  'Nish',
  'Ozbern',
  'Pendris',
  'Quendrew',
  'Roobis',
  'Uno',
  'Volkarr',
  'Yoodoo'
]

const COLOR_POOL: readonly string[] = [
  '#ff5f5f', // red
  '#5a8cff', // blue
  '#ff974a', // orange
  '#5cd687', // green
  '#b88aff', // purple
  '#e6c14a', // yellow
  '#4ad6cc', // cyan
  '#ff7ed4' // pink
]

/** Field names where Codex (or future providers) might surface a platform-assigned name. */
const PLATFORM_NAME_FIELDS: readonly string[] = [
  'assigned_name',
  'assignedName',
  'display_name',
  'displayName',
  'agent_name',
  'agentName',
  'subagent_label',
  'subagentLabel',
  'codename',
  'nickname'
]

function safeAgentIdentitiesMap(chat: ChatRecord | undefined): Record<string, AgentIdentity> {
  const meta = chat?.providerMetadata as Record<string, unknown> | undefined
  if (!meta) return {}
  const raw = meta.agentIdentities
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  // Defensive shallow-validate: each entry must look like an AgentIdentity.
  const result: Record<string, AgentIdentity> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as AgentIdentity).name === 'string' &&
      typeof (value as AgentIdentity).color === 'string'
    ) {
      result[key] = value as AgentIdentity
    }
  }
  return result
}

/**
 * Read-only lookup. Returns the identity for an agent id if it has been
 * assigned, otherwise undefined. Never mutates the chat.
 */
export function findIdentity(
  chat: ChatRecord | undefined,
  agentId: string | undefined
): AgentIdentity | undefined {
  if (!chat || !agentId) return undefined
  const map = safeAgentIdentitiesMap(chat)
  return map[agentId]
}

/**
 * Try to pull a display name from the tool wire data. Returns undefined if no
 * reasonable candidate was found. Only checks an allowlist of known fields so
 * we don't accidentally surface raw prompt content as a name.
 */
function extractPlatformName(activity: ToolActivity | undefined): string | undefined {
  if (!activity) return undefined
  const params = (activity.parameters || {}) as Record<string, unknown>
  for (const key of PLATFORM_NAME_FIELDS) {
    const value = params[key]
    if (typeof value === 'string') {
      const trimmed = value.trim()
      // Sanity bounds: actual names won't be longer than ~32 chars or full of whitespace.
      if (trimmed && trimmed.length > 0 && trimmed.length <= 32 && !trimmed.includes('\n')) {
        return trimmed
      }
    }
  }
  // Sometimes the platform name only surfaces in the result payload after the
  // spawn completes — check known result fields too.
  const rawResult = activity.rawResultEvent as Record<string, unknown> | undefined
  if (rawResult && typeof rawResult === 'object') {
    for (const key of PLATFORM_NAME_FIELDS) {
      const value = rawResult[key]
      if (typeof value === 'string' && value.trim() && value.trim().length <= 32) {
        return value.trim()
      }
    }
  }
  return undefined
}

/**
 * Find the next unused (name, color) pair given the identities already
 * assigned in this chat. Names cycle through `AGENT_NICKNAME_POOL` in order
 * and don't repeat until the pool is exhausted; colors cycle every 8 entries.
 */
function pickNextPoolPair(usedNames: Set<string>): { name: string; color: string } {
  let chosenName: string | undefined
  for (const candidate of AGENT_NICKNAME_POOL) {
    if (!usedNames.has(candidate)) {
      chosenName = candidate
      break
    }
  }
  // Pool exhausted: append a numeric suffix to keep things unique.
  if (!chosenName) {
    let suffix = 2
    while (true) {
      const candidate = `${AGENT_NICKNAME_POOL[(suffix - 1) % AGENT_NICKNAME_POOL.length]} ${suffix}`
      if (!usedNames.has(candidate)) {
        chosenName = candidate
        break
      }
      suffix += 1
    }
  }
  // Color cycles by position of the assigned name index.
  const baseIndex = AGENT_NICKNAME_POOL.indexOf(chosenName)
  const colorIndex = (baseIndex >= 0 ? baseIndex : usedNames.size) % COLOR_POOL.length
  return { name: chosenName, color: COLOR_POOL[colorIndex] }
}

/**
 * Idempotent identity assignment. If `agentId` already has an identity in the
 * chat, returns it unchanged. Otherwise allocates a fresh one (platform name
 * for Codex if available, pool name otherwise) and writes it back to
 * `chat.providerMetadata.agentIdentities`.
 *
 * NOTE: this mutates `chat.providerMetadata` in place. Caller is responsible
 * for triggering a re-render / persistence cycle afterwards.
 */
export function assignAgentIdentity(
  chat: ChatRecord,
  thread: ChildAgentThread,
  activity?: ToolActivity
): AgentIdentity {
  // Lazy-create the providerMetadata + agentIdentities slots.
  if (!chat.providerMetadata) {
    chat.providerMetadata = {}
  }
  const meta = chat.providerMetadata as Record<string, unknown>
  if (!meta.agentIdentities || typeof meta.agentIdentities !== 'object') {
    meta.agentIdentities = {}
  }
  const map = meta.agentIdentities as Record<string, AgentIdentity>

  // Already assigned? Reuse.
  const existing = map[thread.id]
  if (existing && typeof existing.name === 'string' && typeof existing.color === 'string') {
    return existing
  }

  // For Codex, try the platform name first. Fall back to pool for everyone else.
  const usedNames = new Set<string>(Object.values(map).map((id) => id.name))
  let identity: AgentIdentity
  const platformName = thread.provider === 'codex' ? extractPlatformName(activity) : undefined
  if (platformName && !usedNames.has(platformName)) {
    // Color still comes from our pool — Codex's color choices aren't on the wire.
    const colorIndex = Object.keys(map).length % COLOR_POOL.length
    identity = {
      agentId: thread.id,
      name: platformName,
      color: COLOR_POOL[colorIndex],
      role: thread.role,
      source: 'platform',
      assignedAt: new Date().toISOString()
    }
  } else {
    const pair = pickNextPoolPair(usedNames)
    identity = {
      agentId: thread.id,
      name: pair.name,
      color: pair.color,
      role: thread.role,
      source: 'pool',
      assignedAt: new Date().toISOString()
    }
  }

  map[thread.id] = identity
  return identity
}

/**
 * Bulk-assign identities for a list of threads against a chat. Mutates
 * `chat.providerMetadata.agentIdentities` and returns the threads with
 * `identity` populated.
 */
export function attachIdentitiesToThreads(
  chat: ChatRecord | undefined,
  threads: ChildAgentThread[],
  activityById?: Map<string, ToolActivity>
): ChildAgentThread[] {
  if (!chat) return threads
  return threads.map((thread) => {
    const activity = activityById?.get(thread.parentToolCallId || thread.id)
    const identity = assignAgentIdentity(chat, thread, activity)
    return { ...thread, identity }
  })
}

/** Exported for tests and UI palettes. */
export const AGENT_NAME_POOL: readonly string[] = AGENT_NICKNAME_POOL
export const AGENT_COLOR_POOL: readonly string[] = COLOR_POOL

/**
 * Get the provider-id of the thread for an identity. Useful for the
 * BackgroundTasksPanel and the @-mention chip to render provider-specific
 * iconography alongside the identity.
 */
export function identityProvider(thread: ChildAgentThread | undefined): ProviderId | undefined {
  return thread?.provider
}
