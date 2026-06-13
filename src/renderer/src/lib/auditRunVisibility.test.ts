import { describe, expect, it } from 'vitest'
import type { AuditRunRecord } from '../../../main/store/types'
import { selectVisibleAuditRun } from './auditRunVisibility'

function run(over: Partial<AuditRunRecord> = {}): AuditRunRecord {
  return {
    schemaVersion: 1,
    id: 'audit-1',
    mode: 'quick',
    chatId: 'chat-1',
    workspacePath: '/repo',
    status: 'completed',
    phases: [],
    dimensions: [],
    participants: [],
    findings: [],
    verdicts: [],
    gates: [],
    budget: { maxAgents: 12, spentAgents: 1, spentTokens: 0, truncated: false },
    createdAt: '2026-06-13T18:00:00.000Z',
    updatedAt: '2026-06-13T18:00:00.000Z',
    ...over
  }
}

describe('selectVisibleAuditRun', () => {
  it('returns an active run even when its id was previously dismissed', () => {
    const active = run({
      id: 'audit-active',
      status: 'running',
      updatedAt: '2026-06-13T19:00:00.000Z'
    })
    expect(selectVisibleAuditRun([active], 'chat-1', new Set(['audit-active']))).toBe(active)
  })

  it('returns the latest terminal run when it has not been dismissed', () => {
    const oldRun = run({ id: 'audit-old', updatedAt: '2026-06-13T18:00:00.000Z' })
    const latest = run({ id: 'audit-latest', updatedAt: '2026-06-13T19:00:00.000Z' })
    expect(selectVisibleAuditRun([oldRun, latest], 'chat-1', new Set())).toBe(latest)
  })

  it('does not resurrect older terminal runs after the latest banner is dismissed', () => {
    const oldRun = run({ id: 'audit-old', updatedAt: '2026-06-13T18:00:00.000Z' })
    const latest = run({ id: 'audit-latest', updatedAt: '2026-06-13T19:00:00.000Z' })
    expect(selectVisibleAuditRun([oldRun, latest], 'chat-1', new Set(['audit-latest']))).toBeNull()
  })
})
