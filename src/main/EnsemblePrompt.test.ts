import { describe, expect, it } from 'vitest'
import {
  buildEnsembleParticipantPrompt,
  formatRoundModeInstructions,
  formatSameProviderDisambiguationNote,
  formatToolTraceSummary,
  getOrderedEnsembleParticipants
} from './EnsemblePrompt'
import type {
  ChatRecord,
  EnsembleConfig,
  EnsembleParticipant,
  ToolActivity
} from './store/types'

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

  it('moves the configured synthesizer last in chair-summary rounds', () => {
    const ordered = getOrderedEnsembleParticipants({
      ...ensemble,
      roundMode: 'chair-summary',
      synthesizerParticipantId: 'claude'
    })
    expect(ordered.map((participant) => participant.id)).toEqual([
      'codex',
      'gemini',
      'claude'
    ])
  })

  // 1.0.4-AR2 — pre-AR2 the prompt-builder treated any
  // `maxParticipants <= 4` as legacy data and fell back to the
  // global ceiling. AR2 honored the per-chat value as long as it's
  // in [2, 8].
  //
  // 1.0.5-EW5 — Semantics shifted: when stored `maxParticipants` is
  // smaller than the actual enabled-participant count, the cap is
  // healed up to the enabled count rather than truncating the
  // panel. Rationale: there's no UI to deliberately set a cap
  // SMALLER than the enabled participant count — the chip strip
  // bounds the panel by `participants.length < MAX_ENSEMBLE_PARTICIPANTS`
  // and the persist ratchets max up to participants.length on
  // every operation. The only way to get `max < enabled` is a
  // legacy chat from the 1.0.3 / 1.0.4 era where the global cap
  // was 6 / 8 — those chats should heal to dispatch every chip
  // their user has visible, not silently truncate to a number
  // they can't see being applied. The previous test asserted the
  // truncating behaviour; this one asserts the heal.
  it('heals a stale maxParticipants up to the enabled-participant count', () => {
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

    // All 6 enabled participants come through despite stored max=4.
    expect(getOrderedEnsembleParticipants(sixParticipantLegacy).map((p) => p.id)).toEqual([
      'claude',
      'codex',
      'gemini',
      'codex-2',
      'claude-2',
      'gemini-2'
    ])
  })

  // 1.0.5-EW1 — global ceiling raised 8 → 12. A panel with a
  // 12-participant roster + `maxParticipants: 12` must keep all 12
  // through the prompt builder; pre-EW1 the constant would have
  // silently clamped to 8 and the user would lose 4 participants
  // from the prompt context without warning.
  it('honors a 12-participant panel at the new global ceiling', () => {
    const extras = Array.from({ length: 9 }, (_, idx) => ({
      id: `extra-${idx + 1}`,
      provider: 'codex' as const,
      enabled: true,
      role: `Extra ${idx + 1}`,
      instructions: `Extra worker ${idx + 1}.`,
      order: 4 + idx,
      permissionPresetId: 'workspace_write' as const
    }))
    const twelveParticipant: EnsembleConfig = {
      ...ensemble,
      maxParticipants: 12,
      participants: [...ensemble.participants, ...extras]
    }
    const ids = getOrderedEnsembleParticipants(twelveParticipant).map((p) => p.id)
    expect(ids).toHaveLength(12)
    expect(ids.slice(0, 3)).toEqual(['claude', 'codex', 'gemini'])
    expect(ids).toContain('extra-9')
  })

  // 1.0.4-AR2 — `maxParticipants` of 0 / NaN / negative is treated as
  // missing data and falls back to the global ceiling so a corrupted
  // config can't accidentally produce a 0-participant slice.
  it('falls back to the global ceiling when maxParticipants is missing or out of range', () => {
    const zeroConfig: EnsembleConfig = { ...ensemble, maxParticipants: 0 }
    expect(getOrderedEnsembleParticipants(zeroConfig).map((p) => p.id)).toEqual([
      'claude',
      'codex',
      'gemini'
    ])
    const nanConfig: EnsembleConfig = { ...ensemble, maxParticipants: Number.NaN }
    expect(getOrderedEnsembleParticipants(nanConfig).map((p) => p.id)).toEqual([
      'claude',
      'codex',
      'gemini'
    ])
    const negConfig: EnsembleConfig = { ...ensemble, maxParticipants: -3 }
    expect(getOrderedEnsembleParticipants(negConfig).map((p) => p.id)).toEqual([
      'claude',
      'codex',
      'gemini'
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

  it('includes orchestrator-written session activity events in the round header', () => {
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: {
        ...ensemble,
        sessionActivityLedger: [
          {
            id: 'event-1',
            timestamp: '2026-05-27T20:04:00.000Z',
            changedBy: 'user',
            scope: 'participant',
            target: 'claude',
            oldValue: 'Claude / Explorer',
            newValue: 'Claude / Architect',
            reason: 'Participant role/name changed.'
          }
        ]
      },
      participant: ensemble.participants[0],
      currentPrompt: 'Continue.',
      roundId: 'round-1'
    })

    expect(prompt).toContain('Session events:')
    expect(prompt).toContain('User claude: Claude / Explorer -> Claude / Architect')
    expect(prompt).toContain('Participant role/name changed.')
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
      // Codex / Worker — order 2, middle of a 3-participant round
      participant: ensemble.participants[1],
      currentPrompt: 'Implement the change.',
      roundId: 'round-1'
    })
    // 1.0.4-AJ — middle slot now carries an explicit position
    // count ("you — position 2 of 3") to give the model a turn-
    // awareness signal. The first-speaker rule itself stays off.
    expect(prompt).toContain('Codex / Worker (you — position 2 of 3)')
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

  // 1.0.4-AJ — last-speaker awareness. The pre-fix failure mode
  // reported by Chris: the final participant in a turn-bound round
  // called `ensemble_yield(target: 'codex')` thinking they were
  // passing the baton, but nobody was scheduled after them — the
  // failed yield routed back to user as if the round had broken.
  // Now the closer knows they're last + has no yield target.
  it('marks the last speaker with "last speaker, position N of N" and emits the scoping rule (turn_bound)', () => {
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: ensemble,
      // ensemble.participants[2] is Gemini / Researcher — order 3,
      // last in the 3-participant rotation.
      participant: ensemble.participants[2],
      currentPrompt: 'Close out the round.',
      roundId: 'round-1'
    })
    expect(prompt).toContain('Gemini / Researcher (you — last speaker, position 3 of 3)')
    expect(prompt).toContain('SPEAKING LAST in this turn-bound round')
    expect(prompt).toContain('position 3 of 3')
    expect(prompt).toContain('`ensemble_yield(target: ...)` cannot route')
    expect(prompt).toContain('`@user`')
  })

  it('does NOT emit the last-speaker rule for non-last speakers in turn_bound', () => {
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: ensemble,
      // Codex / Worker — order 2, middle of a 3-participant round
      participant: ensemble.participants[1],
      currentPrompt: 'Take the middle slot.',
      roundId: 'round-1'
    })
    expect(prompt).not.toContain('SPEAKING LAST')
    expect(prompt).not.toContain('last speaker')
    // Middle slot in 3+ round gets the bare position marker
    expect(prompt).toContain('Codex / Worker (you — position 2 of 3)')
  })

  it('does NOT emit the last-speaker rule in continuous orchestration mode', () => {
    // Continuous mode has no fixed final turn — the hops budget
    // bounds the round instead. The last-speaker rule is
    // turn_bound-specific and would mislead a continuous speaker.
    const continuousEnsemble: EnsembleConfig = {
      ...ensemble,
      orchestrationMode: 'continuous',
      maxContinuationHops: 6
    }
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: continuousEnsemble,
      participant: continuousEnsemble.participants[2],
      currentPrompt: 'Continue the conversation.',
      roundId: 'round-1'
    })
    expect(prompt).not.toContain('SPEAKING LAST')
    expect(prompt).not.toContain('last speaker')
    // Continuous-mode speaker at the bottom of the roster still
    // gets a position marker for context (the round can extend
    // via the hop budget; "position 3 of 3" reflects roster
    // position, not a hard-end).
    expect(prompt).toContain('Gemini / Researcher (you — position 3 of 3)')
  })

  it('emits the hops-near-cap rule when continuous round is near its limit', () => {
    const continuousEnsemble: EnsembleConfig = {
      ...ensemble,
      orchestrationMode: 'continuous',
      maxContinuationHops: 4,
      activeRound: {
        id: 'round-1',
        startedAt: new Date().toISOString(),
        participantStatuses: {},
        continuationHops: 4 // exhausted → 0 remaining
      } as any
    }
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: continuousEnsemble,
      participant: continuousEnsemble.participants[1],
      currentPrompt: 'Mid-conversation handoff.',
      roundId: 'round-1'
    })
    expect(prompt).toContain('Continuation-hop budget is nearly exhausted')
    expect(prompt).toContain('0 extra handoffs remain')
  })

  it('emits the hops-near-cap rule with singular wording when exactly one hop remains', () => {
    const continuousEnsemble: EnsembleConfig = {
      ...ensemble,
      orchestrationMode: 'continuous',
      maxContinuationHops: 5,
      activeRound: {
        id: 'round-1',
        startedAt: new Date().toISOString(),
        participantStatuses: {},
        continuationHops: 4 // 1 remaining
      } as any
    }
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: continuousEnsemble,
      participant: continuousEnsemble.participants[0],
      currentPrompt: 'Last-but-one in continuous mode.',
      roundId: 'round-1'
    })
    expect(prompt).toContain('1 extra handoff remain')
    // Sanity: not plural
    expect(prompt).not.toContain('1 extra handoffs')
  })

  it('does NOT emit the hops-near-cap rule when budget has comfortable room', () => {
    const continuousEnsemble: EnsembleConfig = {
      ...ensemble,
      orchestrationMode: 'continuous',
      maxContinuationHops: 6,
      activeRound: {
        id: 'round-1',
        startedAt: new Date().toISOString(),
        participantStatuses: {},
        continuationHops: 0 // 6 remaining, plenty
      } as any
    }
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: continuousEnsemble,
      participant: continuousEnsemble.participants[0],
      currentPrompt: 'Fresh continuous round.',
      roundId: 'round-1'
    })
    expect(prompt).not.toContain('Continuation-hop budget is nearly exhausted')
  })

  // 1.0.4-AR8 — meta-round suspension. When the chat has no workspace
  // AND the round isn't self-reflective, the Round-subject stanza
  // AND the workspace-anchored deictic rule are BOTH omitted. In a
  // genuine conversational global chat there's no project anchor to
  // enforce, so injecting "ask which project they mean" friction was
  // counterproductive. The self-reflective AGBench-harness branch
  // remains unchanged (separate test below).
  it('1.0.4-AR8: suspends the Round-subject stanza for non-workspace non-self-reflective chats', () => {
    const globalChat = { ...chat(), workspacePath: undefined, scope: 'global' as const }
    const prompt = buildEnsembleParticipantPrompt({
      chat: globalChat,
      config: ensemble,
      participant: ensemble.participants[1],
      currentPrompt: 'What about this app?',
      roundId: 'round-1'
    })
    expect(prompt).not.toContain('Round subject:')
    expect(prompt).not.toContain('No workspace bound')
    expect(prompt).not.toContain('ask which project')
    // The workspace-anchored deictic rule must also be omitted.
    expect(prompt).not.toContain('refer to the active workspace named in `Round subject:`')
  })

  it('1.0.4-AF: always includes the Plan/Ensemble precedence note in the Rules', () => {
    // The note documents the orthogonal-modes contract for every
    // participant regardless of approval mode or self-reflective
    // state, so even a default round carries it.
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: ensemble,
      participant: ensemble.participants[1],
      currentPrompt: 'Implement.',
      roundId: 'round-1'
    })
    expect(prompt).toContain('Plan Mode and Ensemble Mode compose')
    expect(prompt).toContain('per-participant permission posture')
    expect(prompt).toContain('produce a plan, do not execute')
    expect(prompt).toContain('Other participants may still operate')
  })

  it('1.0.4-AF: inverts the deictic rule and rewrites the workspace stanza in selfReflective mode', () => {
    const reflectiveEnsemble: EnsembleConfig = { ...ensemble, selfReflective: true }
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: reflectiveEnsemble,
      participant: reflectiveEnsemble.participants[1],
      currentPrompt: 'What is AGBench getting right?',
      roundId: 'round-discuss'
    })
    // Workspace stanza calls out self-reflective mode and the bound
    // workspace appears as incidental context, not the topic.
    expect(prompt).toContain('Round subject: AGBench harness (self-reflective mode')
    expect(prompt).toContain('Bound workspace (incidental context): repo (/repo)')
    // Deictic rule is now the inverted variant.
    expect(prompt).toContain('refer to AGBench / the harness / this ensemble')
    expect(prompt).not.toContain('NOT to AGBench')
    expect(prompt).not.toContain('Discuss AGBench only when the user explicitly references it by name')
  })

  it('1.0.4-AF: self-reflective stanza handles the no-workspace case', () => {
    const reflectiveEnsemble: EnsembleConfig = { ...ensemble, selfReflective: true }
    const globalChat = { ...chat(), workspacePath: undefined, scope: 'global' as const }
    const prompt = buildEnsembleParticipantPrompt({
      chat: globalChat,
      config: reflectiveEnsemble,
      participant: reflectiveEnsemble.participants[1],
      currentPrompt: 'Reflect.',
      roundId: 'round-discuss-global'
    })
    expect(prompt).toContain('Round subject: AGBench harness (self-reflective mode')
    expect(prompt).toContain('No external workspace is bound')
    expect(prompt).not.toContain('Bound workspace (incidental context)')
  })

  it('1.0.4-AF: default rounds keep the original workspace-pointing deictic rule', () => {
    // Sanity check that the new branch doesn't leak into ordinary
    // rounds — selfReflective=false (or unset) should behave exactly
    // like 1.0.4-Q did.
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: ensemble,
      participant: ensemble.participants[1],
      currentPrompt: 'Walk through this codebase.',
      roundId: 'round-default'
    })
    expect(prompt).toContain('refer to the active workspace named in `Round subject:` above, NOT to AGBench')
    expect(prompt).not.toContain('self-reflective mode')
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

/*
 * 1.0.4-AR7 — pure-function coverage for the tool-trace summary
 * line that surfaces tool usage in the tagged transcript context.
 * The transcript-builder pre-AR7 dropped tool messages AND ignored
 * each assistant message's `toolActivities`, so downstream
 * participants had no idea what tools an upstream participant
 * had used. Now every assistant message with a non-empty
 * `toolActivities` array gets a one-line "(tools: read_file × 3
 * · edit × 2)" header prepended to its content.
 */
describe('formatToolTraceSummary', () => {
  const ta = (name: string): ToolActivity => ({
    id: `${name}-${Math.random().toString(36).slice(2, 8)}`,
    toolName: name,
    displayName: name,
    category: 'read',
    status: 'success'
  })

  it('returns the empty string when no activities are present', () => {
    expect(formatToolTraceSummary(undefined)).toBe('')
    expect(formatToolTraceSummary([])).toBe('')
  })

  it('aggregates repeated tool calls by name with a count', () => {
    const summary = formatToolTraceSummary([
      ta('read_file'),
      ta('read_file'),
      ta('read_file'),
      ta('edit')
    ])
    expect(summary).toBe('(tools: read_file × 3 · edit)')
  })

  it('orders by descending count, then alphabetically', () => {
    const summary = formatToolTraceSummary([
      ta('z_tool'),
      ta('a_tool'),
      ta('z_tool'),
      ta('a_tool')
    ])
    // Tie at 2 each → alphabetical wins.
    expect(summary).toBe('(tools: a_tool × 2 · z_tool × 2)')
  })

  it('caps the head at 6 distinct names and indicates truncation', () => {
    const activities = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(ta)
    const summary = formatToolTraceSummary(activities)
    expect(summary).toContain('a · b · c · d · e · f')
    expect(summary).toContain('…(+2 more)')
    expect(summary).not.toContain(' · g')
    expect(summary).not.toContain(' · h')
  })

  it('falls back to displayName when toolName is missing', () => {
    const summary = formatToolTraceSummary([
      { ...ta(''), toolName: '', displayName: 'Search' }
    ])
    expect(summary).toBe('(tools: Search)')
  })

  it('omits unnamed activities (no toolName + no displayName)', () => {
    const summary = formatToolTraceSummary([
      { ...ta(''), toolName: '', displayName: '' },
      ta('edit')
    ])
    expect(summary).toBe('(tools: edit)')
  })
})

/*
 * 1.0.4-AT8 — synthesizer/owner participant + last-round summary
 * propagation. The data shape lives on EnsembleConfig
 * (synthesizerParticipantId + lastRoundSummary). The prompt
 * builder integrates two things from it:
 *
 *   - When the current participant matches
 *     `synthesizerParticipantId`, an extra rule lands instructing
 *     them to emit a structured "Round summary:" block.
 *   - When `lastRoundSummary` is non-empty, every participant
 *     (synthesizer or not) sees it as a "Prior round summary"
 *     block above the recent transcript.
 *
 * The orchestrator-side end-of-round capture
 * (writing the synthesizer's text into `lastRoundSummary`) is a
 * documented follow-up; these tests pin the prompt-builder side
 * which can be exercised by setting the field directly.
 */
describe('Ensemble synthesizer + last-round summary (AT8)', () => {
  it('appends the synthesize-this-round instruction only to the designated synthesizer', () => {
    const synthEnsemble: EnsembleConfig = {
      ...ensemble,
      synthesizerParticipantId: 'codex'
    }
    const synthesizerPrompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: synthEnsemble,
      participant: synthEnsemble.participants.find((p) => p.id === 'codex')!,
      currentPrompt: 'Implement.',
      roundId: 'round-1'
    })
    expect(synthesizerPrompt).toContain('You are the designated SYNTHESIZER')
    expect(synthesizerPrompt).toContain('Decisions:')
    expect(synthesizerPrompt).toContain('Corrections:')
    expect(synthesizerPrompt).toContain('Open risks:')
    expect(synthesizerPrompt).toContain('Next action:')

    const nonSynthPrompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: synthEnsemble,
      participant: synthEnsemble.participants.find((p) => p.id === 'claude')!,
      currentPrompt: 'Implement.',
      roundId: 'round-1'
    })
    expect(nonSynthPrompt).not.toContain('designated SYNTHESIZER')
  })

  it('omits the synthesizer rule entirely when no synthesizer is configured', () => {
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: ensemble,
      participant: ensemble.participants[0],
      currentPrompt: 'Implement.',
      roundId: 'round-1'
    })
    expect(prompt).not.toContain('designated SYNTHESIZER')
  })

  it('injects the prior-round summary into EVERY participant prompt when set', () => {
    const summary =
      'Decisions: ship the X module. Corrections: the earlier read of foo.ts was outdated. Open risks: none. Next action: write tests.'
    const synthEnsemble: EnsembleConfig = {
      ...ensemble,
      synthesizerParticipantId: 'codex',
      lastRoundSummary: summary
    }
    const claudePrompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: synthEnsemble,
      participant: synthEnsemble.participants.find((p) => p.id === 'claude')!,
      currentPrompt: 'Continue.',
      roundId: 'round-2'
    })
    expect(claudePrompt).toContain('Prior round summary (from the panel synthesizer):')
    expect(claudePrompt).toContain('ship the X module')
  })

  it('skips the prior-summary block when lastRoundSummary is empty / whitespace', () => {
    const empty: EnsembleConfig = {
      ...ensemble,
      synthesizerParticipantId: 'codex',
      lastRoundSummary: '   '
    }
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: empty,
      participant: empty.participants[0],
      currentPrompt: 'Continue.',
      roundId: 'round-2'
    })
    expect(prompt).not.toContain('Prior round summary')
  })

  it('caps the prior-round summary at 2000 characters', () => {
    const longSummary = 'x'.repeat(3000)
    const longEnsemble: EnsembleConfig = {
      ...ensemble,
      lastRoundSummary: longSummary
    }
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: longEnsemble,
      participant: longEnsemble.participants[0],
      currentPrompt: 'Continue.',
      roundId: 'round-2'
    })
    // Should contain a truncated chunk, NOT the full 3000-char blob.
    expect(prompt).toContain('xxxxxxxxxx')
    expect(prompt.length).toBeLessThan(longSummary.length + 4000)
  })
})

/*
 * 1.0.4-AR13 — explicit round-mode model.
 *
 * Four modes — `targeted | roundtable | chair-summary | rebuttal`
 * — extending the implicit roundtable behavior that was the only
 * pre-AR13 shape. `targeted` overlaps with the existing DM path
 * and is enforced at the orchestrator level; the other three
 * adjust the participant prompt.
 */
describe('formatRoundModeInstructions (AR13)', () => {
  it('returns no lines for roundtable (the default)', () => {
    expect(
      formatRoundModeInstructions({ ...ensemble, roundMode: 'roundtable' }, 'codex')
    ).toEqual([])
  })

  it('returns no lines when roundMode is undefined (back-compat)', () => {
    expect(formatRoundModeInstructions(ensemble, 'codex')).toEqual([])
  })

  it('returns no lines for targeted (orchestrator handles routing, no participant rule needed)', () => {
    expect(
      formatRoundModeInstructions({ ...ensemble, roundMode: 'targeted' }, 'codex')
    ).toEqual([])
  })

  it('emits a synthesizer-flavored rule for chair-summary when current participant IS the synthesizer', () => {
    const lines = formatRoundModeInstructions(
      { ...ensemble, roundMode: 'chair-summary', synthesizerParticipantId: 'codex' },
      'codex'
    )
    expect(lines.join('\n')).toContain('CHAIR-SUMMARY')
    expect(lines.join('\n')).toContain('You speak last')
  })

  it('emits a non-synthesizer rule for chair-summary when current participant is NOT the synthesizer', () => {
    const lines = formatRoundModeInstructions(
      { ...ensemble, roundMode: 'chair-summary', synthesizerParticipantId: 'codex' },
      'claude'
    )
    expect(lines.join('\n')).toContain('CHAIR-SUMMARY')
    expect(lines.join('\n')).toContain('chair / synthesizer')
  })

  it('emits a rebuttal rule asking the participant to respond to the prior turn', () => {
    const lines = formatRoundModeInstructions(
      { ...ensemble, roundMode: 'rebuttal' },
      'codex'
    )
    expect(lines.join('\n')).toContain('REBUTTAL')
    expect(lines.join('\n')).toContain('IMMEDIATELY-PRIOR')
  })

  it('integrates the chair-summary rule into the full participant prompt', () => {
    const prompt = buildEnsembleParticipantPrompt({
      chat: chat(),
      config: {
        ...ensemble,
        roundMode: 'chair-summary',
        synthesizerParticipantId: 'codex'
      },
      participant: ensemble.participants.find((p) => p.id === 'codex')!,
      currentPrompt: 'Make a plan.',
      roundId: 'round-1'
    })
    expect(prompt).toContain('CHAIR-SUMMARY')
    expect(prompt).toContain('SYNTHESIZER')
  })
})
