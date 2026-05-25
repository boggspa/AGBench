import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EnsembleParticipantsAboveRow } from './EnsembleParticipantsAboveRow'
import type { ChatRecord, EnsembleParticipant } from '../../../main/store/types'

function makeParticipant(overrides: Partial<EnsembleParticipant>): EnsembleParticipant {
  return {
    id: 'ensemble-claude',
    provider: 'claude',
    enabled: true,
    role: 'Explorer',
    instructions: '',
    order: 1,
    model: 'claude-opus-4-7',
    permissionPresetId: 'read_only',
    ...overrides
  }
}

function makeChat(participants: EnsembleParticipant[]): ChatRecord {
  return {
    appChatId: 'ensemble-chat',
    chatKind: 'ensemble',
    scope: 'workspace',
    provider: 'claude',
    title: 'New Ensemble',
    workspaceId: 'ws-1',
    workspacePath: '/repo',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    messages: [],
    runs: [],
    ensemble: {
      enabled: true,
      maxParticipants: 4,
      participants
    }
  }
}

describe('EnsembleParticipantsAboveRow', () => {
  it('returns null for non-ensemble chats', () => {
    const chat: ChatRecord = {
      appChatId: 'solo-chat',
      chatKind: 'single',
      scope: 'workspace',
      provider: 'claude',
      title: 'Solo',
      workspaceId: 'ws-1',
      workspacePath: '/repo',
      createdAt: 1,
      updatedAt: 1,
      archived: false,
      messages: [],
      runs: []
    }
    const html = renderToStaticMarkup(
      <EnsembleParticipantsAboveRow chat={chat} onChatChange={() => undefined} />
    )
    expect(html).toBe('')
  })

  it('renders a chip per participant with role + idle status by default', () => {
    const chat = makeChat([
      makeParticipant({ id: 'ensemble-claude', provider: 'claude', role: 'Explorer', order: 1 }),
      makeParticipant({ id: 'ensemble-codex', provider: 'codex', role: 'Worker', order: 2 })
    ])
    const html = renderToStaticMarkup(
      <EnsembleParticipantsAboveRow chat={chat} onChatChange={() => undefined} />
    )
    expect(html).toContain('Explorer')
    expect(html).toContain('Worker')
    // Two `status-idle` pills should appear (one per participant when no
    // active round).
    const idleHits = html.match(/status-idle/g) || []
    expect(idleHits.length).toBeGreaterThanOrEqual(2)
  })

  it('marks the active participant as speaking + others by their round status', () => {
    const chat = makeChat([
      makeParticipant({ id: 'ensemble-claude', provider: 'claude', role: 'Explorer', order: 1 }),
      makeParticipant({ id: 'ensemble-codex', provider: 'codex', role: 'Worker', order: 2 })
    ])
    chat.ensemble!.activeRound = {
      roundId: 'round-1',
      status: 'running',
      prompt: 'Plan and implement.',
      startedAt: '2026-05-25T15:00:00.000Z',
      activeParticipantId: 'ensemble-codex',
      participants: [
        {
          participantId: 'ensemble-claude',
          provider: 'claude',
          role: 'Explorer',
          order: 1,
          status: 'answered'
        },
        {
          participantId: 'ensemble-codex',
          provider: 'codex',
          role: 'Worker',
          order: 2,
          status: 'running'
        }
      ]
    }
    const html = renderToStaticMarkup(
      <EnsembleParticipantsAboveRow chat={chat} onChatChange={() => undefined} />
    )
    expect(html).toContain('status-speaking')
    expect(html).toContain('status-answered')
  })

  it('dims disabled participants but still renders them', () => {
    const chat = makeChat([
      makeParticipant({ id: 'ensemble-claude', enabled: true, role: 'Explorer' }),
      makeParticipant({
        id: 'ensemble-gemini',
        provider: 'gemini',
        enabled: false,
        role: 'Researcher',
        order: 2
      })
    ])
    const html = renderToStaticMarkup(
      <EnsembleParticipantsAboveRow chat={chat} onChatChange={() => undefined} />
    )
    expect(html).toContain('Researcher')
    expect(html).toContain('is-dimmed')
  })
})
