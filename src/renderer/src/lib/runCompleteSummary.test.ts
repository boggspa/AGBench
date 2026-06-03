import { describe, expect, it } from 'vitest'
import type { ChatRecord } from '../../../main/store/types'
import { buildEnsembleRoundSummaryRows, buildRoundOutcomeRows } from './runCompleteSummary'

// activeRound.participants is all buildRoundOutcomeRows reads; a partial cast
// keeps the fixture focused on status outcomes.
function chatWithParticipants(
  statuses: Array<{ role: string; provider: string; status: string }>
): ChatRecord {
  return {
    chatKind: 'ensemble',
    runs: [],
    ensemble: {
      activeRound: {
        roundId: 'r1',
        participants: statuses.map((s, i) => ({
          participantId: `p${i}`,
          provider: s.provider,
          role: s.role,
          order: i,
          status: s.status
        }))
      }
    }
  } as unknown as ChatRecord
}

describe('buildRoundOutcomeRows', () => {
  it('groups participants into contributed / skipped / failed', () => {
    const rows = buildRoundOutcomeRows(
      chatWithParticipants([
        { role: 'Worker', provider: 'codex', status: 'answered' },
        { role: 'Reviewer', provider: 'claude', status: 'yielded' },
        { role: 'Scout', provider: 'gemini', status: 'skipped' },
        { role: 'Runner', provider: 'grok', status: 'failed' },
        { role: 'Probe', provider: 'cursor', status: 'unreachable' },
        { role: 'Napper', provider: 'kimi', status: 'sleeping' }
      ])
    )
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]))
    expect(byLabel.Contributed).toBe('Worker, Reviewer')
    expect(byLabel.Skipped).toBe('Scout, Napper')
    expect(byLabel.Failed).toBe('Runner, Probe')
  })

  it('omits empty buckets and falls back to provider when role is blank', () => {
    const rows = buildRoundOutcomeRows(
      chatWithParticipants([{ role: '  ', provider: 'codex', status: 'answered' }])
    )
    expect(rows).toEqual([{ label: 'Contributed', value: 'codex' }])
  })

  it('returns nothing when there is no active round', () => {
    expect(buildRoundOutcomeRows(null)).toEqual([])
    expect(buildRoundOutcomeRows({} as unknown as ChatRecord)).toEqual([])
  })
})

describe('buildEnsembleRoundSummaryRows', () => {
  it('appends the outcome rollup right after Status', () => {
    const chat = chatWithParticipants([
      { role: 'Worker', provider: 'codex', status: 'answered' },
      { role: 'Scout', provider: 'gemini', status: 'skipped' }
    ])
    const labels = buildEnsembleRoundSummaryRows(chat, false).map((r) => r.label)
    expect(labels).toContain('Status')
    expect(labels).toContain('Contributed')
    expect(labels).toContain('Skipped')
    expect(labels.indexOf('Contributed')).toBe(labels.indexOf('Status') + 1)
  })
})
