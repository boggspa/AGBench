import type { ChildProcess } from 'child_process'
import type {
  AgentApprovalAction,
  AgenticServiceId,
  ProviderId,
  RunEventKind,
  RunEventPhase
} from '../store/types'
import type { AgentRunRoute } from '../index'
import type { RunManager } from '../RunManager'
import type { PermissionService } from '../PermissionService'
import type {
  ApprovalTimeoutScheduler,
  ApprovalTimeoutReason
} from '../ApprovalTimeoutScheduler'
import type { BridgeApnsPusher, BridgeApprovalPushPayload, BridgeApnsPushResult } from '../BridgeApnsPusher'
import type { BridgeApnsTokenStore } from '../BridgeApnsTokenStore'

/**
 * ApprovalService — Phase B3 extraction.
 *
 * Owns the five pending-approval registries that connect agent
 * runtime side-channels (Codex JSON-RPC, Kimi wire protocol,
 * Gemini tool prompts, AGBench main-authority approvals, host-
 * command rerun prompts) to the unified decision-resolution flow.
 *
 * Before B3 these registries were scattered across `index.ts` at
 * module scope with the dispatch logic inline in `whenReady`. The
 * extraction:
 *   - Makes the dispatch testable with mocked deps.
 *   - Puts the wake-push + auto-deny timer integration in one place.
 *   - Establishes the seam where future approval-policy changes
 *     (per-pair preferences, push throttling, approval delegation
 *     hand-offs to a planner agent) land.
 *
 * **What's in scope here:**
 *   - The 5 registries
 *   - `resolve(approvalId, action, options)` — the unified dispatch
 *     that walks all 5 registries and runs provider-specific
 *     completion (matches the previous inline behaviour byte-for-
 *     byte)
 *   - `lookupRoute(approvalId)` — finds the route a pending approval
 *     belongs to (used by the timeout callback)
 *   - `notifyPairedDevicesOfApproval(...)` — APNs wake-push fan-out
 *     gated by the idle detector
 *   - `workspaceIdForPush(...)` — workspace path → id lookup helper
 *   - `scheduleTimeout(...)` — wraps the scheduler with the
 *     user-settings-aware policy resolution
 *
 * **What's NOT in scope (still in index.ts after B3):**
 *   - `resolveApprovalLedgerResponse` / `recordAutomaticApprovalDecision`
 *     — thin wrappers around PermissionService/AppStore that are
 *     called from many places (runXxxProvider, the auto-allow path
 *     in `requestAgenticServiceApproval`, etc.). Moving them ripples
 *     too broadly for this slice; the service consumes them via
 *     injected deps. A follow-up can fold them in.
 *   - The `ApprovalTimeoutScheduler` construction (the `onTimeout`
 *     callback closes over `processAgentApprovalResponse` → kept
 *     near the service wiring for readability).
 *
 * **Behaviour-preservation contract:**
 *   - Every IPC handler that today calls `processAgentApprovalResponse`
 *     now calls `approvalService.resolve(...)` and gets the SAME
 *     boolean return + the SAME side effects (durable event, ledger
 *     update, provider-specific completion).
 *   - The auto-deny timer still passes `decisionSource: 'system'` +
 *     `extraMetadata` (Phase E1.2 contract).
 *   - The wake-push fan-out + the durable-event audit trail
 *     produce identical outputs.
 */

// ──────────────────────────────────────────────────────────────────
// Registry payload types — exported so callers can build them.
// ──────────────────────────────────────────────────────────────────

export interface PendingMainApproval {
  provider: ProviderId
  workspacePath?: string
  runId?: string
  resolve: (allowed: boolean) => void
}

export interface PendingGeminiToolApproval {
  provider: ProviderId
  service: AgenticServiceId
  workspacePath?: string
  runId?: string
  resolve: (allowed: boolean) => void
}

export interface PendingCodexApproval {
  rpcId: number | string
  method: string
  params: unknown
  service?: AgenticServiceId
  workspacePath?: string
  runId?: string
}

export interface PendingKimiApproval {
  child: ChildProcess
  rpcId: number | string
  params: unknown
  runId?: string
}

export interface PendingHostCommandApproval {
  sender: Electron.WebContents
  provider: 'codex'
  command: unknown
  commandText: string
  cwd: string
  workspacePath?: string
  threadId: string
  model: string
  appRunId?: string
  appChatId?: string
  reason: string
  output: string
}

export interface ApprovalRouteLookup {
  provider: ProviderId
  appRunId?: string
  appChatId?: string
}

export interface ResolveOptions {
  /** Typed user input (Codex elicitation / requestUserInput). */
  userInput?: string
  /** Phase E1.2: 'user' vs 'system' for auto-deny attribution. */
  decisionSource?: 'user' | 'system'
  /** Phase E1.2: merged into the ledger record. */
  extraMetadata?: Record<string, unknown>
}

export interface ScheduleTimeoutArgs {
  approvalId: string
  provider: ProviderId
  route?: AgentRunRoute | null
  isMainAuthority?: boolean
  kind?: string
}

export type ApprovalRunEventType = 'approval_pending' | 'approval_resolved'

export interface ApprovalRunEvent {
  type: ApprovalRunEventType
  approvalId: string
  provider: ProviderId
  workspaceId: string
  threadId: string
  appRunId?: string
  appChatId?: string
  action?: AgentApprovalAction
  decisionSource?: 'user' | 'system'
}

// ──────────────────────────────────────────────────────────────────
// Injected dependencies.
// ──────────────────────────────────────────────────────────────────

export interface ApprovalServiceDeps {
  /** Run-state tracking (resolveApproval, get, clearApproval). */
  runManager: RunManager<unknown>
  /** Per-action decision + grant management. */
  permissionService: PermissionService
  /** Durable run-event writer for audit traces. */
  appendDurableRunEventForRoute: (
    provider: ProviderId,
    route: AgentRunRoute | null | undefined,
    kind: RunEventKind,
    phase: RunEventPhase,
    title: string,
    payload?: unknown
  ) => void
  /** Ledger response writer (Phase E1.2 thread-through). */
  resolveApprovalLedger: (
    approvalId: string,
    action: AgentApprovalAction,
    decisionSource: 'user' | 'system',
    extraMetadata: Record<string, unknown>
  ) => void
  /** Codex RPC client accessor (or null when not running). */
  getCodexClient: () => {
    respond: (rpcId: number | string, payload: unknown) => void
    reject: (rpcId: number | string, reason: string) => void
  } | null
  /** Send a compat-line frame to a renderer (used by host-command
   * decline path). The `state` arg matches the existing function's
   * `route?: AgentRunRoute | null` shape — host-command callers pass
   * the approval record (which has `appRunId` / `appChatId`). */
  sendAgentCompatLine: (
    sender: Electron.WebContents,
    provider: ProviderId,
    line: unknown,
    state?: AgentRunRoute | null
  ) => void
  /** Reply to a pending Kimi wire request. */
  respondToKimiWireRequest: (
    child: ChildProcess,
    rpcId: number | string,
    result: unknown
  ) => void
  /** Execute a previously-pending host command. */
  runApprovedHostCommand: (approvalId: string) => Promise<boolean>
  /** Active CLI provider processes (for Kimi cancel kill cleanup). */
  cliProviderProcesses: Map<ProviderId, ChildProcess>
  /** APNs pusher (or null when not configured). */
  getApnsPusher: () => BridgeApnsPusher | null
  /** APNs token store (or null when not yet ready). */
  getApnsTokenStore: () => BridgeApnsTokenStore | null
  /** Idle detector — when true, suppresses wake-push (user is here). */
  isUserAtDesktop: () => boolean
  /** Workspace path → workspace id mapping. */
  workspaceIdForPath: (workspacePath: string | undefined) => string
  /** Bridge-only run-event publisher for Live Activity approval counts. */
  publishApprovalRunEvent: (event: ApprovalRunEvent) => void
  /** Settings lookup for the user-tunable timeout policy. */
  getApprovalTimeoutSettings: () => {
    enabled: boolean
    perProviderMs: { gemini: number; codex: number; claude: number; kimi: number }
    mainAuthorityMs: number
  }
  /** Logger sink. */
  log: (line: string) => void
}

// ──────────────────────────────────────────────────────────────────
// Service.
// ──────────────────────────────────────────────────────────────────

export class ApprovalService {
  private pendingMain = new Map<string, PendingMainApproval>()
  private pendingGeminiTool = new Map<string, PendingGeminiToolApproval>()
  private pendingCodex = new Map<string, PendingCodexApproval>()
  private pendingKimi = new Map<string, PendingKimiApproval>()
  private pendingHostCommand = new Map<string, PendingHostCommandApproval>()
  private scheduler: ApprovalTimeoutScheduler | null = null

  constructor(private deps: ApprovalServiceDeps) {}

  /** Late-bound scheduler injection. The scheduler's `onTimeout`
   * callback closes over the service (it calls `resolve(...)` on
   * timeout), creating a constructor-time dependency cycle. The
   * caller constructs the service first, then the scheduler, then
   * wires them together with this method. */
  setScheduler(scheduler: ApprovalTimeoutScheduler): void {
    this.scheduler = scheduler
  }

  // ──── registration ─────────────────────────────────────────────

  registerMain(approvalId: string, info: PendingMainApproval): void {
    this.pendingMain.set(approvalId, info)
    this.emitApprovalRunEvent('approval_pending', approvalId, info.provider, {
      appRunId: info.runId,
      workspacePath: info.workspacePath
    })
  }

  registerGeminiTool(approvalId: string, info: PendingGeminiToolApproval): void {
    this.pendingGeminiTool.set(approvalId, info)
    this.emitApprovalRunEvent('approval_pending', approvalId, info.provider, {
      appRunId: info.runId,
      workspacePath: info.workspacePath
    })
  }

  registerCodex(approvalId: string, info: PendingCodexApproval): void {
    this.pendingCodex.set(approvalId, info)
    this.emitApprovalRunEvent('approval_pending', approvalId, 'codex', {
      appRunId: info.runId,
      workspacePath: info.workspacePath
    })
  }

  registerKimi(approvalId: string, info: PendingKimiApproval): void {
    this.pendingKimi.set(approvalId, info)
    this.emitApprovalRunEvent('approval_pending', approvalId, 'kimi', {
      appRunId: info.runId
    })
  }

  registerHostCommand(approvalId: string, info: PendingHostCommandApproval): void {
    this.pendingHostCommand.set(approvalId, info)
    this.emitApprovalRunEvent('approval_pending', approvalId, info.provider, {
      appRunId: info.appRunId,
      appChatId: info.appChatId,
      workspacePath: info.workspacePath,
      threadId: info.threadId
    })
  }

  // ──── accessors for callers that need to peek at registry state ──

  getHostCommand(approvalId: string): PendingHostCommandApproval | undefined {
    return this.pendingHostCommand.get(approvalId)
  }

  deleteHostCommand(approvalId: string): void {
    this.pendingHostCommand.delete(approvalId)
  }

  has(approvalId: string): boolean {
    return (
      this.pendingMain.has(approvalId) ||
      this.pendingGeminiTool.has(approvalId) ||
      this.pendingCodex.has(approvalId) ||
      this.pendingKimi.has(approvalId) ||
      this.pendingHostCommand.has(approvalId)
    )
  }

  // ──── route lookup ─────────────────────────────────────────────

  /** Phase E1.2: find which provider's registry holds an approval
   * id, and what its route is. Used by the timeout callback. */
  lookupRoute(approvalId: string): ApprovalRouteLookup | null {
    const main = this.pendingMain.get(approvalId)
    if (main) {
      const session = this.deps.runManager.get(main.runId)
      return { provider: main.provider, appRunId: main.runId, appChatId: session?.appChatId }
    }
    const gemini = this.pendingGeminiTool.get(approvalId)
    if (gemini) {
      const session = this.deps.runManager.get(gemini.runId)
      return { provider: gemini.provider, appRunId: gemini.runId, appChatId: session?.appChatId }
    }
    const host = this.pendingHostCommand.get(approvalId)
    if (host) {
      return { provider: host.provider, appRunId: host.appRunId, appChatId: host.appChatId }
    }
    const kimi = this.pendingKimi.get(approvalId)
    if (kimi) {
      const session = this.deps.runManager.get(kimi.runId)
      return { provider: 'kimi', appRunId: kimi.runId, appChatId: session?.appChatId }
    }
    const codex = this.pendingCodex.get(approvalId)
    if (codex) {
      const session = this.deps.runManager.get(codex.runId)
      return { provider: 'codex', appRunId: codex.runId, appChatId: session?.appChatId }
    }
    return null
  }

  // ──── scheduling ───────────────────────────────────────────────

  /** Arm an auto-deny timer for the approval. Reads user settings
   * on every call so live setting changes take effect on the next
   * approval. Best-effort: silent no-op when disabled. */
  scheduleTimeout(args: ScheduleTimeoutArgs): void {
    if (!this.scheduler) return
    if (
      process.env.AGBENCH_APPROVAL_TIMEOUT_OFF === '1' ||
      process.env.AGBENCH_APPROVAL_TIMEOUT_OFF === 'true'
    ) {
      return
    }
    const userSettings = this.deps.getApprovalTimeoutSettings()
    if (!userSettings.enabled) return
    this.scheduler.updatePolicy({
      defaultTimeoutsMs: {
        gemini: userSettings.perProviderMs.gemini,
        codex: userSettings.perProviderMs.codex,
        claude: userSettings.perProviderMs.claude,
        kimi: userSettings.perProviderMs.kimi
      },
      mainTimeoutMs: userSettings.mainAuthorityMs
    })
    const { appliedMs, source } = this.scheduler.schedule({
      approvalId: args.approvalId,
      provider: args.provider,
      isMainAuthority: args.isMainAuthority,
      kind: args.kind
    })
    if (args.route?.appRunId) {
      try {
        this.deps.appendDurableRunEventForRoute(
          args.provider,
          args.route,
          'approval_timer_armed',
          'control',
          `Approval timer armed: ${appliedMs}ms`,
          {
            approvalId: args.approvalId,
            appliedMs,
            source,
            isMainAuthority: args.isMainAuthority === true,
            kind: args.kind
          }
        )
      } catch {
        // best-effort
      }
    }
  }

  // ──── wake-push to paired iOS devices ──────────────────────────

  /** Phase C5+E. Fan out an APNs wake-push to every paired iOS
   * device when the user is away from the desktop. Best-effort:
   * never throws; missing pusher / no tokens / user-at-desktop are
   * all silent no-ops. */
  notifyPairedDevices(args: {
    approvalId: string
    workspaceId: string
    threadId: string
    summary: string
  }): void {
    const tokenStore = this.deps.getApnsTokenStore()
    const pusher = this.deps.getApnsPusher()
    if (!tokenStore || !pusher) return
    const tokens = tokenStore.list()
    if (tokens.length === 0) return
    if (this.deps.isUserAtDesktop()) {
      this.deps.log(
        `[APNs] skipping approval push for ${args.approvalId} — user is at desktop`
      )
      return
    }
    const maybePushable = pusher as unknown as {
      pushApprovalToToken?: (
        deviceTokenHex: string,
        env: 'production' | 'sandbox',
        payload: BridgeApprovalPushPayload
      ) => Promise<BridgeApnsPushResult>
    }
    if (typeof maybePushable.pushApprovalToToken !== 'function') return
    for (const entry of tokens) {
      void (async () => {
        try {
          const result = await maybePushable.pushApprovalToToken!(
            entry.deviceToken,
            entry.env,
            {
              pairID: entry.pairID,
              workspaceId: args.workspaceId,
              threadId: args.threadId,
              toolCallId: args.approvalId,
              summary: args.summary
            }
          )
          if (!result.delivered) {
            const reason = result.reason ?? ''
            if (/^Unregistered$|^BadDeviceToken$/i.test(reason)) {
              this.deps.log(
                `[APNs] pruning dead token for pairID=${entry.pairID}: ${reason}`
              )
              tokenStore.remove(entry.pairID)
            } else if (reason && reason !== 'noop') {
              this.deps.log(
                `[APNs] approval push not delivered to pairID=${entry.pairID}: ${reason}`
              )
            }
          }
        } catch (err) {
          this.deps.log(
            `[APNs] approval push threw for pairID=${entry.pairID}: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      })()
    }
  }

  /** Workspace path → id (or 'global' / canonical path fallback). */
  workspaceIdForPush(workspacePath: string | undefined): string {
    return this.deps.workspaceIdForPath(workspacePath)
  }

  // ──── the unified resolve dispatch ─────────────────────────────

  /** Walk all 5 registries, run provider-specific completion, and
   * report success. Matches the previous inline
   * `processAgentApprovalResponse` byte-for-byte. */
  async resolve(
    requestId: string,
    action: AgentApprovalAction,
    options?: ResolveOptions
  ): Promise<boolean> {
    const decisionSource = options?.decisionSource ?? 'user'
    const extraMetadata = options?.extraMetadata ?? {}
    // Cancel the auto-deny timer the moment any decision lands.
    this.scheduler?.cancel(requestId)

    // ── Main authority approval ─────────────────────────────────
    const pendingMain = this.pendingMain.get(requestId)
    if (pendingMain) {
      const session = this.deps.runManager.resolveApproval(requestId) ||
        this.deps.runManager.get(pendingMain.runId)
      this.deps.appendDurableRunEventForRoute(
        pendingMain.provider,
        { appRunId: session?.runId || pendingMain.runId, appChatId: session?.appChatId },
        'approval_response',
        'control',
        `Main approval response: ${action}`,
        { requestId, action, workspacePath: pendingMain.workspacePath }
      )
      this.deps.resolveApprovalLedger(requestId, action, decisionSource, extraMetadata)
      this.emitApprovalRunEvent('approval_resolved', requestId, pendingMain.provider, {
        appRunId: session?.runId || pendingMain.runId,
        appChatId: session?.appChatId,
        workspacePath: pendingMain.workspacePath,
        action,
        decisionSource
      })
      this.pendingMain.delete(requestId)
      this.deps.runManager.clearApproval(requestId)
      pendingMain.resolve(this.deps.permissionService.isApprovedAction(action))
      return true
    }

    // ── Gemini tool approval ────────────────────────────────────
    const pendingGeminiTool = this.pendingGeminiTool.get(requestId)
    if (pendingGeminiTool) {
      const session = this.deps.runManager.resolveApproval(requestId) ||
        this.deps.runManager.get(pendingGeminiTool.runId)
      this.deps.appendDurableRunEventForRoute(
        pendingGeminiTool.provider,
        { appRunId: session?.runId || pendingGeminiTool.runId, appChatId: session?.appChatId },
        'approval_response',
        'control',
        `Approval response: ${action}`,
        {
          requestId,
          action,
          service: pendingGeminiTool.service,
          workspacePath: pendingGeminiTool.workspacePath
        }
      )
      this.deps.resolveApprovalLedger(requestId, action, decisionSource, extraMetadata)
      this.emitApprovalRunEvent('approval_resolved', requestId, pendingGeminiTool.provider, {
        appRunId: session?.runId || pendingGeminiTool.runId,
        appChatId: session?.appChatId,
        workspacePath: pendingGeminiTool.workspacePath,
        action,
        decisionSource
      })
      this.pendingGeminiTool.delete(requestId)
      this.deps.runManager.clearApproval(requestId)
      const allowed = this.deps.permissionService.applyApprovalDecision({
        provider: pendingGeminiTool.provider,
        workspacePath: pendingGeminiTool.workspacePath,
        service: pendingGeminiTool.service,
        runId: pendingGeminiTool.runId,
        action
      })
      pendingGeminiTool.resolve(allowed)
      return true
    }

    // ── Host command rerun approval ─────────────────────────────
    const pendingHostCommand = this.pendingHostCommand.get(requestId)
    if (pendingHostCommand) {
      this.deps.appendDurableRunEventForRoute(
        pendingHostCommand.provider,
        { appRunId: pendingHostCommand.appRunId, appChatId: pendingHostCommand.appChatId },
        'approval_response',
        'control',
        `Host command rerun response: ${action}`,
        {
          requestId,
          action,
          command: pendingHostCommand.commandText,
          cwd: pendingHostCommand.cwd
        }
      )
      this.deps.resolveApprovalLedger(requestId, action, decisionSource, extraMetadata)
      this.emitApprovalRunEvent('approval_resolved', requestId, pendingHostCommand.provider, {
        appRunId: pendingHostCommand.appRunId,
        appChatId: pendingHostCommand.appChatId,
        workspacePath: pendingHostCommand.workspacePath,
        threadId: pendingHostCommand.threadId,
        action,
        decisionSource
      })
      this.deps.runManager.clearApproval(requestId)
      if (action === 'accept') {
        return this.deps.runApprovedHostCommand(requestId)
      }
      this.pendingHostCommand.delete(requestId)
      this.deps.sendAgentCompatLine(
        pendingHostCommand.sender,
        'codex',
        {
          type: 'tool_result',
          tool_id: `${requestId}-denied`,
          tool_name: 'run_shell_command',
          status: 'warning',
          output: `User ${action}ed host rerun of ${pendingHostCommand.commandText}.`,
          provider: 'codex'
        },
        pendingHostCommand
      )
      return true
    }

    // ── Kimi wire approval ──────────────────────────────────────
    const pendingKimi = this.pendingKimi.get(requestId)
    if (pendingKimi) {
      const session = this.deps.runManager.resolveApproval(requestId) ||
        this.deps.runManager.get(pendingKimi.runId)
      this.deps.appendDurableRunEventForRoute(
        'kimi',
        { appRunId: session?.runId || pendingKimi.runId, appChatId: session?.appChatId },
        'approval_response',
        'control',
        `Kimi approval response: ${action}`,
        {
          requestId,
          action,
          rpcId: pendingKimi.rpcId,
          params: pendingKimi.params
        }
      )
      this.deps.resolveApprovalLedger(requestId, action, decisionSource, extraMetadata)
      this.emitApprovalRunEvent('approval_resolved', requestId, 'kimi', {
        appRunId: session?.runId || pendingKimi.runId,
        appChatId: session?.appChatId,
        action,
        decisionSource
      })
      this.pendingKimi.delete(requestId)
      this.deps.runManager.clearApproval(requestId)
      const params = pendingKimi.params as { payload?: { id?: string } } | null
      const payload = params?.payload || {}
      const response = action === 'acceptForSession' || action === 'acceptForWorkspace'
        ? 'approve_for_session'
        : action === 'accept'
          ? 'approve'
          : 'reject'
      this.deps.respondToKimiWireRequest(pendingKimi.child, pendingKimi.rpcId, {
        request_id: payload.id || requestId,
        response,
        ...(response === 'reject' ? { feedback: `User ${action}ed Kimi approval request.` } : {})
      })
      if (action === 'cancel') {
        pendingKimi.child.kill()
        this.deps.cliProviderProcesses.delete('kimi')
      }
      return true
    }

    // ── Codex approval (the most complex path) ──────────────────
    const pending = this.pendingCodex.get(requestId)
    const codexClient = this.deps.getCodexClient()
    if (!pending || !codexClient) {
      return false
    }
    const session = this.deps.runManager.resolveApproval(requestId) ||
      this.deps.runManager.get(pending.runId)
    this.deps.appendDurableRunEventForRoute(
      'codex',
      { appRunId: session?.runId || pending.runId, appChatId: session?.appChatId },
      'approval_response',
      'control',
      `Codex approval response: ${action}`,
      {
        requestId,
        action,
        rpcId: pending.rpcId,
        method: pending.method,
        service: pending.service,
        workspacePath: pending.workspacePath
      }
    )
    this.deps.resolveApprovalLedger(requestId, action, decisionSource, extraMetadata)
    this.emitApprovalRunEvent('approval_resolved', requestId, 'codex', {
      appRunId: session?.runId || pending.runId,
      appChatId: session?.appChatId,
      workspacePath: pending.workspacePath,
      action,
      decisionSource
    })
    this.pendingCodex.delete(requestId)
    this.deps.runManager.clearApproval(requestId)

    const params = pending.params as { permissions?: unknown } | null

    if (pending.method === 'item/permissions/requestApproval') {
      const allowed = this.deps.permissionService.applyApprovalDecision({
        provider: 'codex',
        workspacePath: pending.workspacePath,
        service: pending.service,
        runId: pending.runId,
        action
      })
      if (allowed) {
        codexClient.respond(pending.rpcId, {
          permissions: params?.permissions || {},
          scope: action === 'accept' ? 'turn' : 'session'
        })
      } else {
        codexClient.reject(pending.rpcId, `User ${action}ed Codex permission request.`)
      }
      return true
    }

    if (pending.method === 'mcp/elicitation/request') {
      codexClient.respond(pending.rpcId, {
        action: action === 'acceptForSession' ? 'accept' : action,
        content: options?.userInput ?? null,
        _meta: null
      })
      return true
    }

    if (pending.method === 'tool/requestUserInput') {
      if (action === 'accept' || action === 'acceptForSession') {
        const answers = options?.userInput !== undefined
          ? { default: options.userInput }
          : {}
        codexClient.respond(pending.rpcId, { answers })
      } else {
        codexClient.reject(pending.rpcId, `User ${action}ed Codex input request.`)
      }
      return true
    }

    codexClient.respond(pending.rpcId, { decision: action })
    return true
  }

  /** Diagnostic / debugging view of all currently-pending approvals.
   * Returns counts per registry. Useful for the Approval Ledger
   * panel + future "what's currently waiting" surface. */
  pendingCounts(): Record<string, number> {
    return {
      main: this.pendingMain.size,
      geminiTool: this.pendingGeminiTool.size,
      codex: this.pendingCodex.size,
      kimi: this.pendingKimi.size,
      hostCommand: this.pendingHostCommand.size
    }
  }

  private emitApprovalRunEvent(
    type: ApprovalRunEventType,
    approvalId: string,
    provider: ProviderId,
    context: {
      appRunId?: string
      appChatId?: string
      workspacePath?: string
      threadId?: string
      action?: AgentApprovalAction
      decisionSource?: 'user' | 'system'
    }
  ): void {
    try {
      const session = this.deps.runManager.get(context.appRunId)
      const appRunId = session?.runId ?? context.appRunId
      const appChatId = session?.appChatId ?? context.appChatId
      const workspaceId = this.deps.workspaceIdForPath(
        context.workspacePath ?? session?.workspacePath
      )
      const threadId = appChatId ?? context.threadId ?? appRunId ?? approvalId
      const event: ApprovalRunEvent = {
        type,
        approvalId,
        provider,
        workspaceId,
        threadId
      }
      if (appRunId) event.appRunId = appRunId
      if (appChatId) event.appChatId = appChatId
      if (context.action) event.action = context.action
      if (context.decisionSource) event.decisionSource = context.decisionSource
      this.deps.publishApprovalRunEvent(event)
    } catch (err) {
      this.deps.log(
        `[ApprovalService] approval run-event publish failed for ${approvalId}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}

/** Helper for the timeout callback to surface the auto-deny event +
 * dispatch through the service. Lives outside the class so the
 * scheduler's onTimeout closure can be defined cleanly. */
export async function handleApprovalTimeout(
  service: ApprovalService,
  reason: ApprovalTimeoutReason,
  helpers: {
    appendDurableRunEventForRoute: (
      provider: ProviderId,
      route: AgentRunRoute | null | undefined,
      kind: RunEventKind,
      phase: RunEventPhase,
      title: string,
      payload?: unknown
    ) => void
    log: (line: string) => void
    sendTimeoutToRenderer: (snapshot: {
      approvalId: string
      appliedMs: number
      source: ApprovalTimeoutReason['source']
    }) => void
  }
): Promise<void> {
  helpers.log(
    `[ApprovalTimeout] approvalId=${reason.approvalId} auto-deny after ${reason.appliedMs}ms (source=${reason.source})`
  )
  const route = service.lookupRoute(reason.approvalId)
  if (route?.appRunId) {
    try {
      helpers.appendDurableRunEventForRoute(
        route.provider,
        { appRunId: route.appRunId, appChatId: route.appChatId },
        'approval_timer_timeout',
        'control',
        `Approval timer fired after ${reason.appliedMs}ms`,
        {
          approvalId: reason.approvalId,
          appliedMs: reason.appliedMs,
          source: reason.source
        }
      )
    } catch {
      // Run may have been cleared; auto-deny still proceeds.
    }
  }
  try {
    helpers.sendTimeoutToRenderer({
      approvalId: reason.approvalId,
      appliedMs: reason.appliedMs,
      source: reason.source
    })
  } catch {
    // Window may be destroyed; auto-deny still proceeds.
  }
  try {
    await service.resolve(reason.approvalId, 'decline', {
      decisionSource: 'system',
      extraMetadata: {
        autoDeniedByTimeout: true,
        timeoutMs: reason.appliedMs,
        timeoutSource: reason.source
      }
    })
  } catch (err) {
    helpers.log(
      `[ApprovalTimeout] decline path threw for approvalId=${reason.approvalId}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
