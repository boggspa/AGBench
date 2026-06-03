import { describe, expect, it } from 'vitest'
import { ensembleRoundStatusClass } from './ensembleRoundStatusClass'

describe('ensembleRoundStatusClass', () => {
  it('accents ensemble round-status / handback chrome', () => {
    expect(
      ensembleRoundStatusClass({ role: 'system', metadata: { kind: 'ensembleRoundStatus' } })
    ).toBe(' system-round-status')
  })

  it('leaves other system messages and non-system roles unaccented', () => {
    expect(
      ensembleRoundStatusClass({ role: 'system', metadata: { kind: 'ensembleParticipantStatus' } })
    ).toBe('')
    expect(
      ensembleRoundStatusClass({ role: 'assistant', metadata: { kind: 'ensembleRoundStatus' } })
    ).toBe('')
    expect(ensembleRoundStatusClass({ role: 'system', metadata: {} })).toBe('')
    expect(ensembleRoundStatusClass({ role: 'user', metadata: {} })).toBe('')
  })
})
