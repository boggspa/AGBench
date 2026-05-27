import { describe, expect, it } from 'vitest'
import type { ChatRecord, WorkspaceRecord } from '../../../main/store/types'
import {
  rebindWelcomeEnsembleChatToGlobal,
  rebindWelcomeEnsembleChatToWorkspace
} from './ensembleWelcomeWorkspace'

const workspace: WorkspaceRecord = {
  id: 'ws-next',
  path: '/repo/next',
  displayName: 'Next',
  createdAt: 1,
  lastOpenedAt: 1,
  pinned: false
}

function ensembleChat(): ChatRecord {
  return {
    appChatId: 'ensemble-chat',
    chatKind: 'ensemble',
    scope: 'workspace',
    provider: 'codex',
    title: 'New Ensemble',
    workspaceId: 'ws-old',
    workspacePath: '/repo/old',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    messages: [],
    runs: [],
    ensemble: {
      enabled: true,
      maxParticipants: 6,
      participants: []
    }
  }
}

describe('rebindWelcomeEnsembleChatToWorkspace', () => {
  it('updates an empty welcome Ensemble chat in place', () => {
    const updated = rebindWelcomeEnsembleChatToWorkspace(
      ensembleChat(),
      workspace,
      true,
      1234
    )

    expect(updated?.appChatId).toBe('ensemble-chat')
    expect(updated?.chatKind).toBe('ensemble')
    expect(updated?.workspaceId).toBe('ws-next')
    expect(updated?.workspacePath).toBe('/repo/next')
    expect(updated?.updatedAt).toBe(1234)
  })

  it('does not touch non-welcome or non-Ensemble chats', () => {
    expect(rebindWelcomeEnsembleChatToWorkspace(ensembleChat(), workspace, false)).toBeNull()
    expect(
      rebindWelcomeEnsembleChatToWorkspace(
        { ...ensembleChat(), chatKind: 'single', ensemble: undefined },
        workspace,
        true
      )
    ).toBeNull()
  })
})

describe('rebindWelcomeEnsembleChatToGlobal', () => {
  // 1.0.5-EW4 — Rebind the current Ensemble welcome chat to global
  // scope in place, preserving all ensemble config (participants,
  // roles, models, reasoning, etc.). Pre-EW4 the "No workspace"
  // click in the welcome workspace picker created a brand-new
  // global Ensemble chat with default participants — silently
  // losing whatever roster the user just built. The rebind path
  // keeps the same chat id + ensemble config + just flips scope.
  it('rebinds an empty welcome Ensemble chat to global scope in place', () => {
    const rebound = rebindWelcomeEnsembleChatToGlobal(ensembleChat(), true, 9999)
    expect(rebound?.appChatId).toBe('ensemble-chat')
    expect(rebound?.chatKind).toBe('ensemble')
    expect(rebound?.scope).toBe('global')
    expect(rebound?.workspaceId).toBeUndefined()
    expect(rebound?.workspacePath).toBeUndefined()
    expect(rebound?.updatedAt).toBe(9999)
    expect(rebound?.ensemble?.enabled).toBe(true)
  })

  it('preserves the ensemble participant roster across the global rebind', () => {
    const original = ensembleChat()
    original.ensemble!.participants = [
      {
        id: 'farmer',
        provider: 'claude',
        enabled: true,
        role: 'Farmer',
        instructions: 'Tend the fields.',
        order: 1,
        permissionPresetId: 'read_only'
      },
      {
        id: 'plumber',
        provider: 'codex',
        enabled: true,
        role: 'Plumber',
        instructions: 'Pipe things.',
        order: 2,
        permissionPresetId: 'workspace_write'
      }
    ]
    const rebound = rebindWelcomeEnsembleChatToGlobal(original, true)
    expect(rebound?.ensemble?.participants).toHaveLength(2)
    expect(rebound?.ensemble?.participants?.[0]).toMatchObject({ id: 'farmer', role: 'Farmer' })
    expect(rebound?.ensemble?.participants?.[1]).toMatchObject({ id: 'plumber', role: 'Plumber' })
  })

  it('skips when already global (no-op signal so caller avoids a save round-trip)', () => {
    const alreadyGlobal: ChatRecord = {
      ...ensembleChat(),
      scope: 'global',
      workspaceId: undefined,
      workspacePath: undefined
    }
    expect(rebindWelcomeEnsembleChatToGlobal(alreadyGlobal, true)).toBeNull()
  })

  it('does not touch non-welcome or non-Ensemble chats', () => {
    expect(rebindWelcomeEnsembleChatToGlobal(ensembleChat(), false)).toBeNull()
    expect(
      rebindWelcomeEnsembleChatToGlobal(
        { ...ensembleChat(), chatKind: 'single', ensemble: undefined },
        true
      )
    ).toBeNull()
  })
})
