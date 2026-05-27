import { describe, expect, it } from 'vitest'
import { resolveRuntimePickerScope } from './participantRuntimeProfile'
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

describe('resolveRuntimePickerScope', () => {
  it('returns chat scope for single-provider chats with the chat-level selection passed through', () => {
    const result = resolveRuntimePickerScope({
      chat: chat({ chatKind: 'single' }),
      chatLevelSelection: 'codex-builtin-global',
      chatLevelProvider: 'codex',
      selectedParticipant: participant()
    })
    expect(result.target).toBe('chat')
    expect(result.provider).toBe('codex')
    expect(result.selectedRuntimeProfileId).toBe('codex-builtin-global')
    expect(result.participantId).toBeUndefined()
  })

  it('returns chat scope when the chat is ensemble but no participant is selected', () => {
    const result = resolveRuntimePickerScope({
      chat: chat({ chatKind: 'ensemble' }),
      chatLevelSelection: 'codex-builtin-workspace',
      chatLevelProvider: 'codex',
      selectedParticipant: null
    })
    expect(result.target).toBe('chat')
    expect(result.provider).toBe('codex')
    expect(result.selectedRuntimeProfileId).toBe('codex-builtin-workspace')
  })

  it('returns participant scope when ensemble + selected participant exists, reading the participant runtimeProfileId', () => {
    const result = resolveRuntimePickerScope({
      chat: chat({ chatKind: 'ensemble' }),
      chatLevelSelection: 'codex-builtin-workspace',
      chatLevelProvider: 'codex',
      selectedParticipant: participant({
        id: 'claude-reviewer',
        provider: 'claude',
        runtimeProfileId: 'claude-builtin-global'
      })
    })
    expect(result.target).toBe('participant')
    expect(result.provider).toBe('claude') // selected participant's provider, NOT chat's
    expect(result.participantId).toBe('claude-reviewer')
    expect(result.selectedRuntimeProfileId).toBe('claude-builtin-global')
  })

  it('reports null selectedRuntimeProfileId when participant has no runtimeProfileId set', () => {
    const result = resolveRuntimePickerScope({
      chat: chat({ chatKind: 'ensemble' }),
      chatLevelSelection: 'codex-builtin-workspace',
      chatLevelProvider: 'codex',
      selectedParticipant: participant({ id: 'gemini-researcher', provider: 'gemini' })
    })
    expect(result.target).toBe('participant')
    expect(result.provider).toBe('gemini')
    expect(result.selectedRuntimeProfileId).toBeNull()
  })

  it('ignores chatLevelSelection in participant scope (the participant\'s own field is authoritative)', () => {
    const result = resolveRuntimePickerScope({
      chat: chat({ chatKind: 'ensemble' }),
      chatLevelSelection: 'should-be-ignored',
      chatLevelProvider: 'gemini',
      selectedParticipant: participant({
        id: 'kimi-reviewer',
        provider: 'kimi',
        runtimeProfileId: 'kimi-explicit'
      })
    })
    expect(result.selectedRuntimeProfileId).toBe('kimi-explicit')
  })

  it('handles a null/undefined chat by falling back to chat scope', () => {
    const result = resolveRuntimePickerScope({
      chat: null,
      chatLevelSelection: 'codex-builtin-global',
      chatLevelProvider: 'codex',
      selectedParticipant: participant()
    })
    expect(result.target).toBe('chat')
  })
})
