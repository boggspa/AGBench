import { describe, expect, it } from 'vitest'
import type { ChatRecord, WorkspaceRecord } from '../../../main/store/types'
import { rebindWelcomeEnsembleChatToWorkspace } from './ensembleWelcomeWorkspace'

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
