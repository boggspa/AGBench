import { describe, expect, it } from 'vitest'
import type { BlackboardEntry } from '../store/types'
import {
  BLACKBOARD_MAX_ENTRIES,
  BLACKBOARD_MAX_VALUE_LEN,
  formatBlackboardForPrompt,
  makeBlackboardEntry,
  normalizeBlackboardCategory,
  normalizeBlackboardScope,
  pruneBlackboard,
  selectBlackboardForRound,
  upsertBlackboardEntry
} from './Blackboard'

function entry(overrides: Partial<BlackboardEntry> = {}): BlackboardEntry {
  return {
    id: overrides.id ?? 'e1',
    chatId: overrides.chatId ?? 'chat-1',
    roundId: overrides.roundId ?? 'round-1',
    participantId: overrides.participantId ?? 'p1',
    key: overrides.key ?? 'k',
    value: overrides.value ?? 'v',
    category: overrides.category ?? 'note',
    scope: overrides.scope ?? 'session',
    ...(overrides.derivedFrom ? { derivedFrom: overrides.derivedFrom } : {}),
    createdAt: overrides.createdAt ?? '2026-05-31T00:00:00.000Z'
  }
}

describe('normalizeBlackboardCategory', () => {
  it('passes through valid categories', () => {
    expect(normalizeBlackboardCategory('decision')).toBe('decision')
    expect(normalizeBlackboardCategory('risk')).toBe('risk')
    expect(normalizeBlackboardCategory('do-not-repeat')).toBe('do-not-repeat')
  })
  it('falls back to note for junk', () => {
    expect(normalizeBlackboardCategory('nonsense')).toBe('note')
    expect(normalizeBlackboardCategory(undefined)).toBe('note')
    expect(normalizeBlackboardCategory(42)).toBe('note')
  })
})

describe('normalizeBlackboardScope', () => {
  it('passes through valid scopes', () => {
    expect(normalizeBlackboardScope('round')).toBe('round')
    expect(normalizeBlackboardScope('chat')).toBe('chat')
  })
  it('defaults to session for junk', () => {
    expect(normalizeBlackboardScope('forever')).toBe('session')
    expect(normalizeBlackboardScope(null)).toBe('session')
  })
})

describe('makeBlackboardEntry', () => {
  const base = {
    id: 'id-1',
    chatId: 'chat-1',
    roundId: 'round-1',
    participantId: 'p1',
    createdAt: '2026-05-31T00:00:00.000Z'
  }

  it('builds a normalized entry', () => {
    const e = makeBlackboardEntry({ ...base, key: '  topic  ', value: '  hello  ', category: 'risk', scope: 'chat' })
    expect(e).not.toBeNull()
    expect(e).toMatchObject({ key: 'topic', value: 'hello', category: 'risk', scope: 'chat' })
  })

  it('rejects empty key or value (returns null)', () => {
    expect(makeBlackboardEntry({ ...base, key: '   ', value: 'x' })).toBeNull()
    expect(makeBlackboardEntry({ ...base, key: 'x', value: '   ' })).toBeNull()
  })

  it('defaults category=note, scope=session, participant fallback', () => {
    const e = makeBlackboardEntry({ ...base, participantId: '', key: 'k', value: 'v' })
    expect(e).toMatchObject({ category: 'note', scope: 'session', participantId: 'system' })
  })

  it('clamps an over-long value with an ellipsis', () => {
    const long = 'x'.repeat(BLACKBOARD_MAX_VALUE_LEN + 50)
    const e = makeBlackboardEntry({ ...base, key: 'k', value: long })
    expect(e!.value.length).toBeLessThanOrEqual(BLACKBOARD_MAX_VALUE_LEN)
    expect(e!.value.endsWith('…')).toBe(true)
  })

  it('keeps derivedFrom only when provided', () => {
    expect(makeBlackboardEntry({ ...base, key: 'k', value: 'v' })).not.toHaveProperty('derivedFrom')
    expect(makeBlackboardEntry({ ...base, key: 'k', value: 'v', derivedFrom: 'tool-7' })!.derivedFrom).toBe(
      'tool-7'
    )
  })
})

describe('upsertBlackboardEntry', () => {
  it('appends a fresh entry', () => {
    const out = upsertBlackboardEntry([], entry({ id: 'a' }))
    expect(out).toHaveLength(1)
  })

  it('replaces an entry with the same (participant,key,scope)', () => {
    const first = entry({ id: 'a', participantId: 'p1', key: 'plan', scope: 'session', value: 'old' })
    const second = entry({ id: 'b', participantId: 'p1', key: 'plan', scope: 'session', value: 'new' })
    const out = upsertBlackboardEntry([first], second)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'b', value: 'new' })
  })

  it('does NOT merge when scope differs', () => {
    const a = entry({ id: 'a', participantId: 'p1', key: 'plan', scope: 'session' })
    const b = entry({ id: 'b', participantId: 'p1', key: 'plan', scope: 'chat' })
    expect(upsertBlackboardEntry([a], b)).toHaveLength(2)
  })

  it('does NOT merge across participants', () => {
    const a = entry({ id: 'a', participantId: 'p1', key: 'plan' })
    const b = entry({ id: 'b', participantId: 'p2', key: 'plan' })
    expect(upsertBlackboardEntry([a], b)).toHaveLength(2)
  })

  it('caps at MAX_ENTRIES, dropping the oldest by createdAt', () => {
    let list: BlackboardEntry[] = []
    for (let i = 0; i < BLACKBOARD_MAX_ENTRIES; i++) {
      const n = String(i).padStart(3, '0')
      list = upsertBlackboardEntry(list, entry({ id: `e${n}`, key: `k${n}`, createdAt: `2026-05-31T00:00:00.${n}Z` }))
    }
    expect(list).toHaveLength(BLACKBOARD_MAX_ENTRIES)
    // One more, newest — should evict the oldest (k000).
    list = upsertBlackboardEntry(list, entry({ id: 'newest', key: 'knew', createdAt: '2026-05-31T01:00:00.000Z' }))
    expect(list).toHaveLength(BLACKBOARD_MAX_ENTRIES)
    expect(list.some((e) => e.key === 'k000')).toBe(false)
    expect(list.some((e) => e.key === 'knew')).toBe(true)
  })
})

describe('pruneBlackboard', () => {
  it('drops round-scoped entries from other rounds, keeps current round + session + chat', () => {
    const list = [
      entry({ id: 'r-old', scope: 'round', roundId: 'round-1' }),
      entry({ id: 'r-cur', scope: 'round', roundId: 'round-2' }),
      entry({ id: 's', scope: 'session', roundId: 'round-1' }),
      entry({ id: 'c', scope: 'chat', roundId: 'round-1' })
    ]
    const out = pruneBlackboard(list, 'round-2')
    expect(out.map((e) => e.id).sort()).toEqual(['c', 'r-cur', 's'])
  })
})

describe('selectBlackboardForRound', () => {
  it('hides foreign round-scoped entries but surfaces session/chat', () => {
    const list = [
      entry({ id: 'r-old', scope: 'round', roundId: 'round-1' }),
      entry({ id: 'r-cur', scope: 'round', roundId: 'round-2' }),
      entry({ id: 's', scope: 'session' })
    ]
    expect(selectBlackboardForRound(list, 'round-2').map((e) => e.id).sort()).toEqual(['r-cur', 's'])
  })
})

describe('formatBlackboardForPrompt', () => {
  it('returns empty string for no entries', () => {
    expect(formatBlackboardForPrompt([])).toBe('')
  })

  it('groups by category in stable order with author attribution', () => {
    const out = formatBlackboardForPrompt([
      entry({ key: 'naming', value: 'use camelCase', category: 'decision', participantId: 'Codex' }),
      entry({ key: 'db', value: 'sqlite is locked', category: 'risk', participantId: 'Claude' }),
      entry({ key: 'misc', value: 'fyi', category: 'note', participantId: 'Gemini' })
    ])
    expect(out).toContain('Decisions:')
    expect(out).toContain('naming: use camelCase (—Codex)')
    expect(out).toContain('Open risks:')
    expect(out).toContain('db: sqlite is locked (—Claude)')
    // Decisions must render before Open risks (category order).
    expect(out.indexOf('Decisions:')).toBeLessThan(out.indexOf('Open risks:'))
    // Notes render last.
    expect(out.indexOf('Open risks:')).toBeLessThan(out.indexOf('Notes:'))
  })

  it('omits empty category headers', () => {
    const out = formatBlackboardForPrompt([entry({ category: 'fact', key: 'k', value: 'v' })])
    expect(out).toContain('Verified facts:')
    expect(out).not.toContain('Decisions:')
    expect(out).not.toContain('Open risks:')
  })
})
