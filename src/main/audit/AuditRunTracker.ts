/*
 * AuditRunTracker — bridges a dispatched audit role-run to a completion promise.
 *
 * RunCoordinator.dispatch resolves as soon as the provider CLI is spawned, NOT
 * when the run finishes. The app surfaces a run's terminal state through two
 * central pumps: the provider-output pump (the `result` event, which carries
 * token/cost stats) and the process-exit pump. This tracker mirrors
 * EnsembleOrchestrator's stash-a-resolver pattern (services/EnsembleOrchestrator
 * .ts:1941, :2254): dispatchRole's spawnAndAwait calls track(runId) to get a
 * promise, and index.ts feeds the same provider-output / exit events here (next
 * to the ensemble hooks) so the promise resolves with the run's outcome.
 *
 * The tracker also accumulates assistant content while the run is active. That
 * text is only consumed by the synthesis role as the final report; structured
 * findings/verdicts/profile still come through audit MCP tools.
 */
import type { AuditRoleRunOutcome } from './AuditOrchestratorWiring'

interface Inflight {
  resolve: (outcome: AuditRoleRunOutcome) => void
  settled: boolean
  startedAtMs: number
  finalText: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function pickNumber(
  stats: Record<string, unknown> | undefined,
  keys: string[]
): number | undefined {
  if (!stats) return undefined
  for (const key of keys) {
    const value = stats[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

/** Total tokens from a result-event stats blob: an explicit total, else
 * input+output, else undefined. Exported for unit tests. */
export function tokensFromStats(stats: Record<string, unknown> | undefined): number | undefined {
  const total = pickNumber(stats, ['total_tokens', 'totalTokens'])
  if (total !== undefined) return total
  const input = pickNumber(stats, ['input_tokens', 'inputTokens'])
  const output = pickNumber(stats, ['output_tokens', 'outputTokens'])
  if (input === undefined && output === undefined) return undefined
  return (input ?? 0) + (output ?? 0)
}

function eventText(event: Record<string, unknown>): string {
  const value =
    typeof event.text === 'string'
      ? event.text
      : typeof event.content === 'string'
        ? event.content
        : typeof event.output === 'string'
          ? event.output
          : ''
  return value
}

function mergeContent(existing: string, next: string, cumulative: boolean): string {
  if (!next) return existing
  if (cumulative) return next
  if (existing && next.startsWith(existing)) return next
  return existing + next
}

export interface AuditRunTrackerDeps {
  nowMs: () => number
}

export class AuditRunTracker {
  private readonly inflight = new Map<string, Inflight>()

  constructor(private readonly deps: AuditRunTrackerDeps) {}

  /** True while a run's completion promise is outstanding — index.ts uses this
   * to cheaply gate the per-event hook to audit runs only. */
  isTracked(runId: string | undefined): boolean {
    return Boolean(runId) && this.inflight.has(runId as string)
  }

  /** Start tracking; the returned promise resolves on the run's result/exit. */
  track(runId: string): Promise<AuditRoleRunOutcome> {
    return new Promise<AuditRoleRunOutcome>((resolve) => {
      this.inflight.set(runId, {
        resolve,
        settled: false,
        startedAtMs: this.deps.nowMs(),
        finalText: ''
      })
    })
  }

  /** Fed from the central provider-output pump. Settles on the terminal
   * `result` event, lifting token/cost/duration off its stats. */
  handleProviderOutput(runId: string | undefined, payload: unknown): void {
    if (!runId) return
    const run = this.inflight.get(runId)
    if (!run || run.settled) return
    const event = isRecord(payload) ? payload : {}
    if (event.type === 'content' || event.type === 'token') {
      run.finalText = mergeContent(run.finalText, eventText(event), event.cumulative === true)
      return
    }
    if (event.type !== 'result') return
    const stats = isRecord(event.stats) ? event.stats : undefined
    // Mirror EnsembleOrchestrator's terminal-failure detection.
    const failed = event.status === 'failed' || event.subtype === 'error'
    run.finalText = mergeContent(run.finalText, eventText(event), event.cumulative === true)
    this.settle(runId, run, {
      runId,
      ok: !failed,
      ...(failed ? { error: 'audit role-run reported a failed result' } : {}),
      ...(run.finalText.trim() ? { finalText: run.finalText.trim() } : {}),
      ...this.statsOutcome(stats, run)
    })
  }

  /** Fed from the process-exit pump. Resolves a run that ended WITHOUT a
   * `result` event (a crash/kill); a no-op once already settled by a result. */
  handleExit(runId: string | undefined, exitCode: number): void {
    if (!runId) return
    const run = this.inflight.get(runId)
    if (!run || run.settled) return
    this.settle(runId, run, {
      runId,
      ok: exitCode === 0,
      ...(exitCode === 0 ? {} : { error: `provider exited with code ${exitCode}` }),
      ...(run.finalText.trim() ? { finalText: run.finalText.trim() } : {}),
      durationMs: this.deps.nowMs() - run.startedAtMs
    })
  }

  private statsOutcome(
    stats: Record<string, unknown> | undefined,
    run: Inflight
  ): Partial<AuditRoleRunOutcome> {
    const tokens = tokensFromStats(stats)
    const costUsd = pickNumber(stats, ['cost_usd', 'total_cost_usd', 'costUsd', 'totalCostUsd'])
    const durationMs =
      pickNumber(stats, ['duration_ms', 'durationMs']) ?? this.deps.nowMs() - run.startedAtMs
    return {
      ...(tokens !== undefined ? { tokens } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
      ...(durationMs !== undefined ? { durationMs } : {})
    }
  }

  private settle(runId: string, run: Inflight, outcome: AuditRoleRunOutcome): void {
    run.settled = true
    this.inflight.delete(runId)
    run.resolve(outcome)
  }
}
