import { describe, expect, it } from 'vitest'
import { buildParticipantTokenChipModel } from './participantTokenChip'
import type { EnsembleParticipant } from '../../../main/store/types'

function participant(
  overrides: Partial<EnsembleParticipant> = {}
): EnsembleParticipant {
  return {
    id: 'p',
    provider: 'codex',
    enabled: true,
    role: 'Worker',
    instructions: '',
    order: 1,
    permissionPresetId: 'workspace_write',
    ...overrides
  } as EnsembleParticipant
}

describe('buildParticipantTokenChipModel (AV2)', () => {
  it('returns empty when participant has no tokenTotals', () => {
    expect(buildParticipantTokenChipModel(participant())).toEqual({
      label: '',
      tooltip: ''
    })
  })

  it('returns empty when total_tokens is under 1k (chip suppressed)', () => {
    const result = buildParticipantTokenChipModel(
      participant({ tokenTotals: { total_tokens: 950 } })
    )
    expect(result.label).toBe('')
  })

  it('formats k for thousands (rounded)', () => {
    expect(
      buildParticipantTokenChipModel(participant({ tokenTotals: { total_tokens: 1000 } })).label
    ).toBe('1k')
    expect(
      buildParticipantTokenChipModel(participant({ tokenTotals: { total_tokens: 12_344 } })).label
    ).toBe('12k')
    expect(
      buildParticipantTokenChipModel(participant({ tokenTotals: { total_tokens: 847_500 } })).label
    ).toBe('848k')
  })

  it('formats m for millions (one decimal under 10, integer at and above)', () => {
    expect(
      buildParticipantTokenChipModel(participant({ tokenTotals: { total_tokens: 1_234_567 } })).label
    ).toBe('1.2m')
    expect(
      buildParticipantTokenChipModel(participant({ tokenTotals: { total_tokens: 9_999_999 } })).label
    ).toBe('10.0m')
    expect(
      buildParticipantTokenChipModel(participant({ tokenTotals: { total_tokens: 14_500_000 } })).label
    ).toBe('15m')
  })

  it('builds a multi-segment tooltip from input/output/total/duration', () => {
    const result = buildParticipantTokenChipModel(
      participant({
        tokenTotals: {
          input_tokens: 8500,
          output_tokens: 4200,
          total_tokens: 12_700,
          duration_ms: 4500
        }
      })
    )
    expect(result.tooltip).toContain('8,500 in')
    expect(result.tooltip).toContain('4,200 out')
    expect(result.tooltip).toContain('12,700 total')
    expect(result.tooltip).toContain('4.5s')
  })

  it('formats duration over a minute as minutes', () => {
    const result = buildParticipantTokenChipModel(
      participant({
        tokenTotals: { total_tokens: 5000, duration_ms: 90_000 }
      })
    )
    expect(result.tooltip).toContain('1.5m')
  })

  it('omits zero-valued tooltip segments cleanly', () => {
    const result = buildParticipantTokenChipModel(
      participant({
        tokenTotals: { input_tokens: 0, output_tokens: 5000, total_tokens: 5000 }
      })
    )
    expect(result.tooltip).not.toContain('0 in')
    expect(result.tooltip).toContain('5,000 out')
    expect(result.tooltip).toContain('5,000 total')
  })
})
