import type { ProviderId } from '../store/types'
import type { ProviderAdapter } from '../ProviderAdapters'
import type { AgentRunPayload, AgentRunRoute } from '../index'

/**
 * RunCoordinator — Phase B1 extraction.
 *
 * First piece of the long-pole Phase B refactor: pulls the
 * run-dispatch chokepoint out of `src/main/index.ts`'s 9.7k-line
 * whenReady closure into a testable service with explicit
 * dependencies. Behaviour is byte-identical to the previous inline
 * `dispatchAgentRun`; the win is:
 *   - Testable in isolation (unit tests now mock the five
 *     dependencies instead of needing a full Electron + renderer
 *     bootstrap).
 *   - One place to evolve (cancellation, queueing, multi-provider
 *     orchestration — all hooks attach here).
 *   - The "renderer composes a turn, main dispatches it" boundary
 *     becomes visible — future Phase B slices (composer/run-
 *     construction migration from App.tsx) all funnel through
 *     this coordinator.
 *
 * The `provider adapter registry` it depends on is the existing
 * `createProviderAdapterRegistry` instance — we don't re-create
 * the adapters here, we just delegate `.run()` through them.
 *
 * Failure model: matches the original inline helper. Adapter errors
 * are reported via `sendAgentCompatError` + `sendAgentCompatExit`
 * to the sender; the function returns `{ dispatched: false }` and
 * never throws.
 */

export interface RunCoordinatorDeps {
  /** Normalize raw / partial payloads to the canonical AgentRunPayload
   * shape. Currently in index.ts as `normalizeAgentRunPayload`. */
  normalizePayload: (raw: unknown) => AgentRunPayload
  /** Assign / preserve an appRunId for the run. Currently
   * `routeWithRunId`. */
  routeWithRunId: (provider: ProviderId, route?: AgentRunRoute | null) => AgentRunRoute
  /** Apply runtime profile overrides (binary path, env, MCP profile,
   * approval mode, etc.) to the payload in-place. Throws on bad
   * profile id. Currently `applyRuntimeProfileToPayload`. */
  applyRuntimeProfileToPayload: (payload: AgentRunPayload) => AgentRunPayload
  /** Preflight: workspace allowlist, agentic-service grants,
   * scheduled-task attachment, trust check. Returns false to abort
   * the dispatch (the function has already surfaced the error to the
   * sender). Currently `ensureProviderRunPreflight`. */
  ensureProviderRunPreflight: (
    sender: Electron.WebContents,
    payload: AgentRunPayload
  ) => Promise<boolean>
  /** Adapter lookup. Throws when the provider isn't registered.
   * Currently `providerAdapters.require`. */
  getAdapter: (provider: ProviderId) => ProviderAdapter
  /** Report a per-run error to the originating sender. Currently
   * `sendAgentCompatError`. */
  sendError: (
    sender: Electron.WebContents,
    provider: ProviderId,
    message: string,
    route: AgentRunRoute
  ) => void
  /** Report a per-run exit (process termination, dispatch abort,
   * etc.) to the sender. Currently `sendAgentCompatExit`. */
  sendExit: (
    sender: Electron.WebContents,
    provider: ProviderId,
    exitCode: number,
    route: AgentRunRoute
  ) => void
}

export interface DispatchResult {
  /** True when the adapter's run() was invoked. False on preflight
   * or runtime-profile failures. */
  dispatched: boolean
  /** The resolved appRunId. Empty string when normalization didn't
   * produce one (edge case — payload didn't carry an appChatId). */
  appRunId: string
}

export class RunCoordinator {
  constructor(private deps: RunCoordinatorDeps) {}

  /** Dispatch a run on behalf of either the renderer (via the
   * `run-agent` IPC handler) or the bridge action executor (iOS-
   * initiated run). Behaviour is identical for both callers — the
   * difference is purely in how the `sender` was constructed.
   *
   * Never throws. Returns `{ dispatched: false }` on any preflight /
   * runtime-profile / adapter-resolution failure; in those cases the
   * sender has already received the corresponding compat-line
   * error / exit. */
  async dispatch(
    payload: AgentRunPayload,
    event: Electron.IpcMainInvokeEvent
  ): Promise<DispatchResult> {
    const normalizedPayload = this.deps.normalizePayload(payload)
    normalizedPayload.appRunId = this.deps.routeWithRunId(
      normalizedPayload.provider,
      normalizedPayload
    ).appRunId
    try {
      this.deps.applyRuntimeProfileToPayload(normalizedPayload)
    } catch (error) {
      const route = this.deps.routeWithRunId(normalizedPayload.provider, normalizedPayload)
      const message = error instanceof Error ? error.message : String(error)
      this.deps.sendError(event.sender, normalizedPayload.provider, message, route)
      this.deps.sendExit(event.sender, normalizedPayload.provider, -1, route)
      return { dispatched: false, appRunId: normalizedPayload.appRunId ?? '' }
    }
    const adapter = this.deps.getAdapter(normalizedPayload.provider)
    if (!(await this.deps.ensureProviderRunPreflight(event.sender, normalizedPayload))) {
      return { dispatched: false, appRunId: normalizedPayload.appRunId ?? '' }
    }
    await adapter.run({ event, payload: normalizedPayload })
    return { dispatched: true, appRunId: normalizedPayload.appRunId ?? '' }
  }
}
