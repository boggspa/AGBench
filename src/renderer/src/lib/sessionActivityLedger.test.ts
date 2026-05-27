import { describe, expect, it } from 'vitest'
import type { ChatRecord, EnsembleParticipant } from '../../../main/store/types'
import { withSessionActivityLedger } from './sessionActivityLedger'

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
