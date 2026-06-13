import { describe, expect, it } from 'vitest'
import { auditTranscriptMessageKind, createAuditTranscriptMessage } from './AuditTranscriptMessages'
import type { AuditRunRecord } from '../store/types'

function run(over: Partial<AuditRunRecord> = {}): AuditRunRecord {
  return {
    schemaVersion: 1,
    id: 'audit-1',
    mode: 'quick',
    chatId: 'chat-1',
    workspacePath: '/repo',
    status: 'planning',
    phases: [],
    dimensions: [],
    participants: [],
    findings: [],
    verdicts: [],
    gates: [],
    budget: { maxAgents: 1, spentAgents: 0, spentTokens: 0, truncated: false },
    createdAt: 't0',
    updatedAt: 't0',
    ...over
  }
}

describe('AuditTranscriptMessages', () => {
  it('maps active and terminal statuses to transcript message kinds', () => {
    expect(auditTranscriptMessageKind(run({ status: 'planning' }))).toBe('started')
    expect(auditTranscriptMessageKind(run({ status: 'running' }))).toBe('started')
    expect(auditTranscriptMessageKind(run({ status: 'completed' }))).toBe('completed')
    expect(auditTranscriptMessageKind(run({ status: 'failed' }))).toBe('failed')
    expect(auditTranscriptMessageKind(run({ status: 'cancelled' }))).toBe('cancelled')
  })

  it('creates a start anchor that is explicit about hidden v1 role-runs', () => {
    const message = createAuditTranscriptMessage(run(), 'started', '2026-01-01T00:00:00.000Z')
    expect(message.role).toBe('system')
    expect(message.content).toContain('audit role-runs are internal background runs')
    expect(message.metadata).toMatchObject({
      kind: 'auditRunStatus',
      auditRunId: 'audit-1',
      auditMessageKind: 'started'
    })
  })

  it('posts the completed report back into the parent transcript', () => {
    const message = createAuditTranscriptMessage(
      run({ status: 'completed', report: '# Audit report\n\nDone.' }),
      'completed',
      '2026-01-01T00:00:00.000Z'
    )
    expect(message.role).toBe('system')
    expect(message.content).toContain('# Audit report')
  })

  it('uses an error message for failed audits', () => {
    const message = createAuditTranscriptMessage(
      run({ status: 'failed', error: 'No eligible provider.' }),
      'failed',
      '2026-01-01T00:00:00.000Z'
    )
    expect(message.role).toBe('error')
    expect(message.content).toContain('No eligible provider.')
  })
})
