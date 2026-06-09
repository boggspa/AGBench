/*
 * FakeIphoneClient — a Node stand-in for the future SwiftUI companion.
 *
 * Deliberately built from ONLY `src/shared/e2ee` + raw `ws`: if this client
 * can pair, decrypt projections, send actions, and survive drops using
 * nothing but the shared protocol library and a WebSocket, then the
 * CryptoKit port has everything it needs (raw-32B keys, transcript,
 * HKDF info strings, nonce/seq discipline are all byte-compatible).
 *
 * Lifecycle mirrors the real phone:
 *   scan(bootstrap)  → validate + pin the Mac identity from the QR payload
 *   connect()        → open the relay socket (role iphone) + handshake
 *   sendAction()     → encrypted app message (BridgeActionRouter shapes)
 *   request()        → action + await the correlated `bridge.ack`
 *   dropConnection() → hard socket kill; reconnect() re-handshakes on the
 *                      SAME session (app msgIds + replay state survive)
 */

import { randomBytes } from 'crypto'
import { WebSocket } from 'ws'
import { E2eeSession } from '../../src/shared/e2ee/session'
import {
  b64,
  generateIdentityKeyPair,
  importRawEd25519PublicKey,
  type KeyPair
} from '../../src/shared/e2ee/keys'
import {
  E2EE_PROTOCOL,
  parseFrame,
  type E2eeFrame,
  type EncryptedFrame,
  type PairingBootstrapPayload
} from '../../src/shared/e2ee/protocol'
import { signResolveRequest } from '../../src/shared/e2ee/resolve'

export interface ReceivedAppMessage {
  method: string
  params: unknown
}

export interface FakeIphoneOptions {
  identity?: KeyPair
  log?: (line: string) => void
}

export class FakeIphoneClient {
  readonly identity: KeyPair
  /** Confirm code surfaced during the handshake (compare with the Mac's). */
  confirmCode: string | null = null
  /** Every decrypted app message, in delivery order. */
  readonly messages: ReceivedAppMessage[] = []
  /** Encrypted frames this client sent — lets hardening tests replay/tamper. */
  readonly sentEncFrames: EncryptedFrame[] = []

  private readonly log?: (line: string) => void
  private bootstrap: PairingBootstrapPayload | null = null
  private session: E2eeSession | null = null
  private ws: WebSocket | null = null
  private established = false
  private establishedWaiters: Array<() => void> = []
  private messageWaiters: Array<{
    predicate: (msg: ReceivedAppMessage) => boolean
    resolve: (msg: ReceivedAppMessage) => void
  }> = []
  private requestCounter = 0

  constructor(options: FakeIphoneOptions = {}) {
    this.identity = options.identity ?? generateIdentityKeyPair()
    this.log = options.log
  }

  get isEstablished(): boolean {
    return this.established
  }

  /** "Scan the QR": validate the bootstrap and pin the Mac identity. The
   * session is created once per pairing — its app-message counters survive
   * socket drops, exactly like the real phone. */
  scan(bootstrap: PairingBootstrapPayload): void {
    if (bootstrap.v !== 1 || bootstrap.protocol !== E2EE_PROTOCOL) {
      throw new Error(`unsupported bootstrap protocol "${bootstrap.protocol}"`)
    }
    if (Date.now() > bootstrap.expiresAt) throw new Error('bootstrap expired')
    this.createSession(bootstrap)
  }

  /** Trusted reconnect (T5): ask the relay's resolve directory where the
   * paired Mac is currently listening — the real phone does this from a
   * silent push or app foreground, using identities persisted in Keychain.
   * Throws on a 404 (not registered / not an allowed peer). */
  async resolveAndScan(relayUrl: string, macIdentityPubKey: string): Promise<void> {
    const request = signResolveRequest(this.identity, {
      macIdentityPubKey,
      nonce: b64.encode(randomBytes(16)),
      issuedAt: Date.now()
    })
    const httpBase = relayUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/$/, '')
    const response = await fetch(`${httpBase}/v1/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    })
    if (!response.ok) throw new Error(`resolve failed (${response.status})`)
    const body = (await response.json()) as { ok: boolean; sessionId?: string }
    if (!body.ok || !body.sessionId) throw new Error('resolve returned no session')
    this.createSession({
      v: 1,
      protocol: E2EE_PROTOCOL,
      relayUrl,
      sessionId: body.sessionId,
      macIdentityPubKey,
      macDisplayName: '',
      expiresAt: Number.MAX_SAFE_INTEGER
    })
  }

  private createSession(bootstrap: PairingBootstrapPayload): void {
    this.bootstrap = bootstrap
    this.session = new E2eeSession({
      role: 'iphone',
      sessionId: bootstrap.sessionId,
      identityKeyPair: this.identity,
      peerIdentityPublicKey: importRawEd25519PublicKey(b64.decode(bootstrap.macIdentityPubKey)),
      send: (frame: E2eeFrame) => {
        if (frame.t === 'enc') this.sentEncFrames.push(frame)
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame))
      },
      onAppMessage: (method, params) => this.dispatch({ method, params }),
      onConfirmCode: (code) => {
        this.confirmCode = code
      },
      onEstablished: () => {
        this.established = true
        for (const wake of this.establishedWaiters.splice(0)) wake()
      },
      log: this.log
    })
  }

  /** Open the relay socket; the handshake starts on socket open. */
  connect(): Promise<void> {
    const bootstrap = this.bootstrap
    const session = this.session
    if (!bootstrap || !session) throw new Error('scan() a bootstrap first')
    this.established = false
    return new Promise<void>((resolve, reject) => {
      const url = `${bootstrap.relayUrl.replace(/\/$/, '')}/v1/session/${bootstrap.sessionId}`
      const ws = new WebSocket(url, {
        headers: { 'x-taskwraith-role': 'iphone', 'x-taskwraith-protocol': E2EE_PROTOCOL }
      })
      this.ws = ws
      ws.on('open', () => {
        session.start()
        resolve()
      })
      ws.on('message', (data) => {
        const frame = parseFrame(data.toString())
        if (frame) void session.handleFrame(frame)
      })
      ws.on('error', (err) => reject(err instanceof Error ? err : new Error(String(err))))
    })
  }

  waitForEstablished(timeoutMs = 5_000): Promise<void> {
    if (this.established) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for session establishment')),
        timeoutMs
      )
      this.establishedWaiters.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /** Resolve with the first message (past or future) matching the predicate. */
  waitForMessage(
    predicate: (msg: ReceivedAppMessage) => boolean,
    timeoutMs = 5_000,
    label = 'message'
  ): Promise<ReceivedAppMessage> {
    const already = this.messages.find(predicate)
    if (already) return Promise.resolve(already)
    return new Promise<ReceivedAppMessage>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${label}`)),
        timeoutMs
      )
      this.messageWaiters.push({
        predicate,
        resolve: (msg) => {
          clearTimeout(timer)
          resolve(msg)
        }
      })
    })
  }

  /** Fire-and-forget encrypted app message. */
  sendAction(method: string, params?: unknown): void {
    if (!this.session) throw new Error('no session')
    this.session.sendApp(method, params)
  }

  /** Action + await the correlated `bridge.ack` for its requestId. */
  async request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 5_000
  ): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    const requestId = `req-${++this.requestCounter}`
    const ackPromise = this.waitForMessage(
      (msg) =>
        msg.method === 'bridge.ack' &&
        (msg.params as { requestId?: unknown })?.requestId === requestId,
      timeoutMs,
      `bridge.ack for ${requestId}`
    )
    this.sendAction(method, { ...params, requestId })
    const ack = await ackPromise
    return ack.params as { ok: boolean; result?: unknown; error?: string }
  }

  /** Re-send a previously captured encrypted frame verbatim (replay attack). */
  sendRawFrame(frame: E2eeFrame): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame))
  }

  /** Hard drop — no close handshake, like losing cellular coverage. */
  dropConnection(): void {
    this.established = false
    this.ws?.terminate()
    this.ws = null
  }

  /** Reconnect on the SAME session: fresh handshake (the Mac auto-trusts the
   * pinned identity), app msgIds continue, peer replays what we missed. */
  reconnect(): Promise<void> {
    return this.connect()
  }

  close(): void {
    this.established = false
    this.ws?.close()
    this.ws = null
  }

  private dispatch(msg: ReceivedAppMessage): void {
    this.messages.push(msg)
    const stillWaiting: typeof this.messageWaiters = []
    for (const waiter of this.messageWaiters) {
      if (waiter.predicate(msg)) waiter.resolve(msg)
      else stillWaiting.push(waiter)
    }
    this.messageWaiters = stillWaiting
  }
}
