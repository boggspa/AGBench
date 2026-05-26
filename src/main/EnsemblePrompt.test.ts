import { describe, expect, it } from 'vitest'
import {
  buildEnsembleParticipantPrompt,
  formatSameProviderDisambiguationNote,
  getOrderedEnsembleParticipants
} from './EnsemblePrompt'
import type { ChatRecord, EnsembleConfig, EnsembleParticipant } from './store/types'

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
    // Single-provider-per-role ensembles should NOT see the
    // same-provider disambiguation note — it's only relevant when
    // two participants share a provider.
    expect(prompt).not.toContain('multiple participants from the same provider')
  })

  it('emits a Round subject stanza naming the active workspace', () => {
    // 1.0.4 — Claude/Explorer's introspective feedback after picking
    // up AGBench-meta context instead of the bound workspace. The
    // stanza gives every participant a grounded antecedent for
    // "this app / this repo / this project" so the lazy resolution
    // path becomes the correct one.
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: ensemble,
      participant: ensemble.participants[1],
      currentPrompt: 'Tell me about this app.',
      roundId: 'round-1'
    })
    expect(prompt).toContain('Round subject: repo (/repo)')
    // The deictic rule should be in the Rules section too.
    expect(prompt).toContain('Deictic references')
    expect(prompt).toContain('"this app"')
    expect(prompt).toContain('NOT to AGBench')
  })

  it('marks the first speaker with "(you — first speaker)" and emits the scoping rule', () => {
    // 1.0.4 — first-speaker scoping nudge. Encourages opening
    // panelists to lay out direction before executing through to
    // completion, so other participants have room to weigh in.
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: ensemble,
      // ensemble.participants[0] is Claude / Reviewer — first in
      // order (1), so first speaker absent any @-mention reorder.
      participant: ensemble.participants[0],
      currentPrompt: 'Walk through this codebase.',
      roundId: 'round-1'
    })
    // Roster marker present for the first speaker
    expect(prompt).toContain('Claude / Reviewer (you — first speaker)')
    // Scoping rule present in the Rules section
    expect(prompt).toContain('SPEAKING FIRST in a multi-participant round')
    expect(prompt).toContain('Scope the problem and propose a direction')
    expect(prompt).toContain('Reading + analysis is fine')
  })

  it('does NOT emit the first-speaker rule for non-first speakers', () => {
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: ensemble,
      // Codex / Worker — order 2, not first
      participant: ensemble.participants[1],
      currentPrompt: 'Implement the change.',
      roundId: 'round-1'
    })
    // Plain "(you)" without the position suffix
    expect(prompt).toContain('Codex / Worker (you)')
    expect(prompt).not.toContain('first speaker')
    expect(prompt).not.toContain('SPEAKING FIRST')
  })

  it('does NOT emit the first-speaker rule for solo-participant ensembles', () => {
    // Single-participant ensemble — no panel to consult with, so
    // the scoping nudge would be unnecessary noise.
    const soloEnsemble: EnsembleConfig = {
      ...ensemble,
      participants: [ensemble.participants[0]]
    }
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: soloEnsemble,
      participant: soloEnsemble.participants[0],
      currentPrompt: 'Just you on this one.',
      roundId: 'round-1'
    })
    // Even for the single participant, no "first speaker" framing
    // since there's no second/third speaker to defer to.
    expect(prompt).toContain('Claude / Reviewer (you)')
    expect(prompt).not.toContain('first speaker')
    expect(prompt).not.toContain('SPEAKING FIRST')
  })

  it('emits the no-workspace fallback when the chat has no workspacePath', () => {
    const globalChat = { ...chat(), workspacePath: undefined, scope: 'global' as const }
    const prompt = buildEnsembleParticipantPrompt({
      chat: globalChat,
      config: ensemble,
      participant: ensemble.participants[1],
      currentPrompt: 'What about this app?',
      roundId: 'round-1'
    })
    expect(prompt).toContain('No workspace bound')
    expect(prompt).toContain('ask which project')
  })
})

describe('formatSameProviderDisambiguationNote', () => {
  function participant(
    overrides: Partial<EnsembleParticipant> & Pick<EnsembleParticipant, 'id' | 'provider'>
  ): EnsembleParticipant {
    return {
      enabled: true,
      role: '',
      instructions: '',
      order: 0,
      permissionPresetId: 'default',
      ...overrides
    } as EnsembleParticipant
  }

  it('returns empty when all providers are unique', () => {
    const note = formatSameProviderDisambiguationNote([
      participant({ id: 'a', provider: 'codex', role: 'Worker', model: 'gpt-5.5' }),
      participant({ id: 'b', provider: 'claude', role: 'Reviewer', model: 'claude-opus-4-7' }),
      participant({ id: 'c', provider: 'gemini', role: 'Researcher', model: 'gemini-2.5-pro' })
    ])
    expect(note).toBe('')
  })

  it('lists same-provider peers with short model labels and suggests explicit forms', () => {
    // The actual production repro: two Codex participants with
    // different models. Note should call out both, suggest @<role>
    // and @<short-model>, and warn about plain @codex.
    const note = formatSameProviderDisambiguationNote([
      participant({ id: 'codex-1', provider: 'codex', role: 'Brodex', model: 'gpt-5.5' }),
      participant({
        id: 'codex-2',
        provider: 'codex',
        role: 'Chodex #2',
        model: 'gpt-5.4-mini'
      })
    ])
    expect(note).toContain('multiple participants from the same provider')
    expect(note).toContain('Codex / Brodex (model: 5.5)')
    expect(note).toContain('Codex / Chodex #2 (model: 5.4 Mini)')
    expect(note).toContain('`@Brodex`')
    expect(note).toContain('`@5.5`')
    expect(note).toContain('Plain `@codex`')
    expect(note).toContain('non-deterministic')
  })

  it('handles multiple duplicate-provider groups in one note', () => {
    const note = formatSameProviderDisambiguationNote([
      participant({ id: 'codex-1', provider: 'codex', role: 'Brodex', model: 'gpt-5.5' }),
      participant({ id: 'codex-2', provider: 'codex', role: 'Chodex', model: 'gpt-5.4-mini' }),
      participant({
        id: 'claude-1',
        provider: 'claude',
        role: 'Reviewer',
        model: 'claude-opus-4-7'
      }),
      participant({
        id: 'claude-2',
        provider: 'claude',
        role: 'Critic',
        model: 'claude-sonnet-4-6'
      })
    ])
    expect(note).toContain('Codex / Brodex')
    expect(note).toContain('Codex / Chodex')
    expect(note).toContain('Claude / Reviewer (model: Opus 4.7)')
    expect(note).toContain('Claude / Critic (model: Sonnet 4.6)')
  })

  it('skips model suffix when participant has no resolved model', () => {
    const note = formatSameProviderDisambiguationNote([
      participant({ id: 'a', provider: 'codex', role: 'A', model: 'cli-default' }),
      participant({ id: 'b', provider: 'codex', role: 'B', model: 'cli-default' })
    ])
    // No model parenthetical — keeps the line readable when both
    // participants are on cli-default.
    expect(note).toContain('Codex / A')
    expect(note).toContain('Codex / B')
    expect(note).not.toContain('CLI Default')
    expect(note).not.toContain('(model:')
  })

  it('is included in the assembled participant prompt when same-provider peers exist', () => {
    const dupConfig: EnsembleConfig = {
      ...ensemble,
      participants: [
        participant({
          id: 'codex-brodex',
          provider: 'codex',
          role: 'Brodex',
          model: 'gpt-5.5',
          order: 1
        }),
        participant({
          id: 'codex-chodex',
          provider: 'codex',
          role: 'Chodex #2',
          model: 'gpt-5.4-mini',
          order: 2
        })
      ]
    }
    const chatRecord = chat()
    chatRecord.ensemble = dupConfig
    const prompt = buildEnsembleParticipantPrompt({
      chat: chatRecord,
      config: dupConfig,
      participant: dupConfig.participants[0],
      currentPrompt: 'Disambiguate.',
      roundId: 'round-disambig',
      chatContextTurns: 4
    })
    expect(prompt).toContain('multiple participants from the same provider')
    expect(prompt).toContain('Codex / Brodex')
    expect(prompt).toContain('Codex / Chodex #2')
    expect(prompt).toContain('`@codex`')
  })
})
