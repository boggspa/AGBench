/*
 * AuditOrchestratorWiring — the testable glue between the injected
 * AuditOrchestrator and the live app services. Everything here is pure or
 * close to it; the remaining app-only plumbing (RunCoordinator.dispatch,
 * runManager completion waits, registering the audit MCP tools on the bridge)
 * lives in index.ts and is verified by running the app.
 *
 * Three pieces:
 *   - buildProviderSignals: live auth/health/usage/ollama snapshots → the
 *     resolver's ProviderSignal[] (pure mapper).
 *   - buildAuditRolePayload: an AuditRoleRunRequest → an AgentRunPayload with
 *     the right read-only posture + auditRun identity (pure builder).
 *   - AuditArtifactCollector: buckets findings/verdicts/profile by runId so
 *     dispatchRole can drain exactly the artifacts a role-run produced.
 */

import {
  AUDIT_MCP_TOOL_NAMES,
  createAuditToolExecutors,
  type AuditMcpToolName,
  type AuditToolContext,
  type AuditToolDependencies,
  type AuditToolExecutors
} from '../mcp/AuditToolExecutors'
import type { AuditRoleRunRequest, AuditRoleRunResult } from './AuditOrchestrator'
import type { ProviderSignal, ProviderUsageBandValue } from './ProviderCapabilityResolver'
import type { AgentRunPayload } from '../run/AgentRunTypes'
import type {
  AuditFinding,
  AuditProjectProfile,
  AuditRole,
  AuditVerdict,
  ProviderId
} from '../store/types'

// ── provider signals ──────────────────────────────────────────────────────

export interface ProviderSignalInput {
  provider: ProviderId
  /** From buildProviderAuthStatusV2: structurally available + a usable transport. */
  configured: boolean
  /** authState === 'authenticated' (ollama: always true when reachable). */
  authenticated: boolean
  /** probe reachable (binary resolves / server pingable). */
  healthy: boolean
  /** worst usage band from summarizeProviderUsage, if known. */
  usageBand?: ProviderUsageBandValue
  isLocal?: boolean
}

/** Pure mapper: live provider snapshots → resolver signals. Kept separate from
 * the live gatherers so the mapping is unit-tested and the gatherers stay thin. */
export function buildProviderSignals(inputs: ProviderSignalInput[]): ProviderSignal[] {
  return inputs.map((input) => ({
    provider: input.provider,
    configured: input.configured,
    authenticated: input.authenticated,
    healthy: input.healthy,
    ...(input.usageBand ? { usageBand: input.usageBand } : {}),
    isLocal: input.isLocal ?? input.provider === 'ollama'
  }))
}

// ── role-run payload ──────────────────────────────────────────────────────

/** Roles that may only ever READ — reviewers and skeptics inspect the repo
 * and emit artifacts; they never mutate, shell, or delegate. recon + synthesis
 * are also read-only here (recon surveys, synthesis writes only its report via
 * the audit tool). So every audit role-run is read-only. */
function approvalModeForRole(_role: AuditRole): string {
  return 'plan'
}

export interface BuildAuditRolePayloadOptions {
  /** Global-scope audit (no workspace) vs workspace-scoped. */
  scope?: 'workspace' | 'global'
  model?: string
  runtimeProfileId?: string
}

/** Turn an AuditRoleRunRequest into an AgentRunPayload. The auditRun identity
 * rides along (so the MCP layer routes artifacts back), and every role runs in
 * plan / read-only mode — enforced here at dispatch, not by prompt. */
export function buildAuditRolePayload(
  req: AuditRoleRunRequest,
  appRunId: string,
  options: BuildAuditRolePayloadOptions = {}
): AgentRunPayload {
  const scope = options.scope ?? 'workspace'
  return {
    provider: req.provider,
    scope,
    ...(scope === 'workspace' ? { workspace: req.workspacePath } : {}),
    prompt: req.prompt,
    appRunId,
    approvalMode: approvalModeForRole(req.role),
    ...(options.model ? { model: options.model } : {}),
    ...(options.runtimeProfileId ? { runtimeProfileId: options.runtimeProfileId } : {}),
    auditRun: {
      auditRunId: req.auditRunId,
      role: req.role,
      ...(req.dimension ? { dimension: req.dimension } : {}),
      ...(req.findingId ? { findingId: req.findingId } : {})
    }
  }
}

// ── artifact collector ──────────────────────────────────────────────────────

interface RunBucket {
  findings: AuditFinding[]
  verdicts: AuditVerdict[]
  profile?: AuditProjectProfile
}

/** Buffers audit artifacts per provider-run id. The audit MCP tools write here
 * (via the AuditToolDependencies this exposes); dispatchRole drains the bucket
 * for its run once the run completes. Keyed by runId so concurrent reviewers
 * never cross-contaminate each other's findings. */
export class AuditArtifactCollector {
  private readonly buckets = new Map<string, RunBucket>()

  private bucket(runId: string): RunBucket {
    let bucket = this.buckets.get(runId)
    if (!bucket) {
      bucket = { findings: [], verdicts: [] }
      this.buckets.set(runId, bucket)
    }
    return bucket
  }

  /** The dependency object passed to createAuditToolExecutors — every record
   * buckets by the calling run's id. uuid/now are injected (the orchestrator
   * supplies them) so artifact ids/timestamps stay deterministic under test. */
  toolDependencies(ids: { uuid: () => string; now: () => string }): AuditToolDependencies {
    return {
      recordFinding: (context: AuditToolContext, finding: AuditFinding) => {
        this.bucket(context.runId).findings.push(finding)
      },
      recordVerdict: (context: AuditToolContext, verdict: AuditVerdict) => {
        this.bucket(context.runId).verdicts.push(verdict)
      },
      setProfile: (context: AuditToolContext, profile: AuditProjectProfile) => {
        this.bucket(context.runId).profile = profile
      },
      uuid: ids.uuid,
      now: ids.now
    }
  }

  /** Remove and return everything a run recorded. */
  take(runId: string): RunBucket {
    const bucket = this.buckets.get(runId) ?? { findings: [], verdicts: [] }
    this.buckets.delete(runId)
    return bucket
  }

  /** Drop a run's buffer without reading it (e.g. the run failed). */
  discard(runId: string): void {
    this.buckets.delete(runId)
  }
}

// ── audit-run registry + runtime ─────────────────────────────────────────────

/** Maps a live provider run id → the audit tool context for that role-run, so
 * the MCP dispatcher can route an `audit_*` tool call to the right run's
 * collector. The orchestrator registers before dispatch and unregisters when
 * the run ends. A tool call whose runId isn't registered is NOT an audit run
 * (the dispatcher refuses it). */
export class AuditRunRegistry {
  private readonly byRunId = new Map<string, AuditToolContext>()

  register(appRunId: string, context: AuditToolContext): void {
    this.byRunId.set(appRunId, context)
  }

  get(appRunId: string | undefined): AuditToolContext | null {
    if (!appRunId) return null
    return this.byRunId.get(appRunId) ?? null
  }

  unregister(appRunId: string): void {
    this.byRunId.delete(appRunId)
  }
}

export function isAuditMcpToolName(name: unknown): name is AuditMcpToolName {
  return typeof name === 'string' && (AUDIT_MCP_TOOL_NAMES as readonly string[]).includes(name)
}

export interface AuditRuntime {
  registry: AuditRunRegistry
  collector: AuditArtifactCollector
  toolExecutors: AuditToolExecutors
}

/** The shared per-app audit runtime: one collector (buckets artifacts by
 * runId), one registry (runId → context), and the MCP tool executors wired to
 * the collector. index.ts instantiates this once; the MCP dispatcher and the
 * orchestrator both use it. */
export function createAuditRuntime(ids: { uuid: () => string; now: () => string }): AuditRuntime {
  const collector = new AuditArtifactCollector()
  const registry = new AuditRunRegistry()
  const toolExecutors = createAuditToolExecutors(collector.toolDependencies(ids))
  return { registry, collector, toolExecutors }
}

// ── role dispatcher (the dispatchRole glue) ──────────────────────────────────

/** What the app primitive returns once a spawned role-run has COMPLETED. The
 * only app-specific part of dispatchRole is producing this — spawn the run from
 * the payload, wait for it to finish, and report its run id + token/cost/time +
 * (for synthesis) the final assistant text. Everything else in the dispatcher
 * is pure glue, so it is unit-tested with a fake. */
export interface AuditRoleRunOutcome {
  runId: string
  ok: boolean
  error?: string
  tokens?: number
  costUsd?: number
  durationMs?: number
  /** The final assistant text — becomes the report for the synthesis role. */
  finalText?: string
}

export interface AuditRoleDispatcherDeps {
  runtime: AuditRuntime
  /** Spawn the role-run from its payload and resolve when it COMPLETES. This is
   * the sole RunCoordinator/runManager touch-point; index.ts implements it. The
   * run MUST execute under `payload.appRunId` so its audit MCP tool calls route
   * back to the context registered under that id. */
  spawnAndAwait: (payload: AgentRunPayload) => Promise<AuditRoleRunOutcome>
  /** Pre-allocates each role-run's app run id (registered BEFORE spawn so a tool
   * call can never arrive before its context exists). */
  uuid: () => string
  buildPayload?: (
    req: AuditRoleRunRequest,
    appRunId: string,
    options?: BuildAuditRolePayloadOptions
  ) => AgentRunPayload
  payloadOptions?: BuildAuditRolePayloadOptions
}

/** Build the orchestrator's `dispatchRole` dependency. The sequence — register
 * the audit tool context, build the read-only payload, spawn+await, drain
 * exactly this run's buffered artifacts, then ALWAYS unregister — is the part
 * that must be correct regardless of provider, so it lives here (pure, tested)
 * rather than buried in index.ts. The collector buckets by the pre-allocated
 * appRunId, so concurrent reviewers never cross-contaminate. */
export function createAuditRoleDispatcher(
  deps: AuditRoleDispatcherDeps
): (req: AuditRoleRunRequest) => Promise<AuditRoleRunResult> {
  const build = deps.buildPayload ?? buildAuditRolePayload
  return async (req: AuditRoleRunRequest): Promise<AuditRoleRunResult> => {
    const appRunId = deps.uuid()
    const context: AuditToolContext = {
      auditRunId: req.auditRunId,
      runId: appRunId,
      role: req.role,
      provider: req.provider,
      ...(req.dimension ? { dimension: req.dimension } : {})
    }
    deps.runtime.registry.register(appRunId, context)
    const payload = build(req, appRunId, deps.payloadOptions)
    try {
      const outcome = await deps.spawnAndAwait(payload)
      const bucket = deps.runtime.collector.take(appRunId)
      const base = {
        runId: outcome.runId || appRunId,
        ...(outcome.tokens !== undefined ? { tokens: outcome.tokens } : {}),
        ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
        ...(outcome.durationMs !== undefined ? { durationMs: outcome.durationMs } : {})
      }
      if (!outcome.ok) {
        return { ok: false, error: outcome.error, ...base }
      }
      return {
        ok: true,
        ...base,
        ...(bucket.profile ? { profile: bucket.profile } : {}),
        ...(bucket.findings.length ? { findings: bucket.findings } : {}),
        ...(bucket.verdicts.length ? { verdicts: bucket.verdicts } : {}),
        ...(outcome.finalText ? { report: outcome.finalText } : {})
      }
    } catch (err) {
      // The run never produced usable artifacts — drop its buffer so a later
      // run reusing the (recycled) id can't read stale findings.
      deps.runtime.collector.discard(appRunId)
      return { ok: false, runId: appRunId, error: err instanceof Error ? err.message : String(err) }
    } finally {
      deps.runtime.registry.unregister(appRunId)
    }
  }
}
