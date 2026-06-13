import type { AuditRunRecord, ChatMessage } from '../store/types'

export type AuditTranscriptMessageKind = 'started' | 'completed' | 'failed' | 'cancelled'

export function auditTranscriptMessageKind(run: AuditRunRecord): AuditTranscriptMessageKind | null {
  if (run.status === 'planning' || run.status === 'awaitingConfirm' || run.status === 'running') {
    return 'started'
  }
  if (run.status === 'completed') return 'completed'
  if (run.status === 'failed') return 'failed'
  if (run.status === 'cancelled') return 'cancelled'
  return null
}

function modeLabel(run: AuditRunRecord): string {
  return run.mode.charAt(0).toUpperCase() + run.mode.slice(1)
}

export function createAuditTranscriptMessage(
  run: AuditRunRecord,
  kind: AuditTranscriptMessageKind,
  timestamp: string
): ChatMessage {
  const label = modeLabel(run)
  const content =
    kind === 'started'
      ? `TaskWraith ${label} audit started.\n\nV1 note: audit role-runs are internal background runs; provider transcripts are not created as child chats yet. The final outcome will be posted back into this parent transcript.`
      : kind === 'completed'
        ? `TaskWraith ${label} audit completed.\n\n${run.report || 'No report was produced.'}`
        : kind === 'cancelled'
          ? `TaskWraith ${label} audit cancelled.`
          : `TaskWraith ${label} audit failed.\n\n${run.error || 'No error details were recorded.'}`

  return {
    id: `audit-${run.id}-${kind}-${timestamp}`,
    role: kind === 'failed' ? 'error' : 'system',
    content,
    timestamp,
    metadata: {
      kind: 'auditRunStatus',
      auditRunId: run.id,
      auditStatus: run.status,
      auditMessageKind: kind,
      auditMode: run.mode
    }
  }
}
