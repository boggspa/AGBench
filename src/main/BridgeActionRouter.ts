import type { RemoteWorkspaceAllowlist } from './RemoteWorkspaceAllowlist'
import {
  BridgeActionPayloadDecodeError,
  decodeBridgeActionPayload,
  payloadIsMutating,
  payloadRequiresWorkspaceGating,
  workspaceIdFromPayload,
  type BridgeActionPayload
} from './BridgeActionPayload'
import {
  NoopActionExecutor,
  type BridgeActionExecutionResult,
  type BridgeActionExecutor
} from './BridgeActionExecutor'

/**
 * BridgeActionRouter — Electron-side handler for daemon→Electron requests.
 *
 * Phase C3.6 introduced the round-trip contract. Phase C4 wires the
 * `RemoteWorkspaceAllowlist` into the prepare-start-turn path: an iOS
 * device that names a workspace must have that workspace explicitly
 * allowlisted by the desktop user, or its request is denied with a
 * structured reason. This is per-action revalidation — the allowlist is
 * consulted on every iOS request, not just at session open, so a
 * desktop-side allowlist change takes effect on the next iOS action with
 * no daemon restart.
 *
 * Known methods:
 *   - `bridge.requestActionAck`         → opaque iOS-side action; expects
 *                                          `{accepted, scope?, message?}`
 *   - `bridge.requestPrepareStartTurnAck`→ iOS wants to start a turn against
 *                                          a workspace/thread; expects
 *                                          `{accepted, message?}`
 *
 * Default policy (Phase C4 v1):
 *   - **`requestPrepareStartTurnAck`**: deny unless the allowlist holds an
 *     entry for the requested workspace AND (if provided) the provider /
 *     approval-mode are in its allowed set AND the entry has not expired.
 *   - **`requestActionAck`**: still deny-by-default. Action payloads are
 *     opaque base64 bytes today; without a typed payload schema we can't
 *     route them to a specific workspace, so the allowlist can't gate
 *     them. Phase C-late will introduce a typed `BridgeActionPayload`
 *     schema with embedded workspaceId; at that point actionAck will
 *     evaluate against the allowlist the same way prepareStartTurnAck
 *     does today.
 *
 * Dev-mode opt-in: setting `AGBENCH_BRIDGE_PERMISSIVE=1` (or `true`) flips
 * the policy to accept-all. This bypasses the allowlist entirely — useful
 * for testing the round-trip with a real iOS device before any allowlist
 * entries are configured. **Never** enable in production. The console
 * logs a one-time WARN at construction so it's obvious when active.
 *
 * Three-state approval (per Lunel observation): `scope?: 'once' | 'session'`
 * is reserved in the actionAck response shape so we can express the
 * `acceptForSession` tier later. Today only `'once'` is emitted. The daemon-
 * side Swift `BridgeActionAck` only carries the boolean today, so any `scope`
 * is dropped at the BridgeActionAck construction — but the wire format
 * already supports it, so adding scope-aware Swift types is purely additive.
 */

export interface BridgeActionAckResult {
  accepted: boolean
  /** Phase C3.6 reserves this for future "accept for session" semantics
   * (Lunel's `acceptForSession` pattern). Today only `'once'` is emitted;
   * the daemon-side `BridgeActionAck` ignores it. */
  scope?: 'once' | 'session'
  message?: string
  executed?: boolean
  data?: Record<string, unknown>
}

export interface BridgePrepareStartTurnAckResult {
  accepted: boolean
  message?: string
}

export interface BridgeActionRouterOptions {
  /** When true, ALL ack requests are accepted regardless of payload OR
   * allowlist state. For local end-to-end testing only — never enable in
   * production. */
  permissiveDev?: boolean
  /** Optional logger sink. Defaults to no-op; production wires
   * `console.log` so routing decisions show up in the dev terminal. */
  log?: (line: string) => void
  /** Phase C4: workspace allowlist consulted on every prepare-start-turn
   * decision. When omitted, prepare-start-turn falls back to deny-by-default
   * (same behavior as Phase C3.6). When provided, allowlist entries gate
   * which workspaces iOS may initiate turns against. */
  allowlist?: RemoteWorkspaceAllowlist
  /** Phase C-late: action executor used after policy authorization to
   * actually do the thing (cancel a run, resolve an approval, etc.).
   * Defaults to `NoopActionExecutor` so routing decisions remain stable
   * without an executor wired in (router accepts → executor declines with
   * "not yet wired" → iOS sees a clear message). */
  executor?: BridgeActionExecutor
}

/** Error subclass the BridgeDaemonClient knows about — throwing one of these
 * surfaces a typed JSON-RPC error to the daemon side. Imported from
 * BridgeDaemonClient via a duck-typed re-throw so we don't introduce a
 * circular import; the runtime mapping there checks `instanceof
 * BridgeDaemonError`, which our throws here don't satisfy. We just throw
 * plain Error and accept the default `-32603 internalError` mapping. The
 * router never throws on policy decisions — only on unknown methods. */

export class BridgeActionRouter {
  private readonly permissiveDev: boolean
  private readonly log: (line: string) => void
  private readonly allowlist?: RemoteWorkspaceAllowlist
  private readonly executor: BridgeActionExecutor

  constructor(options: BridgeActionRouterOptions = {}) {
    this.permissiveDev = options.permissiveDev ?? false
    this.log = options.log ?? (() => {})
    this.allowlist = options.allowlist
    this.executor = options.executor ?? new NoopActionExecutor()
    if (this.permissiveDev) {
      this.log(
        '[BridgeActionRouter] WARN: permissive-dev mode is ON — every iOS action ack request will be accepted'
      )
    }
  }

  /** Read env vars and construct a router. Centralizes the env-flag contract
   * so it's not scattered across main/index.ts. */
  static fromEnvironment(
    log?: (line: string) => void,
    allowlist?: RemoteWorkspaceAllowlist,
    executor?: BridgeActionExecutor
  ): BridgeActionRouter {
    const permissiveDev =
      process.env.AGBENCH_BRIDGE_PERMISSIVE === '1' ||
      process.env.AGBENCH_BRIDGE_PERMISSIVE === 'true'
    return new BridgeActionRouter({ permissiveDev, log, allowlist, executor })
  }

  /** Dispatch a daemon→Electron request to the right policy method. Throws
   * for unknown methods (BridgeDaemonClient maps generic Error throws to
   * `-32603 internalError`, which the daemon's awaiter sees and falls back
   * from). */
  async route(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'bridge.requestActionAck':
        return this.handleActionAck(params)
      case 'bridge.requestPrepareStartTurnAck':
        return this.handlePrepareStartTurnAck(params)
      default:
        throw new Error(`BridgeActionRouter: no handler for method "${method}"`)
    }
  }

  private async handleActionAck(rawParams: unknown): Promise<BridgeActionAckResult> {
    const dict = isRecord(rawParams) ? rawParams : {}
    const pairID = String(dict.pairID ?? '?')
    const bytes = Number(dict.payloadBytes ?? 0)
    const payloadBase64 = typeof dict.payloadBase64 === 'string' ? dict.payloadBase64 : ''

    if (this.permissiveDev) {
      this.log(
        `[BridgeActionRouter] permissive-dev ACCEPT actionAck pairID=${pairID} bytes=${bytes}`
      )
      return {
        accepted: true,
        scope: 'once',
        message: 'permissive-dev: accepted without payload inspection'
      }
    }

    // Phase C-late slice 1: decode the typed payload. A malformed payload
    // (bad base64, bad JSON) gets a tailored deny so iOS UX can show the
    // user why their action was rejected instead of a generic "denied".
    let payload: BridgeActionPayload
    try {
      payload = decodeBridgeActionPayload(payloadBase64).payload
    } catch (err) {
      if (err instanceof BridgeActionPayloadDecodeError) {
        this.log(
          `[BridgeActionRouter] DENY actionAck pairID=${pairID} malformed payload (stage=${err.stage}): ${err.message}`
        )
        return {
          accepted: false,
          scope: 'once',
          message: `Malformed action payload (${err.stage}): ${err.message}`
        }
      }
      this.log(
        `[BridgeActionRouter] DENY actionAck pairID=${pairID} payload decode threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`
      )
      return {
        accepted: false,
        scope: 'once',
        message: 'Action payload decode failed'
      }
    }

    // Unknown action kind → safe deny. We log the rawKind so future iOS
    // releases sending new actions to an older Electron are observable.
    if (payload.kind === 'unknown') {
      this.log(
        `[BridgeActionRouter] DENY actionAck pairID=${pairID} unknown kind="${payload.rawKind}"`
      )
      return {
        accepted: false,
        scope: 'once',
        message: `Unrecognized action kind "${payload.rawKind}" — Electron may be older than the iOS client`
      }
    }

    // Workspace gating is per-variant. Most actions target a specific
    // workspace and must pass the allowlist. Paired-device-level system
    // actions (e.g. `registerApnsToken`) bypass — the pair gate at the
    // QUIC layer is the only authentication needed.
    if (payloadRequiresWorkspaceGating(payload)) {
      const workspaceId = workspaceIdFromPayload(payload)
      if (workspaceId === null) {
        // Shouldn't reach here for known kinds — but defensively deny.
        this.log(
          `[BridgeActionRouter] DENY actionAck pairID=${pairID} kind=${payload.kind} missing workspaceId`
        )
        return {
          accepted: false,
          scope: 'once',
          message: 'Action payload is missing workspaceId'
        }
      }
      if (this.allowlist) {
        const provider =
          'provider' in payload && typeof payload.provider === 'string'
            ? payload.provider
            : undefined
        const approvalMode =
          'approvalMode' in payload && typeof payload.approvalMode === 'string'
            ? payload.approvalMode
            : undefined
        const decision = this.allowlist.evaluate({ workspaceId, provider, approvalMode })
        if (!decision.allowed) {
          this.log(
            `[BridgeActionRouter] DENY actionAck pairID=${pairID} kind=${payload.kind} ws=${workspaceId} reason="${decision.reason}"`
          )
          return {
            accepted: false,
            scope: 'once',
            message: decision.reason
          }
        }
        // Read-only enforcement: when the workspace allowlist entry says
        // `mode: 'read-only'`, mutating actions are denied. Non-mutating
        // actions (approvalReply, questionReject) pass through — the
        // intent is "iPhone can respond to desktop-initiated prompts but
        // can't initiate or mutate work themselves". See
        // `payloadIsMutating` for per-variant classification + rationale.
        if (decision.entry.mode === 'read-only' && payloadIsMutating(payload)) {
          const reason = `Workspace "${workspaceId}" is read-only; action "${payload.kind}" requires read-write access`
          this.log(
            `[BridgeActionRouter] DENY actionAck pairID=${pairID} kind=${payload.kind} ws=${workspaceId} reason="${reason}"`
          )
          return {
            accepted: false,
            scope: 'once',
            message: reason
          }
        }
      } else {
        this.log(
          `[BridgeActionRouter] DENY actionAck pairID=${pairID} kind=${payload.kind} ws=${workspaceId} — no allowlist configured`
        )
        return {
          accepted: false,
          scope: 'once',
          message: 'iOS action routing not yet enabled — no workspace allowlist configured'
        }
      }
    } else {
      this.log(
        `[BridgeActionRouter] system action accepted pairID=${pairID} kind=${payload.kind} (workspace-gate skipped)`
      )
    }

    // Policy cleared the action. Hand off to the executor for the real
    // dispatch. The executor's `executed` flag distinguishes two cases
    // from the iOS user's perspective:
    //   - executed: true  → "your action did the thing"
    //   - executed: false → "policy allowed it, but the wiring isn't done"
    // Both surface as `accepted: true` since the router's policy decision
    // was positive — the executor result just refines the message.
    const dispatch = await this.dispatch(payload)
    // workspaceIdFromPayload may legitimately be null for non-workspace-bound
    // variants (e.g. registerApnsToken); the log shows "ws=null" in that case.
    const workspaceIdForLog = workspaceIdFromPayload(payload) ?? 'null'
    this.log(
      `[BridgeActionRouter] ACCEPT actionAck pairID=${pairID} kind=${payload.kind} ws=${workspaceIdForLog} executed=${dispatch.executed}`
    )
    return {
      accepted: true,
      scope: 'once',
      message: dispatch.message,
      executed: dispatch.executed,
      data: dispatch.data
    }
  }

  /** Dispatch a policy-cleared action through the executor. The big
   * switch keeps payload-kind narrowing TypeScript-checked. */
  private async dispatch(payload: BridgeActionPayload): Promise<BridgeActionExecutionResult> {
    switch (payload.kind) {
      case 'approvalReply':
        return this.executor.executeApprovalReply(payload)
      case 'questionReply':
        return this.executor.executeQuestionReply(payload)
      case 'questionReject':
        return this.executor.executeQuestionReject(payload)
      case 'composerPrompt':
        return this.executor.executeComposerPrompt(payload)
      case 'cancelRun':
        return this.executor.executeCancelRun(payload)
      case 'registerApnsToken':
        return this.executor.executeRegisterApnsToken(payload)
      case 'setYoloMode':
        return this.executor.executeSetYoloMode(payload)
      case 'togglePinChat':
        return this.executor.executeTogglePinChat(payload)
      case 'togglePinWorkspace':
        return this.executor.executeTogglePinWorkspace(payload)
      case 'unknown':
        // Should never reach here — `handleActionAck` denies `unknown`
        // before dispatch. Defensive fallthrough.
        return {
          executed: false,
          message: `Unknown action kind "${payload.rawKind}" reached dispatch unexpectedly`
        }
    }
  }

  private handlePrepareStartTurnAck(rawParams: unknown): BridgePrepareStartTurnAckResult {
    const dict = isRecord(rawParams) ? rawParams : {}
    const pairID = String(dict.pairID ?? '?')
    const workspaceID = String(dict.workspaceID ?? '?')
    const provider = typeof dict.provider === 'string' ? dict.provider : undefined
    const approvalMode = typeof dict.approvalMode === 'string' ? dict.approvalMode : undefined

    if (this.permissiveDev) {
      this.log(
        `[BridgeActionRouter] permissive-dev ACCEPT prepareStartTurn pairID=${pairID} ws=${workspaceID}`
      )
      return {
        accepted: true,
        message: 'permissive-dev: accepted without allowlist check'
      }
    }

    if (!this.allowlist) {
      this.log(
        `[BridgeActionRouter] DENY prepareStartTurn pairID=${pairID} ws=${workspaceID} — no allowlist configured`
      )
      return {
        accepted: false,
        message: 'iOS-initiated turns not yet enabled — no workspace allowlist configured'
      }
    }

    const decision = this.allowlist.evaluate({
      workspaceId: workspaceID,
      provider,
      approvalMode
    })
    if (decision.allowed) {
      this.log(
        `[BridgeActionRouter] ACCEPT prepareStartTurn pairID=${pairID} ws=${workspaceID} mode=${decision.entry.mode}`
      )
      return {
        accepted: true,
        message: `Workspace "${workspaceID}" allowed (${decision.entry.mode})`
      }
    }
    this.log(
      `[BridgeActionRouter] DENY prepareStartTurn pairID=${pairID} ws=${workspaceID} reason="${decision.reason}"`
    )
    return {
      accepted: false,
      message: decision.reason
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
