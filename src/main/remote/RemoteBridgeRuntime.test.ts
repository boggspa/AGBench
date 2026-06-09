import { describe, it, expect, vi } from 'vitest'
import { RemoteBridgeRuntime, type RemotePairingPrompt } from './RemoteBridgeRuntime'
import type { TransportSocketFactory, TransportSocketHandlers } from './RemoteTransportClient'
import { E2eeSession } from '../../shared/e2ee/session'
import {
  b64,
  generateIdentityKeyPair,
  importRawEd25519PublicKey
} from '../../shared/e2ee/keys'
import { buildRemoteProjectionEnvelope } from '../RemoteTaskProjection'
import type { E2eeFrame } from '../../shared/e2ee/protocol'
import type { RunEventSink } from '../RunEventBus'

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 10))

const emptyAppStore = {
  getWorkspaces: () => [],
  getChats: () => [],
  getChat: () => null
}

function harness(opts: { pairingWindowMs?: number } = {}) {
  const macId = generateIdentityKeyPair()
  const iphoneId = generateIdentityKeyPair()
  const prompts: RemotePairingPrompt[] = []
  const iphoneMessages: Array<{ method: string; params: unknown }> = []
  const iphoneCodes: string[] = []
  const routed: Array<{ method: string; params: unknown }> = []
  const broadcasterChanges: Array<boolean> = []
  let capturedSink: RunEventSink | null = null
  let clientHandlers: TransportSocketHandlers | null = null
  let iphone: E2eeSession | null = null

  const socketFactory: TransportSocketFactory = (_url, _headers, handlers) => {
    clientHandlers = handlers
    setTimeout(() => handlers.onOpen(), 0)
    return {
      send: (data: string) => void iphone?.handleFrame(JSON.parse(data) as E2eeFrame),
      close: () => undefined
    }
  }

  const envelope = buildRemoteProjectionEnvelope({
    kind: 'taskCard',
    payload: { id: 'chat-1', title: 'Demo task' },
    generatedAt: '2026-06-09T00:00:00.000Z',
    envelopeId: 'remote-task:chat-1:no-run'
  })

  const runtime = new RemoteBridgeRuntime({
    relayUrl: 'ws://relay.test',
    macDisplayName: 'Test Mac',
    identity: macId,
    socketFactory,
    appStore: emptyAppStore,
    projectionSource: { listRemoteProjectionEnvelopes: () => [envelope] },
    routeAction: vi.fn(async (method: string, params: unknown) => {
      routed.push({ method, params })
      return { accepted: true, reasonCode: 'testStub' }
    }),
    subscribeRunEvents: (sink) => {
      capturedSink = sink
      return () => {
        capturedSink = null
      }
    },
    onPairingPrompt: (prompt) => prompts.push(prompt),
    onBroadcasterChange: (b) => broadcasterChanges.push(b !== null),
    pairingWindowMs: opts.pairingWindowMs
  })

  /** Scan the QR: build the iPhone session from ONLY the bootstrap payload. */
  const scanAndConnect = (bootstrap: {
    sessionId: string
    macIdentityPubKey: string
  }): void => {
    iphone = new E2eeSession({
      role: 'iphone',
      sessionId: bootstrap.sessionId,
      identityKeyPair: iphoneId,
      peerIdentityPublicKey: importRawEd25519PublicKey(b64.decode(bootstrap.macIdentityPubKey)),
      send: (frame: E2eeFrame) => clientHandlers?.onMessage(JSON.stringify(frame)),
      onAppMessage: (method, params) => iphoneMessages.push({ method, params }),
      onConfirmCode: (code) => iphoneCodes.push(code)
    })
    iphone.start()
  }

  return {
    runtime,
    scanAndConnect,
    prompts,
    iphoneMessages,
    iphoneCodes,
    routed,
    broadcasterChanges,
    sendFromIphone: (m: string, p?: unknown) => iphone!.sendApp(m, p),
    getSink: () => capturedSink
  }
}

describe('RemoteBridgeRuntime pairing', () => {
  it('returns the locked bootstrap shape with everything the phone needs', () => {
    const h = harness()
    const result = h.runtime.beginPairing('My iPad')
    expect(result.ok).toBe(true)
    const { pairingSessionID, bootstrapPayload } = result.bootstrap
    expect(bootstrapPayload.sessionId).toBe(pairingSessionID)
    expect(bootstrapPayload.v).toBe(1)
    expect(bootstrapPayload.protocol).toBe('taskwraith-e2ee-v1')
    expect(bootstrapPayload.relayUrl).toBe('ws://relay.test')
    expect(bootstrapPayload.macDisplayName).toBe('Test Mac')
    expect(b64.decode(bootstrapPayload.macIdentityPubKey)).toHaveLength(32)
    expect(bootstrapPayload.expiresAt).toBeGreaterThan(Date.now())
  })

  it('surfaces the confirm prompt and establishes after user confirm', async () => {
    const h = harness()
    const { bootstrap } = h.runtime.beginPairing('My iPad')
    await settle()
    h.scanAndConnect(bootstrap.bootstrapPayload)
    await settle()

    expect(h.prompts).toHaveLength(1)
    expect(h.prompts[0].sessionID).toBe(bootstrap.pairingSessionID)
    expect(h.prompts[0].controllerDisplayName).toBe('My iPad')
    expect(h.prompts[0].code).toMatch(/^\d{6}$/)
    expect(h.prompts[0].code).toBe(h.iphoneCodes[0])
    expect(h.runtime.isEstablished).toBe(false)

    // Wrong session id → stale prompt rejected.
    expect(h.runtime.finalizePairing('nope', true).ok).toBe(false)

    const finalize = h.runtime.finalizePairing(bootstrap.pairingSessionID, true)
    expect(finalize).toEqual({ ok: true, paired: true })
    await settle()
    expect(h.runtime.isEstablished).toBe(true)
  })

  it('declined pairing tears the session down', async () => {
    const h = harness()
    const { bootstrap } = h.runtime.beginPairing()
    await settle()
    h.scanAndConnect(bootstrap.bootstrapPayload)
    await settle()
    const finalize = h.runtime.finalizePairing(bootstrap.pairingSessionID, false)
    expect(finalize).toEqual({ ok: true, paired: false })
    await settle()
    expect(h.runtime.isEstablished).toBe(false)
    // The session is gone — finalizing again misses.
    expect(h.runtime.finalizePairing(bootstrap.pairingSessionID, true).ok).toBe(false)
  })
})

describe('RemoteBridgeRuntime established channel', () => {
  async function establish(h: ReturnType<typeof harness>) {
    const { bootstrap } = h.runtime.beginPairing('iPad')
    await settle()
    h.scanAndConnect(bootstrap.bootstrapPayload)
    await settle()
    h.runtime.finalizePairing(bootstrap.pairingSessionID, true)
    await settle()
    expect(h.runtime.isEstablished).toBe(true)
  }

  it('seeds a projection snapshot through the encrypted channel on establish', async () => {
    const h = harness()
    await establish(h)
    expect(h.broadcasterChanges).toEqual([true])
    const snapshot = h.iphoneMessages.find(
      (m) => m.method === 'bridge.broadcastRemoteProjectionSnapshot'
    )
    expect(snapshot).toBeDefined()
    const projections = (snapshot!.params as { projections: unknown[] }).projections
    expect(projections).toHaveLength(1)
    expect(projections[0]).toMatchObject({
      schemaVersion: 1,
      source: 'mac',
      kind: 'taskCard',
      payload: { id: 'chat-1' }
    })
  })

  it('forwards run events as bridge.runEvent', async () => {
    const h = harness()
    await establish(h)
    const sink = h.getSink()
    expect(sink).not.toBeNull()
    sink!.handle({
      channel: 'agent-output',
      provider: 'claude',
      payload: { kind: 'text', text: 'hello from a run' },
      publishedAt: '2026-06-09T00:00:01.000Z'
    })
    await settle()
    const runEvent = h.iphoneMessages.find((m) => m.method === 'bridge.runEvent')
    expect(runEvent).toBeDefined()
    expect(runEvent!.params).toMatchObject({
      channel: 'agent-output',
      provider: 'claude',
      payload: { text: 'hello from a run' }
    })
  })

  it('routes inbound actions with pairID bound to the pinned identity', async () => {
    const h = harness()
    await establish(h)
    h.sendFromIphone('bridge.requestActionAck', {
      requestId: 'req-1',
      pairID: 'spoofed-pair-id',
      payloadBase64: Buffer.from('{}').toString('base64'),
      payloadBytes: 2
    })
    await settle()
    expect(h.routed).toHaveLength(1)
    expect(h.routed[0].method).toBe('bridge.requestActionAck')
    const boundParams = h.routed[0].params as { pairID: string; requestId: string }
    // The spoofed pairID was overwritten with the identity-derived one.
    expect(boundParams.pairID).toMatch(/^iphone-[0-9a-f]{16}$/)
    expect(boundParams.requestId).toBe('req-1')

    const ack = h.iphoneMessages.find((m) => m.method === 'bridge.ack')
    expect(ack).toBeDefined()
    expect(ack!.params).toMatchObject({
      requestId: 'req-1',
      method: 'bridge.requestActionAck',
      ok: true,
      result: { accepted: true }
    })
  })

  it('rejects unsupported inbound methods without touching the router', async () => {
    const h = harness()
    await establish(h)
    h.sendFromIphone('bridge.formatDisk', { requestId: 'req-evil' })
    await settle()
    expect(h.routed).toHaveLength(0)
    const ack = h.iphoneMessages.find((m) => m.method === 'bridge.ack')
    expect(ack!.params).toMatchObject({ requestId: 'req-evil', ok: false })
  })

  it('router errors come back as ok:false acks instead of crashing', async () => {
    const h = harness()
    await establish(h)
    ;(h.runtime as unknown as { opts: { routeAction: unknown } }).opts.routeAction = async () => {
      throw new Error('decode failed')
    }
    h.sendFromIphone('bridge.requestActionAck', { requestId: 'req-2' })
    await settle()
    const acks = h.iphoneMessages.filter((m) => m.method === 'bridge.ack')
    expect(acks.at(-1)!.params).toMatchObject({
      requestId: 'req-2',
      ok: false,
      error: 'decode failed'
    })
  })
})
