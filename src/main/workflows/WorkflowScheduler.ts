import type {
  WorkflowExecutionStatus,
  WorkflowTrigger,
  WorkflowTriggerKind
} from '../store/types'

export const MIN_WORKFLOW_INTERVAL_MS = 60_000

export function isWorkflowTriggerKind(value: unknown): value is WorkflowTriggerKind {
  return value === 'manual' || value === 'once' || value === 'interval' || value === 'cron'
}

export function isTerminalWorkflowExecutionStatus(status: WorkflowExecutionStatus): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'skipped'
  )
}

export function normalizeWorkflowTrigger(value: unknown, nowMs: number): WorkflowTrigger {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const kind = isWorkflowTriggerKind(input.kind) ? input.kind : 'manual'
  if (kind === 'once') {
    return {
      kind,
      runAt: typeof input.runAt === 'string' && input.runAt ? input.runAt : new Date(nowMs).toISOString(),
      timezone: typeof input.timezone === 'string' ? input.timezone : undefined
    }
  }
  if (kind === 'interval') {
    const rawInterval =
      typeof input.intervalMs === 'number' && Number.isFinite(input.intervalMs)
        ? input.intervalMs
        : MIN_WORKFLOW_INTERVAL_MS
    return {
      kind,
      intervalMs: Math.max(MIN_WORKFLOW_INTERVAL_MS, Math.floor(rawInterval)),
      startAt:
        typeof input.startAt === 'string' && input.startAt
          ? input.startAt
          : new Date(nowMs).toISOString(),
      timezone: typeof input.timezone === 'string' ? input.timezone : undefined
    }
  }
  if (kind === 'cron') {
    return {
      kind,
      cronExpression: typeof input.cronExpression === 'string' ? input.cronExpression.trim() : '',
      timezone: typeof input.timezone === 'string' ? input.timezone : undefined
    }
  }
  return { kind: 'manual' }
}

export function resolveNextWorkflowRunAt(
  trigger: WorkflowTrigger,
  afterMs: number,
  nowMs: number = afterMs
): string | undefined {
  if (trigger.kind === 'manual') return undefined
  if (trigger.kind === 'cron') return undefined
  if (trigger.kind === 'once') {
    const runAtMs = trigger.runAt ? Date.parse(trigger.runAt) : Number.NaN
    if (!Number.isFinite(runAtMs)) return undefined
    return runAtMs >= nowMs ? new Date(runAtMs).toISOString() : undefined
  }
  const intervalMs =
    typeof trigger.intervalMs === 'number' && Number.isFinite(trigger.intervalMs)
      ? Math.max(MIN_WORKFLOW_INTERVAL_MS, Math.floor(trigger.intervalMs))
      : MIN_WORKFLOW_INTERVAL_MS
  const anchorMs =
    trigger.startAt && Number.isFinite(Date.parse(trigger.startAt))
      ? Date.parse(trigger.startAt)
      : nowMs
  const floorMs = Math.max(afterMs, nowMs)
  if (anchorMs > floorMs) return new Date(anchorMs).toISOString()
  const elapsed = floorMs - anchorMs
  const steps = Math.floor(elapsed / intervalMs) + 1
  return new Date(anchorMs + steps * intervalMs).toISOString()
}

export function nextLocalDayBoundaryIso(nowMs: number): string {
  const next = new Date(nowMs)
  next.setHours(24, 0, 0, 0)
  return next.toISOString()
}
