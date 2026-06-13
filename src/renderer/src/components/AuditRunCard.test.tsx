import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AuditRunCard } from './AuditRunCard'
import type { AuditRunRecord } from '../../../main/store/types'

function auditRun(over: Partial<AuditRunRecord> = {}): AuditRunRecord {
  return {
    schemaVersion: 1,
    id: 'audit-1',
    mode: 'quick',
    chatId: 'chat-1',
    workspacePath: '/repo',
    status: 'running',
    phases: [
      { id: 'recon', status: 'completed' },
      { id: 'plan', status: 'completed' },
      { id: 'gates', status: 'running' },
      { id: 'review', status: 'pending' },
      { id: 'dedup', status: 'pending' },
      { id: 'verify', status: 'pending' },
      { id: 'synthesis', status: 'pending' }
    ],
    dimensions: ['code health'],
    roster: { perRole: { reviewer: ['kimi'] }, degradations: [] },
    participants: [{ runId: 'r1', role: 'reviewer', provider: 'kimi', status: 'running' }],
    findings: [],
    verdicts: [],
    gates: [{ id: 'g1', check: 'typecheck', command: 'npm run typecheck', status: 'pass' }],
    budget: { maxAgents: 12, spentAgents: 3, spentTokens: 400, truncated: false },
    createdAt: 't0',
    updatedAt: 't0',
    ...over
  }
}

describe('AuditRunCard', () => {
  it('renders active audit status with cancel action and progress summaries', () => {
    const html = renderToStaticMarkup(<AuditRunCard run={auditRun()} onCancel={() => {}} />)
    expect(html).toContain('TaskWraith Audit')
    expect(html).toContain('Running')
    expect(html).toContain('Gates')
    expect(html).toContain('0 findings')
    expect(html).toContain('1 running')
    expect(html).toContain('3/12 agents')
    expect(html).toContain('Cancel')
  })

  it('renders completed audit report state without cancel action', () => {
    const html = renderToStaticMarkup(
      <AuditRunCard run={auditRun({ status: 'completed', report: '# Audit report' })} />
    )
    expect(html).toContain('Completed')
    expect(html).not.toContain('Cancel')
  })

  it('surfaces failed audit errors', () => {
    const html = renderToStaticMarkup(
      <AuditRunCard run={auditRun({ status: 'failed', error: 'No eligible provider.' })} />
    )
    expect(html).toContain('Failed')
    expect(html).toContain('No eligible provider.')
  })
})
