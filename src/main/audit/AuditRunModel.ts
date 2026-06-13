/*
 * AuditRunModel — pure decision logic the orchestrator consumes.
 *
 * Keeping dedup, verdict application, survivor selection, coverage, and budget
 * accounting as pure functions means the stateful orchestrator (Slice 4)
 * stays thin and every interesting rule is unit-tested without spawns. See
 * the plan: the dedup barrier, evidence-anchored survival, honest coverage,
 * and the hard budget ceiling all live here.
 */

import { resolveFindingVerdictState } from '../mcp/AuditToolExecutors'
import type {
  AuditBudget,
  AuditCoverage,
  AuditFinding,
  AuditFindingSeverity,
  AuditVerdict
} from '../store/types'

const SEVERITY_RANK: Record<AuditFindingSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
}

/** Merge findings sharing a dedupKey into one canonical finding (the dedup
 * barrier). The same issue surfaced under three dimensions becomes one — no
 * triplicate report rows, no 3× skeptic cost. Canonical = first seen (stable
 * id); severity/confidence take the max, evidence unions, mergedFrom records
 * the absorbed ids, dimension lists the contributors. */
export function dedupeFindings(findings: AuditFinding[]): AuditFinding[] {
  const byKey = new Map<string, AuditFinding>()
  const order: string[] = []
  for (const finding of findings) {
    const existing = byKey.get(finding.dedupKey)
    if (!existing) {
      byKey.set(finding.dedupKey, { ...finding, mergedFrom: finding.mergedFrom ?? [] })
      order.push(finding.dedupKey)
      continue
    }
    const evidenceSeen = new Set(existing.evidenceRefs.map((e) => `${e.path}:${e.line ?? 0}`))
    const mergedEvidence = [...existing.evidenceRefs]
    for (const ref of finding.evidenceRefs) {
      const key = `${ref.path}:${ref.line ?? 0}`
      if (!evidenceSeen.has(key)) {
        evidenceSeen.add(key)
        mergedEvidence.push(ref)
      }
    }
    const dimensions = new Set(existing.dimension.split(', ').filter(Boolean))
    dimensions.add(finding.dimension)
    byKey.set(existing.dedupKey, {
      ...existing,
      severity:
        SEVERITY_RANK[finding.severity] > SEVERITY_RANK[existing.severity]
          ? finding.severity
          : existing.severity,
      confidence: Math.max(existing.confidence, finding.confidence),
      evidenceRefs: mergedEvidence,
      dimension: Array.from(dimensions).join(', '),
      mergedFrom: [...(existing.mergedFrom ?? []), finding.id]
    })
  }
  return order.map((key) => byKey.get(key)!)
}

/** Stamp each finding's verdictState from its verdicts (evidence-anchor rule).
 * Returns new finding objects; input is not mutated. */
export function applyVerdictStates(
  findings: AuditFinding[],
  verdicts: AuditVerdict[]
): AuditFinding[] {
  const byFinding = new Map<string, AuditVerdict[]>()
  for (const verdict of verdicts) {
    const list = byFinding.get(verdict.findingId) ?? []
    list.push(verdict)
    byFinding.set(verdict.findingId, list)
  }
  return findings.map((finding) => ({
    ...finding,
    verdictState: resolveFindingVerdictState(byFinding.get(finding.id) ?? [])
  }))
}

/** Findings that belong in the report: everything except evidence-anchored
 * refutations. Unverified findings SURVIVE (kept + flagged) — never silently
 * dropped. */
export function survivingFindings(findings: AuditFinding[]): AuditFinding[] {
  return findings.filter((finding) => finding.verdictState !== 'refuted')
}

/** A finding needs adversarial skeptics; high/critical get two. */
export function skepticCountForSeverity(severity: AuditFindingSeverity): number {
  return severity === 'high' || severity === 'critical' ? 2 : 1
}

// ── budget ──────────────────────────────────────────────────────────────────

export function makeBudget(maxAgents: number, maxTokens?: number): AuditBudget {
  return {
    maxAgents: Math.max(1, Math.trunc(maxAgents)),
    ...(maxTokens && maxTokens > 0 ? { maxTokens } : {}),
    spentAgents: 0,
    spentTokens: 0,
    truncated: false
  }
}

/** True when spawning one more agent would breach a ceiling. */
export function budgetExhausted(budget: AuditBudget): boolean {
  if (budget.spentAgents >= budget.maxAgents) return true
  if (budget.maxTokens !== undefined && budget.spentTokens >= budget.maxTokens) return true
  return false
}

/** Record a spawned agent + its token spend, returning a NEW budget. */
export function recordSpend(
  budget: AuditBudget,
  spend: { agents?: number; tokens?: number }
): AuditBudget {
  return {
    ...budget,
    spentAgents: budget.spentAgents + (spend.agents ?? 0),
    spentTokens: budget.spentTokens + (spend.tokens ?? 0)
  }
}

export function markTruncated(budget: AuditBudget): AuditBudget {
  return budget.truncated ? budget : { ...budget, truncated: true }
}

// ── coverage ──────────────────────────────────────────────────────────────

/** Honest reporting of how thorough the run actually was. A finding is
 * "cross-provider verified" when ≥2 DISTINCT skeptic providers judged it. */
export function computeCoverage(input: {
  dimensionsPlanned: number
  dimensionsCompleted: number
  findings: AuditFinding[]
  verdicts: AuditVerdict[]
  substitutions: number
  budgetTruncated: boolean
}): AuditCoverage {
  const providersByFinding = new Map<string, Set<string>>()
  for (const verdict of input.verdicts) {
    const set = providersByFinding.get(verdict.findingId) ?? new Set<string>()
    set.add(verdict.skepticProvider)
    providersByFinding.set(verdict.findingId, set)
  }
  let crossProvider = 0
  let singleProvider = 0
  for (const finding of input.findings) {
    const providers = providersByFinding.get(finding.id)
    if (!providers || providers.size === 0) continue
    if (providers.size >= 2) crossProvider += 1
    else singleProvider += 1
  }
  const notes: string[] = []
  if (input.dimensionsCompleted < input.dimensionsPlanned) {
    notes.push(
      `Only ${input.dimensionsCompleted}/${input.dimensionsPlanned} dimensions completed; coverage is partial.`
    )
  }
  if (singleProvider > 0 && crossProvider === 0) {
    notes.push('Verification was single-provider — cross-provider decorrelation was unavailable.')
  }
  if (input.substitutions > 0) {
    notes.push(`${input.substitutions} provider substitution(s) occurred mid-run.`)
  }
  if (input.budgetTruncated) {
    notes.push('Budget ceiling reached — verification was truncated; some findings are unverified.')
  }
  return {
    dimensionsPlanned: input.dimensionsPlanned,
    dimensionsCompleted: input.dimensionsCompleted,
    crossProviderVerifiedCount: crossProvider,
    singleProviderVerifiedCount: singleProvider,
    substitutions: input.substitutions,
    ...(notes.length > 0 ? { notes } : {})
  }
}
