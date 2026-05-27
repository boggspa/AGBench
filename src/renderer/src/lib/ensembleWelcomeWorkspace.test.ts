import { describe, expect, it } from 'vitest'
import type { ChatRecord, WorkspaceRecord } from '../../../main/store/types'
import {
  rebindEnsembleChatToWorkspace,
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

describe('rebindEnsembleChatToWorkspace (1.0.5-EW41)', () => {
  // The non-welcome counterpart of `rebindWelcomeEnsembleChatToWorkspace`.
  // Used by `handleSelectExistingWorkspace` so a user mid-Ensemble who
  // picks a different workspace from the composer's workspace switcher
  // stays in their Ensemble (rebound to the new workspace) instead of
  // being thrown into a fresh single-provider welcome screen.
  it('rebinds an Ensemble chat with transcript history to the new workspace', () => {
    const original: ChatRecord = {
      ...ensembleChat(),
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'kick off',
          timestamp: '2026-05-27T00:00:01.000Z'
        }
      ]
    }
    const rebound = rebindEnsembleChatToWorkspace(original, workspace, 1234)
    expect(rebound?.appChatId).toBe('ensemble-chat')
    expect(rebound?.chatKind).toBe('ensemble')
    expect(rebound?.scope).toBe('workspace')
    expect(rebound?.workspaceId).toBe('ws-next')
    expect(rebound?.workspacePath).toBe('/repo/next')
    expect(rebound?.updatedAt).toBe(1234)
    // Preserves transcript — the user's history doesn't get wiped
    // mid-conversation when they re-aim the chat at a different repo.
    expect(rebound?.messages).toHaveLength(1)
  })

  it('preserves the participant roster across the workspace rebind', () => {
    const original = ensembleChat()
    original.ensemble!.participants = [
      {
        id: 'reviewer',
        provider: 'claude',
        enabled: true,
        role: 'Reviewer',
        instructions: 'Look at things.',
        order: 1,
        permissionPresetId: 'read_only'
      },
      {
        id: 'worker',
        provider: 'codex',
        enabled: true,
        role: 'Worker',
        instructions: 'Write things.',
        order: 2,
        permissionPresetId: 'workspace_write'
      }
    ]
    const rebound = rebindEnsembleChatToWorkspace(original, workspace)
    expect(rebound?.ensemble?.participants).toHaveLength(2)
    expect(rebound?.ensemble?.participants?.[0]).toMatchObject({
      id: 'reviewer',
      role: 'Reviewer'
    })
    expect(rebound?.ensemble?.participants?.[1]).toMatchObject({
      id: 'worker',
      role: 'Worker'
    })
  })

  it('returns null when the chat is already bound to the target workspace', () => {
    const alreadyOnTarget: ChatRecord = {
      ...ensembleChat(),
      workspaceId: workspace.id,
      workspacePath: workspace.path
    }
    // No-op signal so callers can skip the save round-trip + UI churn.
    expect(rebindEnsembleChatToWorkspace(alreadyOnTarget, workspace)).toBeNull()
  })

  it('rebinds a global Ensemble chat to a workspace (scope transition)', () => {
    const globalChat: ChatRecord = {
      ...ensembleChat(),
      scope: 'global',
      workspaceId: undefined,
      workspacePath: undefined
    }
    const rebound = rebindEnsembleChatToWorkspace(globalChat, workspace)
    expect(rebound?.scope).toBe('workspace')
    expect(rebound?.workspaceId).toBe('ws-next')
    expect(rebound?.workspacePath).toBe('/repo/next')
  })

  it('does not touch non-Ensemble chats (signals caller to fall back)', () => {
    expect(
      rebindEnsembleChatToWorkspace(
        { ...ensembleChat(), chatKind: 'single', ensemble: undefined },
        workspace
      )
    ).toBeNull()
    expect(rebindEnsembleChatToWorkspace(null, workspace)).toBeNull()
    expect(rebindEnsembleChatToWorkspace(undefined, workspace)).toBeNull()
  })

  it('does not require isWelcomeChat — the whole point of the helper', () => {
    // The pre-EW41 helper (`rebindWelcomeEnsembleChatToWorkspace`)
    // rejects non-welcome chats; this one accepts them. Verify the
    // contract delta explicitly so a future refactor doesn't
    // accidentally re-add a welcome gate.
    const established: ChatRecord = {
      ...ensembleChat(),
      messages: [
        { id: 'm1', role: 'user', content: 'one', timestamp: '2026-05-27T00:00:01.000Z' },
        { id: 'm2', role: 'assistant', content: 'two', timestamp: '2026-05-27T00:00:02.000Z' }
      ]
    }
    // The welcome-gated variant rejects this (isWelcomeChat would
    // be false because messages.length > 0). The non-gated one
    // accepts it.
    expect(rebindWelcomeEnsembleChatToWorkspace(established, workspace, false)).toBeNull()
    expect(rebindEnsembleChatToWorkspace(established, workspace)).not.toBeNull()
  })

  it('bumps ensemble.updatedAt alongside the chat updatedAt', () => {
    const rebound = rebindEnsembleChatToWorkspace(ensembleChat(), workspace, 5555)
    expect(rebound?.updatedAt).toBe(5555)
    // The ensemble.updatedAt is an ISO string derived from the now
    // value — should reflect the rebind moment, not the original
    // ensemble's creation time.
    expect(rebound?.ensemble?.updatedAt).toBe(new Date(5555).toISOString())
  })
})
