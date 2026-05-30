import type { BridgeApnsPushResult, BridgeRemoteAttentionPushPayload } from './BridgeApnsPusher'
import type { BridgeApnsTokenStore } from './BridgeApnsTokenStore'

export interface RemoteAttentionApnsFanoutDeps {
  getTokenStore: () => BridgeApnsTokenStore | null
  getPusher: () => unknown
  isUserAtDesktop: () => boolean
  log?: (line: string) => void
  now?: () => number
  coalesceMs?: number
}

type Pushable = {
  pushRemoteAttentionToToken?: (
    deviceTokenHex: string,
    env: 'production' | 'sandbox',
    payload: BridgeRemoteAttentionPushPayload
  ) => Promise<BridgeApnsPushResult>
}

const DEFAULT_COALESCE_MS = 30_000

export class RemoteAttentionApnsFanout {
  private readonly deps: RemoteAttentionApnsFanoutDeps
  private readonly log: (line: string) => void
  private readonly now: () => number
  private readonly coalesceMs: number
  private readonly lastPushByKey = new Map<string, number>()

  constructor(deps: RemoteAttentionApnsFanoutDeps) {
    this.deps = deps
    this.log = deps.log ?? (() => {})
    this.now = deps.now ?? (() => Date.now())
    this.coalesceMs = deps.coalesceMs ?? DEFAULT_COALESCE_MS
  }

  notify(input: Omit<BridgeRemoteAttentionPushPayload, 'pairID'>): void {
    const tokenStore = this.deps.getTokenStore()
    const pusher = this.deps.getPusher() as Pushable | null
    if (!tokenStore || !pusher) return
    const tokens = tokenStore.list()
    if (tokens.length === 0) return
    if (this.deps.isUserAtDesktop()) {
      this.log(`[APNs] skipping remote attention push reason=${input.reason} — user is at desktop`)
      return
    }
    const canPushAttention = typeof pusher.pushRemoteAttentionToToken === 'function'
    if (!canPushAttention) return

    for (const entry of tokens) {
      const key = coalesceKey(entry.pairID, input)
      const now = this.now()
      const last = this.lastPushByKey.get(key)
      if (last !== undefined && now - last < this.coalesceMs) {
        this.log(`[APNs] coalesced remote attention push key=${key}`)
        continue
      }
      this.lastPushByKey.set(key, now)
      void (async () => {
        try {
          const payload = sanitizePayload(entry.pairID, input)
          const result = await pusher.pushRemoteAttentionToToken!(
            entry.deviceToken,
            entry.env,
            payload
          )
          if (!result.delivered) {
            const reason = result.reason ?? ''
            if (/^Unregistered$|^BadDeviceToken$/i.test(reason)) {
              this.log(`[APNs] pruning dead token for pairID=${entry.pairID}: ${reason}`)
              tokenStore.remove(entry.pairID)
            } else if (reason && reason !== 'noop') {
              this.log(
                `[APNs] remote attention push not delivered to pairID=${entry.pairID}: ${reason}`
              )
            }
          }
        } catch (err) {
          this.log(
            `[APNs] remote attention push threw for pairID=${entry.pairID}: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      })()
    }
  }
}

function coalesceKey(
  pairID: string,
  input: Omit<BridgeRemoteAttentionPushPayload, 'pairID'>
): string {
  return [pairID, input.threadId ?? '', input.reason].join('\u0000')
}

function sanitizePayload(
  pairID: string,
  input: Omit<BridgeRemoteAttentionPushPayload, 'pairID'>
): BridgeRemoteAttentionPushPayload {
  return {
    pairID,
    reason: input.reason,
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    runId: input.runId,
    approvalId: input.approvalId,
    questionId: input.questionId,
    wakeupId: input.wakeupId,
    taskId: input.taskId,
    projectionKind: input.projectionKind,
    generatedAt: input.generatedAt
  }
}
