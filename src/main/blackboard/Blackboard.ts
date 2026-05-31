/**
 * M4 — Ensemble Blackboard (cross-participant shared scratchpad).
 *
 * Pure, dependency-free helpers over a `BlackboardEntry[]`. The orchestrator
 * owns persistence (entries live on `chat.ensemble.blackboard`, round-tripped
 * via `saveAndBroadcastChat`); this module is the logic, kept pure so it's
 * exhaustively unit-testable without an Electron/main harness.
 *
 * Design intent (blueprint M4): participants consume a *compact, scoped digest*
 * of shared facts/risks/decisions rather than dumping full transcript memory
 * into every prompt. Entries carry a TTL scope (round/session/chat); round-
 * scoped entries are pruned when the round changes.
 */
import type {
  BlackboardCategory,
  BlackboardEntry,
  BlackboardScope
} from '../store/types'

/** Hard caps so the digest can never balloon a prompt. */
export const BLACKBOARD_MAX_ENTRIES = 60
export const BLACKBOARD_MAX_VALUE_LEN = 600
export const BLACKBOARD_MAX_KEY_LEN = 80

/** Stable render/derive order — decisions first, throwaway notes last. */
export const BLACKBOARD_CATEGORY_ORDER: BlackboardCategory[] = [
  'decision',
  'fact',
  'risk',
  'do-not-repeat',
  'note'
]

const CATEGORY_LABEL: Record<BlackboardCategory, string> = {
  decision: 'Decisions',
  fact: 'Verified facts',
  risk: 'Open risks',
  'do-not-repeat': 'Do not repeat',
  note: 'Notes'
}

const VALID_CATEGORIES = new Set<BlackboardCategory>(BLACKBOARD_CATEGORY_ORDER)
const VALID_SCOPES = new Set<BlackboardScope>(['round', 'session', 'chat'])

function clamp(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed
}

export function normalizeBlackboardCategory(value: unknown): BlackboardCategory {
  return typeof value === 'string' && VALID_CATEGORIES.has(value as BlackboardCategory)
    ? (value as BlackboardCategory)
    : 'note'
}

export function normalizeBlackboardScope(value: unknown): BlackboardScope {
  return typeof value === 'string' && VALID_SCOPES.has(value as BlackboardScope)
    ? (value as BlackboardScope)
    : 'session'
}

export interface MakeBlackboardEntryInput {
  id: string
  chatId: string
  roundId: string
  participantId: string
  key: string
  value: string
  category?: unknown
  scope?: unknown
  derivedFrom?: string
  createdAt: string
}

/**
 * Build a normalized entry. Returns null when key or value is effectively empty
 * — callers (the MCP handler) should treat null as "reject this post" rather
 * than persisting junk.
 */
export function makeBlackboardEntry(input: MakeBlackboardEntryInput): BlackboardEntry | null {
  const key = clamp(input.key ?? '', BLACKBOARD_MAX_KEY_LEN)
  const value = clamp(input.value ?? '', BLACKBOARD_MAX_VALUE_LEN)
  if (!key || !value) return null
  return {
    id: input.id,
    chatId: input.chatId,
    roundId: input.roundId,
    participantId: input.participantId || 'system',
    key,
    value,
    category: normalizeBlackboardCategory(input.category),
    scope: normalizeBlackboardScope(input.scope),
    ...(input.derivedFrom ? { derivedFrom: input.derivedFrom } : {}),
    createdAt: input.createdAt
  }
}

/**
 * Insert an entry, upserting on (participantId, key, scope): a participant
 * rewriting the same key under the same scope replaces its prior note instead
 * of stacking duplicates. The list is then capped to BLACKBOARD_MAX_ENTRIES,
 * dropping the OLDEST entries first (by createdAt, then array order).
 */
export function upsertBlackboardEntry(
  entries: BlackboardEntry[],
  entry: BlackboardEntry
): BlackboardEntry[] {
  const without = entries.filter(
    (e) =>
      !(
        e.participantId === entry.participantId &&
        e.key === entry.key &&
        e.scope === entry.scope
      )
  )
  const next = [...without, entry]
  if (next.length <= BLACKBOARD_MAX_ENTRIES) return next
  // Stable oldest-first sort, then keep the newest N.
  const sorted = [...next]
    .map((e, i) => ({ e, i }))
    .sort((a, b) =>
      a.e.createdAt === b.e.createdAt ? a.i - b.i : a.e.createdAt < b.e.createdAt ? -1 : 1
    )
    .map((x) => x.e)
  return sorted.slice(sorted.length - BLACKBOARD_MAX_ENTRIES)
}

/**
 * Drop entries that have expired relative to `currentRoundId`:
 * round-scoped entries from any OTHER round are removed. session/chat survive.
 * Call this when a new round starts.
 */
export function pruneBlackboard(
  entries: BlackboardEntry[],
  currentRoundId: string
): BlackboardEntry[] {
  return entries.filter((e) => e.scope !== 'round' || e.roundId === currentRoundId)
}

/**
 * Entries visible to participants in `currentRoundId`: everything except
 * round-scoped entries belonging to a different round. (Same predicate as
 * prune, but expressed as a read-time selector so callers can choose to prune
 * eagerly or filter lazily.)
 */
export function selectBlackboardForRound(
  entries: BlackboardEntry[],
  currentRoundId: string
): BlackboardEntry[] {
  return entries.filter((e) => e.scope !== 'round' || e.roundId === currentRoundId)
}

/**
 * Render a compact, category-grouped digest for prompt injection. Returns ''
 * when there are no entries so the caller can omit the section entirely.
 */
export function formatBlackboardForPrompt(entries: BlackboardEntry[]): string {
  if (entries.length === 0) return ''
  const byCategory = new Map<BlackboardCategory, BlackboardEntry[]>()
  for (const entry of entries) {
    const bucket = byCategory.get(entry.category)
    if (bucket) bucket.push(entry)
    else byCategory.set(entry.category, [entry])
  }
  const lines: string[] = ['Ensemble blackboard (shared scratchpad — treat as agreed context):']
  for (const category of BLACKBOARD_CATEGORY_ORDER) {
    const bucket = byCategory.get(category)
    if (!bucket || bucket.length === 0) continue
    lines.push(`  ${CATEGORY_LABEL[category]}:`)
    for (const entry of bucket) {
      lines.push(`    - ${entry.key}: ${entry.value} (—${entry.participantId})`)
    }
  }
  return lines.join('\n')
}
