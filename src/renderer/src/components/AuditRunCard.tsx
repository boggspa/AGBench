import type { AuditGateResult, AuditParticipant, AuditRunRecord } from '../../../main/store/types'

interface AuditRunCardProps {
  run: AuditRunRecord
  onCancel?: (auditRunId: string) => void
}

function isActiveStatus(status: AuditRunRecord['status']): boolean {
  return status === 'planning' || status === 'awaitingConfirm' || status === 'running'
}

function titleCase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function phaseLabel(run: AuditRunRecord): string {
  const running = run.phases.find((phase) => phase.status === 'running')
  if (running) return titleCase(running.id)
  const failed = run.phases.find((phase) => phase.status === 'failed')
  if (failed) return `${titleCase(failed.id)} failed`
  const completed = run.phases.filter((phase) => phase.status === 'completed').length
  return `${completed}/${run.phases.length} phases`
}

function gateSummary(gates: AuditGateResult[]): string {
  if (!gates.length) return '0 gates'
  const pass = gates.filter((gate) => gate.status === 'pass').length
  const fail = gates.filter((gate) => gate.status === 'fail').length
  const skipped = gates.filter((gate) => gate.status === 'skipped').length
  const parts = [`${pass} pass`]
  if (fail) parts.push(`${fail} fail`)
  if (skipped) parts.push(`${skipped} skipped`)
  return parts.join(' / ')
}

function participantSummary(participants: AuditParticipant[]): string {
  if (!participants.length) return '0 agents'
  const running = participants.filter((participant) => participant.status === 'running').length
  const completed = participants.filter((participant) => participant.status === 'completed').length
  const failed = participants.filter((participant) => participant.status === 'failed').length
  const parts = [`${completed} done`]
  if (running) parts.push(`${running} running`)
  if (failed) parts.push(`${failed} failed`)
  return parts.join(' / ')
}

function budgetSummary(run: AuditRunRecord): string {
  const agents = `${run.budget.spentAgents}/${run.budget.maxAgents} agents`
  const tokens = run.budget.maxTokens
    ? `${run.budget.spentTokens}/${run.budget.maxTokens} tokens`
    : `${run.budget.spentTokens} tokens`
  return run.budget.truncated ? `${agents} / ${tokens} / truncated` : `${agents} / ${tokens}`
}

export function AuditRunCard({ run, onCancel }: AuditRunCardProps) {
  const active = isActiveStatus(run.status)
  const completedPhases = run.phases.filter((phase) => phase.status === 'completed').length
  const totalPhases = run.phases.length
  const rosterProviders = Array.from(
    new Set(
      Object.values(run.roster?.perRole ?? {})
        .flat()
        .filter(Boolean)
    )
  )

  return (
    <section className={`audit-run-card status-${run.status}`} aria-label="Audit run status">
      <div className="audit-run-card-main">
        <header className="audit-run-card-header">
          <div>
            <span className="audit-run-kicker">TaskWraith Audit</span>
            <h2>{titleCase(run.mode)} audit</h2>
          </div>
          <span className={`audit-run-status status-${run.status}`}>{titleCase(run.status)}</span>
        </header>
        <div
          className="audit-run-progress"
          aria-label={`${completedPhases} of ${totalPhases} phases complete`}
        >
          <span
            style={{
              width: `${totalPhases > 0 ? Math.round((completedPhases / totalPhases) * 100) : 0}%`
            }}
          />
        </div>
        <div className="audit-run-meta">
          <span>{phaseLabel(run)}</span>
          <span>{run.findings.length} findings</span>
          <span>{run.verdicts.length} verdicts</span>
          <span>{gateSummary(run.gates)}</span>
          <span>{participantSummary(run.participants)}</span>
          <span>{budgetSummary(run)}</span>
          {rosterProviders.length > 0 && <span>{rosterProviders.join(' / ')}</span>}
        </div>
        {run.error && <div className="audit-run-error">{run.error}</div>}
        {run.coverage?.notes?.length ? (
          <div className="audit-run-coverage">{run.coverage.notes.slice(0, 2).join(' ')}</div>
        ) : null}
      </div>
      {active && onCancel && (
        <button
          type="button"
          className="audit-run-cancel"
          onClick={() => onCancel(run.id)}
          title="Cancel this audit run"
        >
          Cancel
        </button>
      )}
    </section>
  )
}
