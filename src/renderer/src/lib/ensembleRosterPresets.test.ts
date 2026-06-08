import { describe, expect, it } from 'vitest'
import type { EnsembleConfig } from '../../../main/store/types'
import {
  buildEnsembleRosterPresetFromConfig,
  materializeParticipantsFromPreset
} from './ensembleRosterPresets'

function sampleEnsemble(): EnsembleConfig {
  return {
    enabled: true,
    maxParticipants: 4,
    orchestrationMode: 'continuous',
    maxContinuationHops: 12,
    concurrentModeEnabled: true,
    participants: [
      {
        id: 'ensemble-participant-1',
        provider: 'claude',
        enabled: true,
        role: 'Planner',
        instructions: 'Plan the work.',
        order: 2,
        model: 'claude-sonnet-4-7',
        linkedProviderSessionId: 'session-abc'
      },
      {
        id: 'ensemble-participant-2',
        provider: 'codex',
        enabled: false,
        role: 'Builder',
        instructions: 'Implement the plan.',
        order: 1,
        model: 'gpt-5.4-medium'
      }
    ]
  }
}

describe('ensembleRosterPresets', () => {
  it('captures roster order and settings without runtime session ids', () => {
    const preset = buildEnsembleRosterPresetFromConfig('Review panel', sampleEnsemble(), 1_700_000_000_000)
    expect(preset.name).toBe('Review panel')
    expect(preset.orchestrationMode).toBe('continuous')
    expect(preset.maxContinuationHops).toBe(12)
    expect(preset.concurrentModeEnabled).toBe(true)
    expect(preset.participants.map((participant) => participant.role)).toEqual(['Builder', 'Planner'])
    expect(preset.participants[0]).toMatchObject({
      provider: 'codex',
      enabled: false,
      model: 'gpt-5.4-medium'
    })
    expect(preset.participants[0]).not.toHaveProperty('linkedProviderSessionId')
  })

  it('materializes fresh participant ids while preserving order', () => {
    const preset = buildEnsembleRosterPresetFromConfig('Review panel', sampleEnsemble(), 1_700_000_000_000)
    const participants = materializeParticipantsFromPreset(preset.participants)
    expect(participants).toHaveLength(2)
    expect(participants.map((participant) => participant.role)).toEqual(['Builder', 'Planner'])
    expect(participants.map((participant) => participant.order)).toEqual([1, 2])
    expect(participants.every((participant) => participant.id.startsWith('ensemble-participant-'))).toBe(
      true
    )
    expect(participants.every((participant) => participant.linkedProviderSessionId === null)).toBe(
      true
    )
  })
})
