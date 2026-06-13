import { describe, expect, it } from 'vitest'
import {
  AUDIT_MCP_TOOL_NAMES,
  auditToolDefinitions,
  coerceEvidenceRefs,
  coerceFinding,
  createAuditToolExecutors,
  deriveDedupKey,
  resolveFindingVerdictState,
  type AuditToolContext,
  type AuditToolDependencies
} from './AuditToolExecutors'
import type { AuditFinding, AuditProjectProfile, AuditVerdict } from '../store/types'

let counter = 0
const ids = {
  uuid: () => `id-${++counter}`,
  now: () => '2026-06-13T00:00:00.000Z'
}

function reviewerCtx(over: Partial<AuditToolContext> = {}): AuditToolContext {
  return {
    auditRunId: 'run-1',
    runId: 'rr-1',
    role: 'reviewer',
    provider: 'claude',
    dimension: 'code health',
    ...over
  }
}

describe('coercion helpers', () => {
  it('coerceEvidenceRefs keeps valid anchors, drops pathless entries', () => {
    expect(
      coerceEvidenceRefs([
        { path: 'src/a.ts', line: 12, note: 'here' },
        { line: 3 },
        { path: '  ' },
        { path: 'src/b.ts' }
      ])
    ).toEqual([
      { path: 'src/a.ts', line: 12, note: 'here' },
      { path: 'src/b.ts' }
    ])
  })

  it('deriveDedupKey collapses claim wording + anchors on first evidence', () => {
    const a = deriveDedupKey('The **God Module** is huge!', [{ path: 'src/x.ts', line: 5 }])
    const b = deriveDedupKey('the god module is huge', [{ path: 'src/x.ts', line: 5 }])
    expect(a).toBe(b)
    expect(a.startsWith('src/x.ts:5|')).toBe(true)
  })

  it('coerceFinding defaults severity/confidence/dimension + stamps provenance', () => {
    const f = coerceFinding(
      { claim: 'leak', evidenceRefs: [{ path: 'src/x.ts', line: 1 }] },
      reviewerCtx(),
      ids
    )!
    expect(f.severity).toBe('medium')
    expect(f.confidence).toBe(0.5)
    expect(f.dimension).toBe('code health')
    expect(f.authorProvider).toBe('claude')
    expect(f.verdictState).toBe('pending')
  })

  it('coerceFinding returns null without a claim', () => {
    expect(coerceFinding({ evidenceRefs: [{ path: 'x' }] }, reviewerCtx(), ids)).toBeNull()
  })
})

describe('resolveFindingVerdictState — evidence-anchor rule', () => {
  const v = (over: Partial<AuditVerdict>): Pick<AuditVerdict, 'decision' | 'counterEvidence'> => ({
    decision: 'accept',
    ...over
  })

  it('no verdicts → pending', () => {
    expect(resolveFindingVerdictState([])).toBe('pending')
  })

  it('refute WITH counter-evidence → refuted', () => {
    expect(
      resolveFindingVerdictState([v({ decision: 'refute', counterEvidence: [{ path: 'x', line: 2 }] })])
    ).toBe('refuted')
  })

  it('refute WITHOUT counter-evidence → unverified, never refuted', () => {
    expect(resolveFindingVerdictState([v({ decision: 'refute' })])).toBe('unverified')
  })

  it('an unsupported refute downgrades even when another skeptic accepts', () => {
    expect(
      resolveFindingVerdictState([v({ decision: 'accept' }), v({ decision: 'refute' })])
    ).toBe('unverified')
  })

  it('an evidence-anchored refute beats an accept (kill wins)', () => {
    expect(
      resolveFindingVerdictState([
        v({ decision: 'accept' }),
        v({ decision: 'refute', counterEvidence: [{ path: 'x' }] })
      ])
    ).toBe('refuted')
  })

  it('only accepts → confirmed', () => {
    expect(resolveFindingVerdictState([v({ decision: 'accept' }), v({ decision: 'accept' })])).toBe(
      'confirmed'
    )
  })
})

describe('createAuditToolExecutors', () => {
  function makeDeps() {
    const findings: AuditFinding[] = []
    const verdicts: AuditVerdict[] = []
    const profiles: AuditProjectProfile[] = []
    const deps: AuditToolDependencies = {
      recordFinding: (_ctx, f) => void findings.push(f),
      recordVerdict: (_ctx, v) => void verdicts.push(v),
      setProfile: (_ctx, p) => void profiles.push(p),
      uuid: () => `id-${++counter}`,
      now: () => '2026-06-13T00:00:00.000Z'
    }
    return { deps, findings, verdicts, profiles }
  }

  it('exposes exactly the three tool definitions', () => {
    const names = auditToolDefinitions().map((d) => d.name)
    expect(names).toEqual([...AUDIT_MCP_TOOL_NAMES])
  })

  it('records a finding from a reviewer', async () => {
    const { deps, findings } = makeDeps()
    const ex = createAuditToolExecutors(deps)
    const res = await ex.executeAuditMcpTool(
      'audit_record_finding',
      { claim: 'leak', severity: 'high', evidenceRefs: [{ path: 'src/x.ts', line: 1 }] },
      reviewerCtx()
    )
    expect(res.isError).toBe(false)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('high')
  })

  it('rejects a finding with no evidence', async () => {
    const { deps, findings } = makeDeps()
    const ex = createAuditToolExecutors(deps)
    const res = await ex.executeAuditMcpTool(
      'audit_record_finding',
      { claim: 'vibes', severity: 'low', evidenceRefs: [] },
      reviewerCtx()
    )
    expect(res.isError).toBe(true)
    expect(findings).toHaveLength(0)
  })

  it('enforces role scope: a reviewer cannot record a verdict', async () => {
    const { deps, verdicts } = makeDeps()
    const ex = createAuditToolExecutors(deps)
    const res = await ex.executeAuditMcpTool(
      'audit_record_verdict',
      { findingId: 'f1', decision: 'refute' },
      reviewerCtx()
    )
    expect(res.isError).toBe(true)
    expect(verdicts).toHaveLength(0)
  })

  it('records a verdict from a skeptic and a profile from recon', async () => {
    const { deps, verdicts, profiles } = makeDeps()
    const ex = createAuditToolExecutors(deps)
    const verdictRes = await ex.executeAuditMcpTool(
      'audit_record_verdict',
      { findingId: 'f1', decision: 'refute', counterEvidence: [{ path: 'x', line: 2 }] },
      { auditRunId: 'run-1', runId: 'rr-2', role: 'skeptic', provider: 'codex' }
    )
    expect(verdictRes.isError).toBe(false)
    expect(verdicts[0].skepticProvider).toBe('codex')

    const profileRes = await ex.executeAuditMcpTool(
      'audit_set_profile',
      { stack: ['electron', 'react'], riskZones: ['god modules'], junk: 1 },
      { auditRunId: 'run-1', runId: 'rr-3', role: 'recon', provider: 'claude' }
    )
    expect(profileRes.isError).toBe(false)
    expect(profiles[0].stack).toEqual(['electron', 'react'])
    expect((profiles[0] as Record<string, unknown>).junk).toBeUndefined()
  })
})
