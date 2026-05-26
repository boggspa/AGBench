import { describe, expect, it } from 'vitest'
import {
  buildEnsembleParticipantPrompt,
  getOrderedEnsembleParticipants
} from './EnsemblePrompt'
import type { ChatRecord, EnsembleConfig } from './store/types'

const ensemble: EnsembleConfig = {
  enabled: true,
  maxParticipants: 4,
  participants: [
    {
      id: 'claude',
      provider: 'claude',
      enabled: true,
      role: 'Reviewer',
      instructions: 'Review risks.',
      order: 1,
      permissionPresetId: 'read_only'
    },
    {
      id: 'codex',
      provider: 'codex',
      enabled: true,
      role: 'Worker',
      instructions: 'Implement changes.',
      order: 2,
      permissionPresetId: 'workspace_write'
    },
    {
      id: 'gemini',
      provider: 'gemini',
      enabled: true,
      role: 'Researcher',
      instructions: 'Find broader context.',
      order: 3,
      permissionPresetId: 'read_only'
    }
  ]
}

function chat(): ChatRecord {
  return {
    appChatId: 'chat-1',
    chatKind: 'ensemble',
    scope: 'workspace',
    provider: 'claude',
    title: 'Ensemble',
    workspaceId: 'ws-1',
    workspacePath: '/repo',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    messages: [
      { id: 'u1', role: 'user', content: 'Initial request', timestamp: '2026-05-24T00:00:00.000Z' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Review response',
        timestamp: '2026-05-24T00:00:01.000Z',
        metadata: {
          ensembleProvider: 'claude',
          ensembleRole: 'Reviewer'
        }
      }
    ],
    runs: [],
    ensemble
  }
}

describe('Ensemble prompt composition', () => {
  it('biases order with provider mentions without hiding transcript from others', () => {
    const ordered = getOrderedEnsembleParticipants(ensemble, '@codex please')
    expect(ordered.map((participant) => participant.provider)).toEqual([
      'codex',
      'claude',
      'gemini'
    ])
  })

  it('treats legacy maxParticipants=4 configs as six-capable', () => {
    const sixParticipantLegacy: EnsembleConfig = {
      ...ensemble,
      maxParticipants: 4,
      participants: [
        ...ensemble.participants,
        {
          id: 'codex-2',
          provider: 'codex',
          enabled: true,
          role: 'Worker 2',
          instructions: 'Work again.',
          order: 4,
          permissionPresetId: 'workspace_write'
        },
        {
          id: 'claude-2',
          provider: 'claude',
          enabled: true,
          role: 'Reviewer 2',
          instructions: 'Review again.',
          order: 5,
          permissionPresetId: 'read_only'
        },
        {
          id: 'gemini-2',
          provider: 'gemini',
          enabled: true,
          role: 'Researcher 2',
          instructions: 'Research again.',
          order: 6,
          permissionPresetId: 'read_only'
        }
      ]
    }

    expect(getOrderedEnsembleParticipants(sixParticipantLegacy).map((p) => p.id)).toEqual([
      'claude',
      'codex',
      'gemini',
      'codex-2',
      'claude-2',
      'gemini-2'
    ])
  })

  it('builds bounded tagged context with roster and role instructions', () => {
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: ensemble,
      participant: ensemble.participants[1],
      currentPrompt: 'Please implement this.',
      roundId: 'round-1',
      chatContextTurns: 4
    })
    expect(prompt).toContain('AGBench Ensemble Mode')
    expect(prompt).toContain('Codex / Worker')
    expect(prompt).toContain('Implement changes.')
    expect(prompt).toContain('[User]')
    expect(prompt).toContain('[Claude / Reviewer]')
    expect(prompt).toContain('Current user request:')
  })
})
