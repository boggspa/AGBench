/**
 * BridgeApnsPusher — Phase C5 scaffold for desktop → iPhone wake-pushes via APNs.
 *
 * The real flow (when fully wired):
 *   1. iPhone pairs with the Mac (existing Phase C2 handshake).
 *   2. iPhone registers its APNs device token via a daemon RPC and the
 *      desktop stores `{pairID → token, env}` in `BridgeApnsTokenStore`.
 *   3. Long-running agent on the Mac hits a tool call that needs user
 *      approval.
 *   4. Mac's approval flow checks: is there a paired iOS device, and is
 *      the user away from the desktop? If yes:
 *      `apnsPusher.pushApprovalNeeded(pairID, { threadId, toolCallId, ... })`
 *   5. APNs delivers a silent push (to wake the iPhone bridge client) and a
 *      regular push (lock-screen "Approval needed" with deep-link).
 *   6. iPhone reconnects to the bridge, sees the pending approval, user
 *      decides. The decision flows back through the existing
 *      `bridge.requestActionAck` round-trip (kind: 'approvalReply').
 *
 * This file ships **only the interface + a no-op default**. The real APNs
 * HTTP/2 client (talking to api.push.apple.com / sandbox) lands when:
 *   - Apple Developer credentials are wired (the .p8 token-signing key,
 *     team ID, key ID, bundle ID for the iOS companion app).
 *   - The iOS companion app exists and can register its device token.
 *
 * Until then: the interface is honored at every approval point, but
 * `NoopApnsPusher` just logs the intent. This means the codebase shape
 * is stable and adding the real pusher is a constructor swap, not a
 * sweep of call sites.
 *
 * Environment knobs:
 *   - `AGBENCH_BRIDGE_APNS=production` — use production APNs gateway when
 *     a real pusher is configured (default if APNs is enabled).
 *   - `AGBENCH_BRIDGE_APNS=sandbox` — use sandbox APNs gateway.
 *   - `AGBENCH_BRIDGE_APNS_DRY_RUN=1` — even with a real pusher, log only;
 *     don't actually hit Apple's servers. Useful for staging tests.
 */

export type BridgeApnsEnv = 'production' | 'sandbox'

export interface BridgeApprovalPushPayload {
  /** The pairing identifier of the target iPhone. */
  pairID: string
  /** Workspace the approval is for. The iOS UI uses this for navigation. */
  workspaceId: string
  /** Thread the agent is running on. */
  threadId: string
  /** The pending tool-call id; iOS will use this to match against
   * `BridgeApprovalReplyAction.toolCallId` in the user's reply. */
  toolCallId: string
  /** Short user-facing description (e.g. "Run `rm -rf /tmp/foo`?"). */
  summary: string
  /** Optional deep-link path; iOS app can use this to jump straight to the
   * approval view. Format is host-app specific. */
  deepLinkPath?: string
  /** Optional approval-timeout deadline (ms since epoch). The iOS UI can
   * show a countdown; the desktop independently auto-denies on its own
   * timer. */
  expiresAt?: number
}

export interface BridgeApnsPushResult {
  /** Whether the push was actually delivered (or attempted) to APNs. */
  delivered: boolean
  /** The Apple-side notification id when delivered. Empty string for
   * no-op pushers. */
  apnsId: string
  /** Reason for non-delivery, if `delivered` is false. */
  reason?: string
}

export interface BridgeApnsPusher {
  /** Push a "tool call needs approval" notification to a paired iOS device.
   * Returns a structured result so the caller (ApprovalService) can log
   * whether the push went out. Never throws — failed pushes are surfaced
   * via `delivered: false`. */
  pushApprovalNeeded(payload: BridgeApprovalPushPayload): Promise<BridgeApnsPushResult>

  /** Push a low-priority "state sync" silent notification. Used to nudge
   * the iPhone bridge client to reconnect when it's been backgrounded
   * (e.g. after a new pairing on a different device, or when transcript
   * events have accumulated for the device's watched chats). */
  pushSilent(pairID: string): Promise<BridgeApnsPushResult>
}

/**
 * NoopApnsPusher — the default implementation. Logs intent but never hits
 * Apple. Always returns `delivered: false` with `reason: 'noop'`. This
 * keeps the rest of the codebase wired up while the iOS companion app +
 * Apple Developer credentials are still in flight.
 */
export class NoopApnsPusher implements BridgeApnsPusher {
  private readonly log: (line: string) => void

  constructor(log?: (line: string) => void) {
    this.log = log ?? (() => {})
  }

  async pushApprovalNeeded(payload: BridgeApprovalPushPayload): Promise<BridgeApnsPushResult> {
    this.log(
      `[BridgeApnsPusher noop] would push approval pairID=${payload.pairID} ws=${payload.workspaceId} thread=${payload.threadId} tool=${payload.toolCallId} — APNs not yet configured`
    )
    return { delivered: false, apnsId: '', reason: 'noop' }
  }

  async pushSilent(pairID: string): Promise<BridgeApnsPushResult> {
    this.log(`[BridgeApnsPusher noop] would silent-push pairID=${pairID} — APNs not yet configured`)
    return { delivered: false, apnsId: '', reason: 'noop' }
  }
}

export interface BridgeApnsPusherOptions {
  /** Inject the env or read from `AGBENCH_BRIDGE_APNS`. */
  env?: BridgeApnsEnv
  /** Set true (or env: `AGBENCH_BRIDGE_APNS_DRY_RUN=1`) to log only. */
  dryRun?: boolean
  log?: (line: string) => void
}

/** Factory: returns a `NoopApnsPusher` today. When the real Http2ApnsPusher
 * lands (with credentials), the same factory will return that implementation
 * gated by env flags. The signature is stable; call sites won't need to
 * change. */
export function createBridgeApnsPusher(options: BridgeApnsPusherOptions = {}): BridgeApnsPusher {
  const log = options.log ?? (() => {})
  // Read env if not explicitly provided.
  const envVar = process.env.AGBENCH_BRIDGE_APNS
  const env: BridgeApnsEnv = options.env ?? (envVar === 'sandbox' ? 'sandbox' : 'production')
  const dryRun =
    options.dryRun ??
    (process.env.AGBENCH_BRIDGE_APNS_DRY_RUN === '1' ||
      process.env.AGBENCH_BRIDGE_APNS_DRY_RUN === 'true')

  // Today: always Noop. Once Http2ApnsPusher lands, branch here based on
  // whether `AGBENCH_BRIDGE_APNS_CREDENTIALS_PATH` (or similar) is set.
  log(
    `[BridgeApnsPusher] using NoopApnsPusher (env=${env} dryRun=${dryRun}) — real APNs client not yet configured`
  )
  return new NoopApnsPusher(log)
}
