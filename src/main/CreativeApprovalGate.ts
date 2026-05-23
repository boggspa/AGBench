import { randomUUID } from 'node:crypto'

/**
 * Phase K3 — Approval gate for creative-app actions that mutate state.
 *
 * Provides a single primitive `requestApproval(className, details)` that
 * the main-process MCP executors call before dispatching to the Swift
 * daemon. The gate:
 *
 *  1. Checks the session-class approval cache (K4 design choice — see
 *     the AskUserQuestion answers from the K-phase kickoff: "Approve
 *     once, allow class for session"). If the class has been previously
 *     approved this session, the call resolves immediately as approved.
 *
 *  2. Otherwise, broadcasts a `creative-action:request` IPC event to the
 *     renderer carrying a request id + the action class + a human-
 *     readable preview struct. The renderer renders an approval modal
 *     and posts back via `creative-action:decide`.
 *
 *  3. On approval, optionally adds the class to the session cache for
 *     subsequent zero-prompt invocations. On rejection or timeout, the
 *     class stays uncached.
 *
 * The cache is intentionally session-scoped (Map at module load) — it
 * resets on app restart so a long-lived approval can't outlive the
 * user's intent. There is no persistent allowlist by design; if the
 * user wants permanent trust, they edit settings.json explicitly.
 *
 * Timeout: 5 minutes from broadcast. Past that, the request resolves
 * as rejected with a `timeout` reason so the LLM sees a clean refusal
 * instead of hanging the MCP call indefinitely.
 */

export interface CreativeApprovalRequestDetails {
  /**
   * Human-readable summary shown at the top of the approval modal.
   * E.g. "Send your edit to Final Cut Pro".
   */
  title: string
  /**
   * Longer description rendered below the title — what the action
   * will do, what artifacts it produces, which app receives it.
   */
  description: string
  /**
   * Optional file path the action will produce or operate on. Surfaced
   * inline so the user can double-check the path before approving.
   */
  filePath?: string
  /**
   * Target app's bundle id, where applicable. E.g. `com.apple.FinalCut`.
   * Surfaced so the user can verify they're approving for the right app.
   */
  targetBundleId?: string
  /**
   * Optional script or payload preview. Long strings get a max-height
   * scroll container in the modal. Useful for AppleScript (K4) and
   * Blender Python (K5) where the agent's generated text deserves a
   * look before execution.
   */
  payloadPreview?: string
}

export type CreativeApprovalDecision =
  | { approved: true; rememberForSession: boolean }
  | { approved: false; reason: 'user-rejected' | 'timeout' | 'cache-rejected' }

export interface CreativeApprovalRequestBroadcast {
  requestId: string
  className: string
  details: CreativeApprovalRequestDetails
}

export interface CreativeApprovalGateDeps {
  /**
   * Broadcast the pending request to every BrowserWindow's renderer.
   * Production wiring: `mainWindow.webContents.send('creative-action:request', payload)`.
   * Tests pass a fake to avoid pulling in Electron.
   */
  broadcastRequest: (request: CreativeApprovalRequestBroadcast) => void
  /**
   * Optional injection for the timeout duration. Default 5 minutes;
   * tests pass shorter values to keep them snappy.
   */
  timeoutMs?: number
  /**
   * Optional clock injection for deterministic tests.
   */
  now?: () => number
}

type PendingResolver = (decision: CreativeApprovalDecision) => void

interface PendingEntry {
  resolve: PendingResolver
  className: string
  timer: ReturnType<typeof setTimeout> | null
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

export class CreativeApprovalGate {
  private readonly deps: CreativeApprovalGateDeps
  private readonly pending = new Map<string, PendingEntry>()
  /**
   * Session-class approval cache. Once a className enters this set, any
   * subsequent `requestApproval(className, ...)` call resolves
   * immediately as approved without broadcasting to the renderer.
   * Cleared via `clearSessionApprovals()` (renderer can offer a "forget
   * all approvals" button if desired).
   */
  private readonly sessionApprovedClasses = new Set<string>()

  constructor(deps: CreativeApprovalGateDeps) {
    this.deps = deps
  }

  /**
   * Snapshot of currently-approved classes. Useful for debug surfaces
   * and tests. Returns a sorted list for stable comparison.
   */
  approvedClassesSnapshot(): string[] {
    return [...this.sessionApprovedClasses].sort()
  }

  /**
   * Reset the session-class approval cache. Called on app shutdown
   * (implicitly, via process death) and exposed for tests + an
   * eventual "Forget all approvals" UI affordance.
   */
  clearSessionApprovals(): void {
    this.sessionApprovedClasses.clear()
  }

  /**
   * Submit a renderer-side decision. Resolves the pending promise that
   * `requestApproval` is awaiting. No-op (with a warn) if the request
   * id is unknown — happens naturally after timeout / app restart.
   */
  resolveApproval(
    requestId: string,
    decision: {
      approved: boolean
      rememberForSession?: boolean
    }
  ): void {
    const entry = this.pending.get(requestId)
    if (!entry) {
      console.warn(`[CreativeApprovalGate] resolveApproval: unknown requestId ${requestId}`)
      return
    }
    this.pending.delete(requestId)
    if (entry.timer) clearTimeout(entry.timer)
    if (decision.approved) {
      if (decision.rememberForSession) {
        this.sessionApprovedClasses.add(entry.className)
      }
      entry.resolve({ approved: true, rememberForSession: Boolean(decision.rememberForSession) })
    } else {
      entry.resolve({ approved: false, reason: 'user-rejected' })
    }
  }

  /**
   * Ask the user (via the renderer) to approve an action of `className`.
   * Returns a decision once the renderer responds, the timeout fires,
   * or the session cache short-circuits.
   *
   * The `className` is the granularity at which approvals are cached.
   * Examples:
   *   - `fcp.import-fcpxml`  — K3 import to FCP
   *   - `applescript:fcp.open-project`  — K4 named-script class
   *   - `blender:render-still`  — K5 named-task class
   *   - `applescript:raw`  — K4 raw script (never cached)
   *
   * Choose className carefully — a too-broad class invites accidental
   * over-trust ("approve all AppleScript" is dangerous).
   */
  async requestApproval(
    className: string,
    details: CreativeApprovalRequestDetails
  ): Promise<CreativeApprovalDecision> {
    if (this.sessionApprovedClasses.has(className)) {
      return { approved: true, rememberForSession: true }
    }
    const requestId = randomUUID()
    const timeoutMs = this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    return new Promise<CreativeApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(requestId)) {
          resolve({ approved: false, reason: 'timeout' })
        }
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(requestId, { resolve, className, timer })
      try {
        this.deps.broadcastRequest({ requestId, className, details })
      } catch (err) {
        // Broadcast failed (no renderer attached, etc). Fail closed —
        // the agent's action does not proceed.
        if (this.pending.delete(requestId)) {
          clearTimeout(timer)
          console.error(
            `[CreativeApprovalGate] broadcast failed for class ${className}:`,
            (err as Error).message
          )
          resolve({ approved: false, reason: 'cache-rejected' })
        }
      }
    })
  }
}
