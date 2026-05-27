import { describe, expect, it } from 'vitest'
import { resolveSessionLinkRouting } from './participantSessionLink'
import type { ChatRecord, EnsembleParticipant } from '../../../main/store/types'

function chat(overrides: Partial<ChatRecord> = {}): ChatRecord {
  return {
    appChatId: 'c1',
    title: 'Chat',
    provider: 'codex',
    chatKind: 'single',
    messages: [],
    runs: [],
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    ...overrides
  } as ChatRecord
}

function participant(overrides: Partial<EnsembleParticipant> = {}): EnsembleParticipant {
  return {
    id: 'codex-worker',
    provider: 'codex',
    enabled: true,
    role: 'Worker',
    instructions: '',
    order: 1,
    permissionPresetId: 'read_only',
    ...overrides
  } as EnsembleParticipant
}

describe('resolveSessionLinkRouting', () => {
  it('routes to chat for single-provider chats regardless of any "selected participant" leftover', () => {
    const result = resolveSessionLinkRouting({
      chat: chat({ chatKind: 'single' }),
      provider: 'codex',
      selectedParticipant: participant()
    })
    expect(result.target).toBe('chat')
    expect(result.participantId).toBeUndefined()
    expect(result.warning).toBeUndefined()
  })

  it('routes to chat for ensemble chats when no participant is selected', () => {
    const result = resolveSessionLinkRouting({
      chat: chat({ chatKind: 'ensemble' }),
      provider: 'codex',
      selectedParticipant: null
    })
    expect(result.target).toBe('chat')
    expect(result.participantId).toBeUndefined()
    expect(result.warning).toBeUndefined()
  })

  it('routes to participant when selected participant provider matches', () => {
    const result = resolveSessionLinkRouting({
      chat: chat({ chatKind: 'ensemble' }),
      provider: 'codex',
      selectedParticipant: participant({ id: 'codex-worker', provider: 'codex' })
    })
    expect(result.target).toBe('participant')
    expect(result.participantId).toBe('codex-worker')
    expect(result.warning).toBeUndefined()
  })

  it('falls back to chat with a warning when selected participant provider mismatches', () => {
    const result = resolveSessionLinkRouting({
      chat: chat({ chatKind: 'ensemble' }),
      provider: 'codex',
      selectedParticipant: participant({ id: 'claude-reviewer', provider: 'claude' })
    })
    expect(result.target).toBe('chat')
    expect(result.participantId).toBeUndefined()
    expect(result.warning).toContain('claude')
    expect(result.warning).toContain('codex')
  })

  it('falls back to chat when chat itself is null/undefined', () => {
    expect(
      resolveSessionLinkRouting({
        chat: null,
        provider: 'codex',
        selectedParticipant: participant()
      }).target
    ).toBe('chat')
    expect(
      resolveSessionLinkRouting({
        chat: undefined,
        provider: 'codex',
        selectedParticipant: participant()
      }).target
    ).toBe('chat')
  })

  // Multi-Codex panel — disambiguating between two same-provider
  // participants is the exact case AT1 is designed for. The chat
  // routing should always pick the SELECTED participant, never
  // some other Codex participant on the roster.
  it('binds to the selected codex-2 participant, not the first codex participant on the roster', () => {
    const result = resolveSessionLinkRouting({
      chat: chat({ chatKind: 'ensemble' }),
      provider: 'codex',
      selectedParticipant: participant({ id: 'codex-2', provider: 'codex', role: 'Reviewer' })
    })
    expect(result.target).toBe('participant')
    expect(result.participantId).toBe('codex-2')
  })
})
