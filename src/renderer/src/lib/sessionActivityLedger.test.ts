import { describe, expect, it } from 'vitest'
import type {
  ChatMessage,
  ChatRecord,
  EnsembleParticipant,
  SessionActivityLedgerEntry
} from '../../../main/store/types'
import {
  deriveParticipantRenameContinuity,
  withSessionActivityLedger
} from './sessionActivityLedger'

function participant(overrides: Partial<EnsembleParticipant> = {}): EnsembleParticipant {
  return {
    id: 'p1',
    provider: 'claude',
    enabled: true,
    role: 'Explorer',
    instructions: 'Explore.',
    order: 1,
    permissionPresetId: 'read_only',
    ...overrides
  }
}

function chat(participants: EnsembleParticipant[] = [participant()]): ChatRecord {
  return {
    appChatId: 'ensemble-1',
    chatKind: 'ensemble',
    scope: 'workspace',
    provider: 'claude',
    title: 'Ensemble',
    workspaceId: 'ws-1',
    workspacePath: '/repo/one',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    messages: [],
    runs: [],
    ensemble: {
      enabled: true,
      maxParticipants: 6,
      orchestrationMode: 'turn_bound',
      participants,
      updatedAt: '2026-05-27T00:00:00.000Z'
    }
  }
}

describe('sessionActivityLedger', () => {
  it('records participant role/name changes with provider-role hybrid labels', () => {
    const before = chat([participant({ role: 'Explorer' })])
    const after = chat([participant({ role: 'Architect' })])

    const updated = withSessionActivityLedger(before, after)

    expect(updated.ensemble?.sessionActivityLedger).toMatchObject([
      {
        changedBy: 'user',
        scope: 'participant',
        target: 'p1',
        oldValue: 'Claude / Explorer',
        newValue: 'Claude / Architect',
        reason: 'Participant role/name changed.'
      }
    ])
  })

  it('records participant permission preset changes as policy shifts', () => {
    const before = chat([participant({ permissionPresetId: 'read_only' })])
    const after = chat([participant({ permissionPresetId: 'workspace_write' })])

    const updated = withSessionActivityLedger(before, after)

    expect(updated.ensemble?.sessionActivityLedger?.[0]).toMatchObject({
      changedBy: 'user',
      scope: 'participant',
      target: 'Claude / Explorer permission preset',
      oldValue: 'read_only',
      newValue: 'workspace_write'
    })
  })

  it('records workspace rebinding for empty welcome Ensemble chats', () => {
    const before = chat()
    const after: ChatRecord = {
      ...before,
      workspaceId: 'ws-2',
      workspacePath: '/repo/two'
    }

    const updated = withSessionActivityLedger(before, after)

    expect(updated.ensemble?.sessionActivityLedger?.[0]).toMatchObject({
      changedBy: 'user',
      scope: 'session',
      target: 'workspace',
      oldValue: '/repo/one',
      newValue: '/repo/two'
    })
  })

  it('does not add an entry for unchanged Ensemble config', () => {
    const before = chat()
    const updated = withSessionActivityLedger(before, { ...before })

    expect(updated.ensemble?.sessionActivityLedger).toBeUndefined()
  })
})

/*
 * 1.0.7 — participant-rename continuity for the transcript. A small
 * "renamed from X" note that lets a reader follow one seat across a
 * mid-session role rename. Ledger-preferred with a frozen-vs-current
 * fallback; never mutates the frozen `ensembleRole`.
 */
describe('deriveParticipantRenameContinuity', () => {
  function assistantMsg(overrides: Partial<ChatMessage['metadata']> = {}): ChatMessage {
    return {
      id: 'a1',
      role: 'assistant',
      content: 'Prior turn.',
      timestamp: '2026-05-27T00:00:00.000Z',
      metadata: {
        ensembleProvider: 'claude',
        ensembleRole: 'Planner',
        ensembleParticipantId: 'p1',
        ...overrides
      }
    }
  }

  const renameEntry = (
    overrides: Partial<SessionActivityLedgerEntry> = {}
  ): SessionActivityLedgerEntry => ({
    id: 'e1',
    timestamp: '2026-05-27T00:01:00.000Z',
    changedBy: 'user',
    scope: 'participant',
    target: 'p1',
    oldValue: 'Claude / Planner',
    newValue: 'Claude / Architect',
    reason: 'Participant role/name changed.',
    ...overrides
  })

  it('returns null when the message is not an ensemble assistant message', () => {
    const roster = [participant({ id: 'p1', role: 'Architect' })]
    expect(
      deriveParticipantRenameContinuity(
        { role: 'user', metadata: { ensembleParticipantId: 'p1' } },
        roster,
        []
      )
    ).toBeNull()
  })

  it('returns null when the frozen role matches the current role', () => {
    const roster = [participant({ id: 'p1', role: 'Planner' })]
    expect(deriveParticipantRenameContinuity(assistantMsg(), roster, [])).toBeNull()
  })

  it('falls back to frozen-vs-current when the ledger has no matching entry', () => {
    // Ledger empty (rename aged out) — the frozen role drives the note.
    const roster = [participant({ id: 'p1', role: 'Architect' })]
    const result = deriveParticipantRenameContinuity(assistantMsg(), roster, [])
    expect(result).toEqual({ fromRole: 'Planner', currentRole: 'Architect' })
  })

  it('prefers the ledger entry when present and consistent with the frozen role', () => {
    const roster = [participant({ id: 'p1', role: 'Architect' })]
    const result = deriveParticipantRenameContinuity(assistantMsg(), roster, [renameEntry()])
    expect(result).toEqual({ fromRole: 'Planner', currentRole: 'Architect' })
  })

  it('uses the ledger old role when the message carries no frozen role', () => {
    // Older transcript row predating the ensembleRole stamp.
    const roster = [participant({ id: 'p1', role: 'Architect' })]
    const msg = assistantMsg({ ensembleRole: undefined })
    const result = deriveParticipantRenameContinuity(msg, roster, [renameEntry()])
    expect(result).toEqual({ fromRole: 'Planner', currentRole: 'Architect' })
  })

  it('ignores a stale intermediate ledger rename that does not land on the current role', () => {
    // Seat renamed Planner→Architect, then Architect→Lead. Current is
    // Lead. The Planner→Architect entry must NOT mislabel this. The
    // message frozen as "Planner" should report the per-message-
    // accurate frozen role as the "from".
    const roster = [participant({ id: 'p1', role: 'Lead' })]
    const ledger = [
      renameEntry({ id: 'e1', oldValue: 'Claude / Planner', newValue: 'Claude / Architect' }),
      renameEntry({ id: 'e2', oldValue: 'Claude / Architect', newValue: 'Claude / Lead' })
    ]
    const result = deriveParticipantRenameContinuity(assistantMsg(), roster, ledger)
    expect(result).toEqual({ fromRole: 'Planner', currentRole: 'Lead' })
  })

  it('returns null when the participant id is not in the current roster', () => {
    const roster = [participant({ id: 'other', role: 'Architect' })]
    expect(deriveParticipantRenameContinuity(assistantMsg(), roster, [renameEntry()])).toBeNull()
  })

  it('does not fire for a rename-then-rename-back to the original name', () => {
    // Planner→Architect→Planner. A message frozen as the original
    // "Planner" matches the current name again → no confusing note.
    const roster = [participant({ id: 'p1', role: 'Planner' })]
    const ledger = [
      renameEntry({ id: 'e1', oldValue: 'Claude / Planner', newValue: 'Claude / Architect' }),
      renameEntry({ id: 'e2', oldValue: 'Claude / Architect', newValue: 'Claude / Planner' })
    ]
    expect(deriveParticipantRenameContinuity(assistantMsg(), roster, ledger)).toBeNull()
  })

  it('ignores non-rename participant events sharing the seat', () => {
    // A permission-preset entry (target is the LABEL, not the id) must
    // not be mistaken for a rename. With an empty role-rename history
    // the frozen-vs-current fallback still drives the note.
    const roster = [participant({ id: 'p1', role: 'Architect' })]
    const ledger = [
      renameEntry({
        id: 'perm',
        target: 'Claude / Planner permission preset',
        oldValue: 'read_only',
        newValue: 'workspace_write',
        reason: 'Participant permission preset changed.'
      })
    ]
    const result = deriveParticipantRenameContinuity(assistantMsg(), roster, ledger)
    expect(result).toEqual({ fromRole: 'Planner', currentRole: 'Architect' })
  })
})
