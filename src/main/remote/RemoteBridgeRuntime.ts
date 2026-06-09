/*
 * RemoteBridgeRuntime — wires the taskwraith-e2ee-v1 transport into the
 * surviving bridge domain layer. Owns the full Mac-side lifecycle:
 *
 *   pairing   `beginPairing()` mints a session id, opens the relay socket
 *             (role mac), and returns the QR bootstrap payload in the exact
 *             `{ ok, bootstrap: { pairingSessionID, bootstrapPayload } }`
 *             shape PairingPage renders. The handshake confirm code surfaces
 *             via `onPairingPrompt` (→ the renderer's
 *             `bridge-pairing-response-received` channel) and trust is held
 *             until `finalizePairing(sessionID, userConfirmed)`.
 *
 *   outbound  Once established, a `BridgeBroadcaster` + `BridgeRunEventSink`
 *             are built with `notify: (m, p) => transport.send(m, p)` — the
 *             projections/run events flow inside encrypted envelopes instead
 *             of the removed Swift daemon. Every (re)establish re-seeds with
 *             `broadcastSnapshot()` (envelopes are idempotent by envelopeId,
 *             so over-sending after a replay-gap is harmless).
 *
 *   inbound   `bridge.requestActionAck` / `bridge.requestPrepareStartTurnAck`
 *             app messages route through the SAME `BridgeActionRouter.route`
 *             policy spine the daemon used (decode → expiry/replay →
 *             allowlist → audit → executor). The audit `pairID` is bound to
 *             the *pinned identity key* — a client-supplied pairID is
 *             overwritten, so a compromised phone can't impersonate another
 *             pairing. Results return as `bridge.ack { requestId, ... }`.
 *
 * Electron-free by construction (everything injected) so the fake-iPhone e2e
 * can drive the real runtime + real relay without booting Electron.
 */

import { createHash, randomUUID } from 'crypto'
import {
  BridgeBroadcaster,
  type BridgeBroadcasterAllowlist,
  type BridgeBroadcasterAppStore,
  type BridgeBroadcasterProjectionSource
} from '../BridgeBroadcaster'
import { makeBridgeRunEventSink } from '../BridgeRunEventSink'
import type { RunEventSink } from '../RunEventBus'
import { E2EE_PROTOCOL, type PairingBootstrapPayload } from '../../shared/e2ee/protocol'
import { b64, type KeyPair } from '../../shared/e2ee/keys'
import { RemoteTransportClient, type TransportSocketFactory } from './RemoteTransportClient'

/** Pushed to the renderer's `bridge-pairing-response-received` listener
 * (IncomingPairingPrompt) when the iPhone's clientAuth arrives. */
export interface RemotePairingPrompt {
  sessionID: string
  controllerDisplayName: string
  code: string
}

export interface BeginPairingResult {
  ok: true
  bootstrap: {
    pairingSessionID: string
    bootstrapPayload: PairingBootstrapPayload
  }
}

export interface FinalizePairingResult {
  ok: boolean
  paired?: boolean
  error?: string
}

/** Inbound methods the runtime forwards to the action router. Everything
 * else is rejected (audited surface stays exactly the router's). */
const ROUTABLE_METHODS = new Set(['bridge.requestActionAck', 'bridge.requestPrepareStartTurnAck'])

export interface RemoteBridgeRuntimeOptions {
  relayUrl: string
  /** Shown on the iPhone's pairing sheet ("Pair with <macDisplayName>"). */
  macDisplayName: string
  identity: KeyPair
  socketFactory: TransportSocketFactory
  appStore: BridgeBroadcasterAppStore
  allowlist?: BridgeBroadcasterAllowlist
  projectionSource: BridgeBroadcasterProjectionSource
  /** The policy spine — `BridgeActionRouter.route` in production. */
  routeAction: (method: string, params: unknown) => Promise<unknown>
  /** `runEventBus.subscribe` in production; returns the unsubscribe fn. */
  subscribeRunEvents: (sink: RunEventSink) => () => void
  onPairingPrompt: (prompt: RemotePairingPrompt) => void
  /** Keeps index.ts's `bridgeBroadcaster`/`bridgeBroadcasterRef` (the mutation
   * hooks' nullable refs) in sync with the runtime-owned instance. */
  onBroadcasterChange?: (broadcaster: BridgeBroadcaster | null) => void
  /** Pairing QR validity window; the un-paired socket is torn down after. */
  pairingWindowMs?: number
  log?: (line: string) => void
}

const DEFAULT_PAIRING_WINDOW_MS = 5 * 60 * 1000

export class RemoteBridgeRuntime {
  private readonly opts: RemoteBridgeRuntimeOptions
  private client: RemoteTransportClient | null = null
  private broadcaster: BridgeBroadcaster | null = null
  private runSinkUnsub: (() => void) | null = null
  private controllerDisplayName = 'iOS device'
  private pairingExpiryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: RemoteBridgeRuntimeOptions) {
    this.opts = options
  }

  /** Mint a fresh pairing session + QR bootstrap. Replaces any previous
   * session (PairingPage's Refresh = explicit re-pair). */
  beginPairing(controllerDisplayName?: string): BeginPairingResult {
    this.teardownClient()
    this.controllerDisplayName = controllerDisplayName?.trim() || 'iOS device'
    const sessionId = randomUUID()
    const windowMs = this.opts.pairingWindowMs ?? DEFAULT_PAIRING_WINDOW_MS

    const client = new RemoteTransportClient({
      identityKeyPair: this.opts.identity,
      socketFactory: this.opts.socketFactory,
      onConfirmCode: (sessionID, code) =>
        this.opts.onPairingPrompt({
          sessionID,
          controllerDisplayName: this.controllerDisplayName,
          code
        }),
      onMessage: (method, params) => void this.handleInbound(method, params),
      onEstablished: () => this.onEstablished(),
      onConnectionChange: (connected) =>
        this.opts.log?.(`[remote-bridge] transport ${connected ? 'established' : 'down'}`),
      log: this.opts.log
    })
    this.client = client
    client.beginSession(this.opts.relayUrl, sessionId)

    // A QR that was never scanned shouldn't leave a socket parked on the
    // relay forever. Established sessions are exempt (the client owns
    // reconnect from there).
    this.pairingExpiryTimer = setTimeout(() => {
      if (this.client === client && !client.isConnected && !client.trustedPeerIdentityRaw()) {
        this.opts.log?.('[remote-bridge] pairing window expired — closing session')
        this.teardownClient()
      }
    }, windowMs)
    this.pairingExpiryTimer.unref?.()

    return {
      ok: true,
      bootstrap: {
        pairingSessionID: sessionId,
        bootstrapPayload: {
          v: 1,
          protocol: E2EE_PROTOCOL,
          relayUrl: this.opts.relayUrl,
          sessionId,
          macIdentityPubKey: b64.encode(client.macIdentityRaw()),
          macDisplayName: this.opts.macDisplayName,
          expiresAt: Date.now() + windowMs
        }
      }
    }
  }

  /** Resolve the held trust decision for the prompt the user just answered. */
  finalizePairing(sessionID: string, userConfirmed: boolean): FinalizePairingResult {
    if (!this.client || this.client.currentSessionId !== sessionID) {
      return { ok: false, error: 'Pairing session is no longer active.' }
    }
    this.client.finalizePairing(userConfirmed)
    if (!userConfirmed) {
      // Declined → the handshake fails on the phone; drop our side too so a
      // fresh QR is required for the next attempt.
      this.teardownClient()
      return { ok: true, paired: false }
    }
    return { ok: true, paired: true }
  }

  get isEstablished(): boolean {
    return this.client?.isConnected ?? false
  }

  dispose(): void {
    this.teardownClient()
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private send(method: string, params?: unknown): void {
    this.client?.send(method, params)
  }

  private onEstablished(): void {
    if (!this.broadcaster) {
      // Built once (throttle state survives reconnects); `notify` closes over
      // `this.send` so it tracks client re-creation transparently.
      this.broadcaster = new BridgeBroadcaster({
        daemon: { notify: (method, params) => this.send(method, params) },
        appStore: this.opts.appStore,
        allowlist: this.opts.allowlist,
        projectionSource: this.opts.projectionSource,
        log: this.opts.log
      })
      this.opts.onBroadcasterChange?.(this.broadcaster)
    }
    if (!this.runSinkUnsub) {
      this.runSinkUnsub = this.opts.subscribeRunEvents(
        makeBridgeRunEventSink({
          notifier: { notify: (method, params) => this.send(method, params) },
          log: this.opts.log
        })
      )
    }
    // Re-seed on every (re)establish: covers both first pairing and a
    // replay-buffer gap after a long drop. Envelopes are idempotent.
    this.broadcaster.broadcastSnapshot()
  }

  /** Stable per-pairing audit id derived from the pinned iPhone key. */
  private trustedPairId(): string | null {
    const raw = this.client?.trustedPeerIdentityRaw()
    if (!raw) return null
    return `iphone-${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`
  }

  private async handleInbound(method: string, params: unknown): Promise<void> {
    const dict = params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
    const requestId = typeof dict.requestId === 'string' ? dict.requestId : null
    if (!ROUTABLE_METHODS.has(method)) {
      this.opts.log?.(`[remote-bridge] dropped unsupported inbound method "${method}"`)
      if (requestId) {
        this.send('bridge.ack', {
          requestId,
          method,
          ok: false,
          error: `Unsupported method "${method}"`
        })
      }
      return
    }
    const pairID = this.trustedPairId()
    if (!pairID) {
      // Unreachable in practice (app messages only flow post-establish), but
      // never route an action without a bound identity.
      this.opts.log?.(`[remote-bridge] dropped "${method}" — no trusted pairing`)
      return
    }
    try {
      // Identity binding: overwrite any client-supplied pairID with the one
      // derived from the pinned key.
      const result = await this.opts.routeAction(method, { ...dict, pairID })
      this.send('bridge.ack', { requestId, method, ok: true, result })
    } catch (err) {
      this.send('bridge.ack', {
        requestId,
        method,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  private teardownClient(): void {
    if (this.pairingExpiryTimer) {
      clearTimeout(this.pairingExpiryTimer)
      this.pairingExpiryTimer = null
    }
    this.runSinkUnsub?.()
    this.runSinkUnsub = null
    if (this.broadcaster) {
      this.broadcaster = null
      this.opts.onBroadcasterChange?.(null)
    }
    this.client?.dispose()
    this.client = null
  }
}
