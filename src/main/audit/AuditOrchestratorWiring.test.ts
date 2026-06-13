import { describe, expect, it } from 'vitest'
import {
  AuditArtifactCollector,
  AuditRunRegistry,
  buildAuditRolePayload,
  buildProviderSignals,
  createAuditRuntime,
  isAuditMcpToolName,
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

describe('AuditRunRegistry + isAuditMcpToolName', () => {
  it('registers, resolves, and unregisters run contexts', () => {
    const registry = new AuditRunRegistry()
    const context = {
      auditRunId: 'a1',
      runId: 'run-1',
      role: 'reviewer' as const,
      provider: 'claude' as const,
      dimension: 'code health'
    }
    expect(registry.get('run-1')).toBeNull()
    registry.register('run-1', context)
    expect(registry.get('run-1')).toEqual(context)
    expect(registry.get(undefined)).toBeNull()
    registry.unregister('run-1')
    expect(registry.get('run-1')).toBeNull()
  })

  it('recognizes audit tool names only', () => {
    expect(isAuditMcpToolName('audit_record_finding')).toBe(true)
    expect(isAuditMcpToolName('audit_record_verdict')).toBe(true)
    expect(isAuditMcpToolName('audit_set_profile')).toBe(true)
    expect(isAuditMcpToolName('write_file')).toBe(false)
    expect(isAuditMcpToolName(undefined)).toBe(false)
  })
})

describe('createAuditRuntime', () => {
  const ids = { uuid: () => 'u', now: () => 't' }
  it('routes a tool call for a registered run into the shared collector', async () => {
    const runtime = createAuditRuntime(ids)
    const context = {
      auditRunId: 'a1',
      runId: 'run-1',
      role: 'reviewer' as const,
      provider: 'claude' as const,
      dimension: 'code health'
    }
    runtime.registry.register('run-1', context)
    // The MCP dispatcher resolves the context via the registry, then executes.
    const resolved = runtime.registry.get('run-1')!
    const res = await runtime.toolExecutors.executeAuditMcpTool(
      'audit_record_finding',
      { claim: 'leak', severity: 'high', evidenceRefs: [{ path: 'x.ts', line: 1 }] },
      resolved
    )
    expect(res.isError).toBe(false)
    expect(runtime.collector.take('run-1').findings).toHaveLength(1)
  })
})
