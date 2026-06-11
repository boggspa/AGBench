/*
 * taskwraith-e2ee-v1 — the session state machine.
 *
 * Drives the handshake, the encrypted application channel, the outbound replay
 * buffer, and reconnect/resume — for BOTH endpoints (the Electron-main "mac"
 * and the iPhone / Node fake-iPhone). The caller supplies a `send(frame)` sink
 * (writes to a WebSocket) and consumes app messages via `onAppMessage`.
 *
 * Two counters (see protocol.ts):
 *   - transport `seq`: per physical connection, drives the GCM nonce, resets on
 *     reconnect (so a fresh handshake → fresh keys → nonces never repeat).
 *   - app `msgId`: monotonic across reconnects, lives in the plaintext, drives
 *     the replay buffer + acks.
 */

import { randomBytes, type KeyObject } from 'crypto'
import { open, seal } from './cipher'
import {
  computeTranscriptHash,
  confirmCodeFromTranscript,
  deriveSessionKeys,
  type SessionKeys
} from './keyschedule'
import {
  b64,
  exportRawEd25519PublicKey,
  exportRawX25519PublicKey,
  generateEphemeralKeyPair,
  importRawEd25519PublicKey,
  importRawX25519PublicKey,
  signEd25519,
  verifyEd25519,
  type KeyPair
} from './keys'
import {
  E2EE_PROTOCOL,
  recvDirectionForRole,
  sendDirectionForRole,
  TRANSPORT_PING,
  TRANSPORT_PONG,
  TRANSPORT_RESUME,
  type AppMessage,
  type E2eeFrame,
  type EncryptedFrame,
  type Role
} from './protocol'

const NONCE_BYTES = 16
const DEFAULT_BUFFER_MAX_MSGS = 500
const DEFAULT_BUFFER_MAX_BYTES = 10 * 1024 * 1024

export interface E2eeSessionOptions {
  role: Role
  sessionId: string
  identityKeyPair: KeyPair
  /** iPhone knows the Mac identity key from the QR bootstrap; Mac learns the
   * iPhone's from clientAuth (and pins it on trust). */
  peerIdentityPublicKey?: KeyObject
  send: (frame: E2eeFrame) => void
  onAppMessage: (method: string, params: unknown) => void
  /** Surfaced on both sides for the user to compare during first pairing. */
  onConfirmCode?: (code: string) => void
  onEstablished?: () => void
  onError?: (err: Error) => void
  /**
   * Decide whether to trust the peer's identity key (Mac side). Returns true to
   * complete the handshake. Default = trust (used by reconnect + tests); the
   * real Mac client supplies a promise that resolves when the user taps confirm.
   */
  trustPeer?: (peerIdentityRaw: Buffer, confirmCode: string) => boolean | Promise<boolean>
  bufferMaxMsgs?: number
  bufferMaxBytes?: number
  log?: (line: string) => void
}

interface BufferedAppMessage {
  msgId: number
  plaintext: Buffer
}

export class E2eeSession {
  private readonly opts: E2eeSessionOptions
  private readonly role: Role
  private peerIdentityPublicKey: KeyObject | null

  // Per-connection handshake state (reset on reconnect).
  private ephemeral: KeyPair | null = null
  private myNonce: Buffer | null = null
  private keys: SessionKeys | null = null
  private transcriptHash: Buffer | null = null
  private clientEphB64 = ''
  private serverEphB64 = ''
  private clientNonceB64 = ''
  private serverNonceB64 = ''
  private established = false

  // Per-connection transport counters.
  private sendSeq = 0
  private lastRecvSeq = -1

  // Resume gating (per connection). After (re)establish, NEW outbound app
  // messages are buffered-but-held until the peer's TRANSPORT_RESUME tells us
  // its high-water msgId — otherwise fresh messages (higher msgIds) would
  // outrun the replay of buffered ones and the peer's monotonic msgId dedup
  // would silently discard the replays. The flush then sends everything
  // unacked in msgId order. `peerResumeReceived` tolerates the synchronous-
  // transport case where the peer's resume arrives BEFORE our own
  // markEstablished has run. CryptoKit port note: the iOS side must mirror
  // this hold-until-resume rule.
  private awaitingPeerResume = false
  private peerResumeReceived = false
  private peerResumeLastAcked = 0

  // Cross-reconnect app-message state.
  private nextOutboundMsgId = 1
  private lastDeliveredInboundMsgId = 0
  /** Random per-SESSION-OBJECT token sent with transport.resume. A peer
   * whose epoch CHANGES between resumes is a fresh process (app relaunch)
   * with restarted msgId counters — the receiver must reset its inbound
   * dedup watermark or every new message drops as a "duplicate". A peer
   * resuming with the SAME epoch keeps full replay semantics. */
  private readonly localEpoch = randomBytes(8).toString('hex')
  private peerEpoch: string | null = null
  private replayBuffer: BufferedAppMessage[] = []
  private replayBytes = 0

  constructor(options: E2eeSessionOptions) {
    this.opts = options
    this.role = options.role
    this.peerIdentityPublicKey = options.peerIdentityPublicKey ?? null
  }

  get isEstablished(): boolean {
    return this.established
  }

  /** Begin (or restart, after reconnect) the handshake. */
  start(): void {
    this.resetConnectionState()
    this.ephemeral = generateEphemeralKeyPair()
    this.myNonce = randomBytes(NONCE_BYTES)
    if (this.role === 'iphone') {
      this.clientEphB64 = b64.encode(exportRawX25519PublicKey(this.ephemeral.publicKey))
      this.clientNonceB64 = b64.encode(this.myNonce)
      this.opts.send({
        t: 'clientHello',
        protocol: E2EE_PROTOCOL,
        sessionId: this.opts.sessionId,
        role: 'iphone',
        ephemeralPubKey: this.clientEphB64,
        nonce: this.clientNonceB64
      })
    }
    // Mac waits for clientHello.
  }

  /** Tear down the encrypted channel + re-run the handshake (keeps app state). */
  reconnect(): void {
    this.start()
  }

  private resetConnectionState(): void {
    this.ephemeral = null
    this.myNonce = null
    this.keys = null
    this.transcriptHash = null
    this.clientEphB64 = ''
    this.serverEphB64 = ''
    this.clientNonceB64 = ''
    this.serverNonceB64 = ''
    this.established = false
    this.sendSeq = 0
    this.lastRecvSeq = -1
    this.awaitingPeerResume = false
    this.peerResumeReceived = false
    this.peerResumeLastAcked = 0
  }

  async handleFrame(frame: E2eeFrame): Promise<void> {
    try {
      switch (frame.t) {
        case 'clientHello':
          if (this.role === 'mac') this.onClientHello(frame.ephemeralPubKey, frame.nonce)
          return
        case 'serverHello':
          if (this.role === 'iphone')
            this.onServerHello(frame.ephemeralPubKey, frame.nonce, frame.macIdentityPubKey)
          return
        case 'clientAuth':
          if (this.role === 'mac')
            await this.onClientAuth(frame.iphoneIdentityPubKey, frame.confirmCode, frame.transcriptSig)
          return
        case 'serverAuth':
          if (this.role === 'iphone') this.onServerAuth(frame.transcriptSig)
          return
        case 'enc':
          this.onEncrypted(frame)
          return
      }
    } catch (err) {
      this.fail(err)
    }
  }

  private deriveKeys(): void {
    this.keys = deriveSessionKeys({
      myEphemeralPrivate: this.ephemeral!.privateKey,
      peerEphemeralPublic: importRawX25519PublicKey(
        b64.decode(this.role === 'mac' ? this.clientEphB64 : this.serverEphB64)
      ),
      clientNonce: b64.decode(this.clientNonceB64),
      serverNonce: b64.decode(this.serverNonceB64)
    })
  }

  /** Transcript binds BOTH long-lived identities (identity-splice defense):
   * computable only once the peer's identity is known — the phone after
   * serverHello, the Mac upon clientAuth. */
  private computeTranscript(macIdentityB64: string, iphoneIdentityB64: string): void {
    this.transcriptHash = computeTranscriptHash({
      sessionId: this.opts.sessionId,
      clientEphemeralPubKeyB64: this.clientEphB64,
      serverEphemeralPubKeyB64: this.serverEphB64,
      clientNonceB64: this.clientNonceB64,
      serverNonceB64: this.serverNonceB64,
      macIdentityPubKeyB64: macIdentityB64,
      iphoneIdentityPubKeyB64: iphoneIdentityB64
    })
  }

  private onClientHello(clientEphB64: string, clientNonceB64: string): void {
    // A clientHello ALWAYS begins a fresh handshake. When the relay keeps the
    // Mac's socket alive across an iPhone drop/reconnect, this session object
    // still holds the previous connection's keys + transport counters — left
    // in place, the old lastRecvSeq would discard every frame of the new
    // connection (seq restarts at 0) and the old ephemeral would be reused.
    // Reset per-connection state + mint a fresh ephemeral; app msgIds and the
    // replay buffer survive by design (the dual-counter scheme). A forged
    // clientHello can only force a re-handshake it cannot complete (the
    // transcript signature still has to verify against the pinned identity),
    // which is the same DoS power the relay already holds.
    this.resetConnectionState()
    this.ephemeral = generateEphemeralKeyPair()
    this.myNonce = randomBytes(NONCE_BYTES)
    this.clientEphB64 = clientEphB64
    this.clientNonceB64 = clientNonceB64
    this.serverEphB64 = b64.encode(exportRawX25519PublicKey(this.ephemeral!.publicKey))
    this.serverNonceB64 = b64.encode(this.myNonce!)
    // Keys derive at hello; the TRANSCRIPT now waits for clientAuth (it
    // binds the iPhone identity, which arrives there).
    this.deriveKeys()
    this.opts.send({
      t: 'serverHello',
      protocol: E2EE_PROTOCOL,
      sessionId: this.opts.sessionId,
      ephemeralPubKey: this.serverEphB64,
      nonce: this.serverNonceB64,
      macIdentityPubKey: b64.encode(exportRawEd25519PublicKey(this.opts.identityKeyPair.publicKey))
    })
  }

  private onServerHello(serverEphB64: string, serverNonceB64: string, macIdentityB64: string): void {
    this.serverEphB64 = serverEphB64
    this.serverNonceB64 = serverNonceB64
    const macIdentity = importRawEd25519PublicKey(b64.decode(macIdentityB64))
    if (this.peerIdentityPublicKey) {
      // Trust-on-reconnect: the bootstrap-pinned Mac key must match.
      const known = exportRawEd25519PublicKey(this.peerIdentityPublicKey)
      if (!known.equals(b64.decode(macIdentityB64))) {
        throw new Error('Mac identity key mismatch')
      }
    } else {
      this.peerIdentityPublicKey = macIdentity
    }
    this.deriveKeys()
    this.computeTranscript(
      macIdentityB64,
      b64.encode(exportRawEd25519PublicKey(this.opts.identityKeyPair.publicKey))
    )
    const confirmCode = confirmCodeFromTranscript(this.transcriptHash!)
    this.opts.onConfirmCode?.(confirmCode)
    const sig = signEd25519(this.opts.identityKeyPair.privateKey, this.transcriptHash!)
    this.opts.send({
      t: 'clientAuth',
      sessionId: this.opts.sessionId,
      iphoneIdentityPubKey: b64.encode(
        exportRawEd25519PublicKey(this.opts.identityKeyPair.publicKey)
      ),
      confirmCode,
      transcriptSig: b64.encode(sig)
    })
  }

  private async onClientAuth(
    iphoneIdentityB64: string,
    confirmCode: string,
    transcriptSigB64: string
  ): Promise<void> {
    if (!this.keys) throw new Error('clientAuth before key derivation')
    // Bind the CLAIMED iPhone identity into the transcript before verifying:
    // a spliced identity yields a different code on the Mac's screen (user-
    // visible) and a serverAuth signature the phone rejects (automatic).
    this.computeTranscript(
      b64.encode(exportRawEd25519PublicKey(this.opts.identityKeyPair.publicKey)),
      iphoneIdentityB64
    )
    const transcriptHash = this.transcriptHash
    if (!transcriptHash) throw new Error('clientAuth before key derivation')
    const iphoneIdentity = importRawEd25519PublicKey(b64.decode(iphoneIdentityB64))
    if (!verifyEd25519(iphoneIdentity, transcriptHash, b64.decode(transcriptSigB64))) {
      throw new Error('clientAuth signature invalid')
    }
    const ourCode = confirmCodeFromTranscript(transcriptHash)
    if (ourCode !== confirmCode) throw new Error('confirm code mismatch')
    this.opts.onConfirmCode?.(ourCode)
    // Reconnect: the iPhone identity must match the pinned key.
    if (this.peerIdentityPublicKey) {
      const known = exportRawEd25519PublicKey(this.peerIdentityPublicKey)
      if (!known.equals(b64.decode(iphoneIdentityB64))) throw new Error('iPhone identity mismatch')
    }
    const trust = this.opts.trustPeer
      ? await this.opts.trustPeer(b64.decode(iphoneIdentityB64), ourCode)
      : true
    if (!trust) throw new Error('peer not trusted')
    this.peerIdentityPublicKey = iphoneIdentity
    this.opts.send({
      t: 'serverAuth',
      sessionId: this.opts.sessionId,
      transcriptSig: b64.encode(signEd25519(this.opts.identityKeyPair.privateKey, transcriptHash))
    })
    this.markEstablished()
  }

  private onServerAuth(transcriptSigB64: string): void {
    if (!this.transcriptHash || !this.peerIdentityPublicKey) throw new Error('serverAuth too early')
    if (!verifyEd25519(this.peerIdentityPublicKey, this.transcriptHash, b64.decode(transcriptSigB64))) {
      throw new Error('serverAuth signature invalid')
    }
    this.markEstablished()
  }

  private markEstablished(): void {
    this.established = true
    if (this.peerResumeReceived) {
      // Synchronous transport: the peer's resume already landed mid-handshake.
      this.awaitingPeerResume = false
      this.replayUnacked(this.peerResumeLastAcked)
    } else {
      this.awaitingPeerResume = true
    }
    this.opts.onEstablished?.()
    // Tell the peer where we are so it can replay anything we missed.
    this.sendControl(TRANSPORT_RESUME, {
      lastAckedMsgId: this.lastDeliveredInboundMsgId,
      epoch: this.localEpoch
    })
  }

  // ── Sending ────────────────────────────────────────────────────────────────

  /** Send an application message (method/params); buffered for replay. While
   * awaiting the peer's post-handshake resume, messages buffer without
   * transmitting — the resume flush sends them in msgId order behind any
   * replays, preserving strict in-order app delivery. */
  sendApp(method: string, params?: unknown): void {
    if (!this.established) throw new Error('session not established')
    const msgId = this.nextOutboundMsgId++
    const plaintext = Buffer.from(JSON.stringify({ msgId, method, params } as AppMessage), 'utf8')
    this.bufferOutbound({ msgId, plaintext })
    if (!this.awaitingPeerResume) this.encryptAndSend(plaintext)
  }

  /** Transport control message (ping/pong/resume) — not buffered, no msgId. */
  private sendControl(method: string, params?: unknown): void {
    const plaintext = Buffer.from(JSON.stringify({ msgId: 0, method, params } as AppMessage), 'utf8')
    this.encryptAndSend(plaintext)
  }

  ping(): void {
    if (this.established) this.sendControl(TRANSPORT_PING)
  }

  private encryptAndSend(plaintext: Buffer): void {
    if (!this.keys) throw new Error('no keys')
    const direction = sendDirectionForRole(this.role)
    const key = direction === 'mac->iphone' ? this.keys.macToIphone : this.keys.iphoneToMac
    const seq = this.sendSeq++
    const sealed = seal(key, direction, this.opts.sessionId, seq, plaintext)
    this.opts.send({
      t: 'enc',
      sessionId: this.opts.sessionId,
      seq,
      nonce: b64.encode(sealed.nonce),
      ct: b64.encode(sealed.ct),
      tag: b64.encode(sealed.tag),
      ack: this.lastDeliveredInboundMsgId || null
    })
  }

  private bufferOutbound(entry: BufferedAppMessage): void {
    this.replayBuffer.push(entry)
    this.replayBytes += entry.plaintext.length
    const maxMsgs = this.opts.bufferMaxMsgs ?? DEFAULT_BUFFER_MAX_MSGS
    const maxBytes = this.opts.bufferMaxBytes ?? DEFAULT_BUFFER_MAX_BYTES
    while (this.replayBuffer.length > maxMsgs || this.replayBytes > maxBytes) {
      const dropped = this.replayBuffer.shift()
      if (!dropped) break
      this.replayBytes -= dropped.plaintext.length
    }
  }

  // ── Receiving ────────────────────────────────────────────────────────────────

  private onEncrypted(frame: EncryptedFrame): void {
    if (!this.keys) throw new Error('enc before established')
    // Transport-level replay/dup guard (ordered WS → strict monotonic seq).
    if (frame.seq <= this.lastRecvSeq) {
      this.opts.log?.(`[e2ee] dropped replayed seq ${frame.seq}`)
      return
    }
    const direction = recvDirectionForRole(this.role)
    const key = direction === 'mac->iphone' ? this.keys.macToIphone : this.keys.iphoneToMac
    const plaintext = open(key, direction, this.opts.sessionId, frame.seq, {
      nonce: b64.decode(frame.nonce),
      ct: b64.decode(frame.ct),
      tag: b64.decode(frame.tag)
    })
    this.lastRecvSeq = frame.seq
    // Peer's ack trims our replay buffer.
    if (typeof frame.ack === 'number') this.trimReplayBuffer(frame.ack)

    const msg = JSON.parse(plaintext.toString('utf8')) as AppMessage
    if (typeof msg.method !== 'string') return
    if (msg.method.startsWith('transport.')) {
      this.handleControl(msg)
      return
    }
    // App-level dedup (a replayed app message after reconnect).
    if (msg.msgId <= this.lastDeliveredInboundMsgId) {
      this.opts.log?.(`[e2ee] dropped duplicate app msgId ${msg.msgId}`)
      return
    }
    this.lastDeliveredInboundMsgId = msg.msgId
    this.opts.onAppMessage(msg.method, msg.params)
  }

  private handleControl(msg: AppMessage): void {
    if (msg.method === TRANSPORT_PING) {
      this.sendControl(TRANSPORT_PONG)
    } else if (msg.method === TRANSPORT_RESUME) {
      const params = msg.params as { lastAckedMsgId?: number; epoch?: string } | undefined
      const lastAcked = Number(params?.lastAckedMsgId ?? 0)
      const epoch = typeof params?.epoch === 'string' ? params.epoch : null
      // FRESH PEER EPOCH: a relaunched app is a new session object — its
      // msgId counter restarts at 1, so a long-lived listening session that
      // kept its inbound watermark across the re-handshake silently dropped
      // EVERY new message as a "duplicate app msgId" (observed live). The
      // epoch token disambiguates that from a true resume: changed epoch →
      // reset the watermark (fresh handshake keys already prevent
      // cross-epoch ciphertext replay) and drop the outbound replay buffer
      // (a memoryless peer gets state from the establish snapshot, not
      // stale replays). Same/absent epoch → full resume semantics.
      const freshPeer = epoch !== null && this.peerEpoch !== null && epoch !== this.peerEpoch
      if (epoch !== null) this.peerEpoch = epoch
      this.peerResumeReceived = true
      this.peerResumeLastAcked = lastAcked
      if (freshPeer) {
        this.lastDeliveredInboundMsgId = 0
        this.replayBuffer.length = 0
        this.replayBytes = 0
        this.awaitingPeerResume = false
        return
      }
      this.trimReplayBuffer(lastAcked)
      if (this.awaitingPeerResume) {
        this.awaitingPeerResume = false
        this.replayUnacked(lastAcked)
      } else if (this.established) {
        // Peer re-resumed mid-connection (defensive) — replay what it lacks.
        this.replayUnacked(lastAcked)
      }
    }
    // TRANSPORT_PONG: keepalive ack, nothing to do here (caller tracks liveness).
  }

  private trimReplayBuffer(ackMsgId: number): void {
    while (this.replayBuffer.length > 0 && this.replayBuffer[0].msgId <= ackMsgId) {
      const dropped = this.replayBuffer.shift()!
      this.replayBytes -= dropped.plaintext.length
    }
  }

  /** Re-send buffered app messages the peer hasn't acked (after reconnect). */
  private replayUnacked(lastAckedMsgId: number): void {
    for (const entry of this.replayBuffer) {
      if (entry.msgId > lastAckedMsgId) this.encryptAndSend(entry.plaintext)
    }
  }

  /** True when the peer's resume left a gap we can't fill (buffer evicted) — the
   * caller should resend a full snapshot. */
  hasReplayGap(lastAckedMsgId: number): boolean {
    if (lastAckedMsgId >= this.nextOutboundMsgId - 1) return false
    const oldestBuffered = this.replayBuffer[0]?.msgId
    return oldestBuffered === undefined || oldestBuffered > lastAckedMsgId + 1
  }

  private fail(err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err))
    this.opts.log?.(`[e2ee] ${error.message}`)
    this.opts.onError?.(error)
  }
}
