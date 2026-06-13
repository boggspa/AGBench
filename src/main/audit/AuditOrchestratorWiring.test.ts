import { describe, expect, it } from 'vitest'
import {
  AuditArtifactCollector,
  buildAuditRolePayload,
  buildProviderSignals,
  type ProviderSignalInput
} from './AuditOrchestratorWiring'
import { createAuditToolExecutors } from '../mcp/AuditToolExecutors'
import type { AuditRoleRunRequest } from './AuditOrchestrator'
import type { AuditFinding } from '../store/types'

describe('buildProviderSignals', () => {
  it('maps live snapshots to resolver signals + defaults isLocal for ollama', () => {
    const inputs: ProviderSignalInput[] = [
      { provider: 'claude', configured: true, authenticated: true, healthy: true, usageBand: 'low' },
      { provider: 'ollama', configured: true, authenticated: true, healthy: true }
    ]
    const signals = buildProviderSignals(inputs)
    expect(signals[0]).toEqual({
      provider: 'claude',
      configured: true,
      authenticated: true,
      healthy: true,
      usageBand: 'low',
      isLocal: false
    })
    expect(signals[1].isLocal).toBe(true)
  })
})

describe('buildAuditRolePayload', () => {
  const req: AuditRoleRunRequest = {
    auditRunId: 'a1',
    role: 'reviewer',
    provider: 'claude',
    dimension: 'code health',
    workspacePath: '/repo',
    prompt: 'review it'
  }

  it('builds a read-only workspace payload carrying the auditRun identity', () => {
    const payload = buildAuditRolePayload(req, 'run-xyz', { scope: 'workspace' })
    expect(payload.provider).toBe('claude')
    expect(payload.scope).toBe('workspace')
    expect(payload.workspace).toBe('/repo')
    expect(payload.appRunId).toBe('run-xyz')
    expect(payload.approvalMode).toBe('plan') // read-only posture
    expect(payload.auditRun).toEqual({
      auditRunId: 'a1',
      role: 'reviewer',
      dimension: 'code health'
    })
  })

  it('omits workspace for a global-scope audit and carries findingId for skeptics', () => {
    const skeptic: AuditRoleRunRequest = {
      auditRunId: 'a1',
      role: 'skeptic',
      provider: 'codex',
      findingId: 'f9',
      workspacePath: '/repo',
      prompt: 'refute it'
    }
    const payload = buildAuditRolePayload(skeptic, 'run-2', { scope: 'global' })
    expect(payload.scope).toBe('global')
    expect(payload.workspace).toBeUndefined()
    expect(payload.auditRun?.findingId).toBe('f9')
  })
})

describe('AuditArtifactCollector', () => {
  const ids = { uuid: () => 'u', now: () => 't' }
  const ctx = (runId: string, over: Record<string, unknown> = {}) => ({
    auditRunId: 'a1',
    runId,
    role: 'reviewer' as const,
    provider: 'claude' as const,
    dimension: 'code health',
    ...over
  })
  const finding = (id: string): AuditFinding => ({
    id,
    dimension: 'code health',
    polarity: 'weakness',
    claim: id,
    severity: 'high',
    confidence: 0.8,
    evidenceRefs: [{ path: 'x.ts', line: 1 }],
    authorProvider: 'claude',
    dedupKey: `k-${id}`,
    verdictState: 'pending',
    createdAt: 't'
  })

  it('buckets artifacts by runId so concurrent runs never cross-contaminate', async () => {
    const collector = new AuditArtifactCollector()
    const ex = createAuditToolExecutors(collector.toolDependencies(ids))
    // Run A and run B both record under the same auditRunId but distinct runIds.
    await ex.executeAuditMcpTool(
      'audit_record_finding',
      { claim: 'A leak', severity: 'high', evidenceRefs: [{ path: 'a.ts', line: 1 }] },
      ctx('runA')
    )
    await ex.executeAuditMcpTool(
      'audit_record_finding',
      { claim: 'B leak', severity: 'high', evidenceRefs: [{ path: 'b.ts', line: 1 }] },
      ctx('runB')
    )
    const a = collector.take('runA')
    const b = collector.take('runB')
    expect(a.findings).toHaveLength(1)
    expect(a.findings[0].claim).toBe('A leak')
    expect(b.findings).toHaveLength(1)
    expect(b.findings[0].claim).toBe('B leak')
    // Draining removes the bucket.
    expect(collector.take('runA').findings).toHaveLength(0)
  })

  it('collects profile + verdicts via the tool path and discards on demand', async () => {
    const collector = new AuditArtifactCollector()
    const ex = createAuditToolExecutors(collector.toolDependencies(ids))
    await ex.executeAuditMcpTool(
      'audit_set_profile',
      { riskZones: ['relay'] },
      ctx('runR', { role: 'recon' })
    )
    await ex.executeAuditMcpTool(
      'audit_record_verdict',
      { findingId: 'f1', decision: 'accept' },
      ctx('runS', { role: 'skeptic' })
    )
    expect(collector.take('runR').profile?.riskZones).toEqual(['relay'])
    expect(collector.take('runS').verdicts).toHaveLength(1)

    collector.toolDependencies(ids).recordFinding(ctx('runX'), finding('f-x'))
    collector.discard('runX')
    expect(collector.take('runX').findings).toHaveLength(0)
  })
})
