import { describe, it, expect, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { createRelayServer, type RelayServerHandle } from '../src/server'
import { E2eeSession, type E2eeSessionOptions } from '../../src/shared/e2ee/session'
import { generateIdentityKeyPair } from '../../src/shared/e2ee/keys'
import type { E2eeFrame } from '../../src/shared/e2ee/protocol'

const SESSION_ID = 'sess-relay'

let relay: RelayServerHandle | null = null
const openSockets: WebSocket[] = []

afterEach(async () => {
  for (const ws of openSockets.splice(0)) {
    try {
      ws.terminate()
    } catch {
      /* ignore */
    }
  }
  if (relay) {
    await relay.close()
    relay = null
  }
})

function connectEndpoint(
  url: string,
  role: 'mac' | 'iphone',
  makeOptions: (send: (f: E2eeFrame) => void) => E2eeSessionOptions
): Promise<{ ws: WebSocket; session: E2eeSession }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { 'x-taskwraith-role': role } })
    openSockets.push(ws)
    const session = new E2eeSession(makeOptions((f) => ws.send(JSON.stringify(f))))
    ws.on('open', () => resolve({ ws, session }))
    ws.on('error', reject)
    ws.on('message', (data) => {
      try {
        void session.handleFrame(JSON.parse(data.toString()) as E2eeFrame)
      } catch {
        /* ignore non-JSON */
      }
    })
  })
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('taskwraith-relay round-trip', () => {
  it('two endpoints complete the e2ee handshake + exchange an app message through the relay', async () => {
    relay = await createRelayServer({})
    const url = `ws://127.0.0.1:${relay.port}/v1/session/${SESSION_ID}`
    const macId = generateIdentityKeyPair()
    const iphoneId = generateIdentityKeyPair()

    const macEstablished = deferred<void>()
    const iphoneEstablished = deferred<void>()
    const iphoneGotApp = deferred<{ method: string; params: unknown }>()

    const mac = await connectEndpoint(url, 'mac', (send) => ({
      role: 'mac',
      sessionId: SESSION_ID,
      identityKeyPair: macId,
      send,
      onAppMessage: () => undefined,
      onEstablished: () => macEstablished.resolve(),
      trustPeer: () => true
    }))
    const iphone = await connectEndpoint(url, 'iphone', (send) => ({
      role: 'iphone',
      sessionId: SESSION_ID,
      identityKeyPair: iphoneId,
      peerIdentityPublicKey: macId.publicKey,
      send,
      onAppMessage: (method, params) => iphoneGotApp.resolve({ method, params }),
      onEstablished: () => iphoneEstablished.resolve()
    }))

    mac.session.start()
    iphone.session.start()
    await Promise.all([macEstablished.promise, iphoneEstablished.promise])

    expect(relay.roomCount()).toBe(1)
    mac.session.sendApp('bridge.runEvent', { hello: 1 })
    const received = await iphoneGotApp.promise
    expect(received).toEqual({ method: 'bridge.runEvent', params: { hello: 1 } })
  })

  it('rejects a second socket for an already-occupied role (anti-hijack)', async () => {
    relay = await createRelayServer({})
    const url = `ws://127.0.0.1:${relay.port}/v1/session/${SESSION_ID}`
    const id = generateIdentityKeyPair()
    await connectEndpoint(url, 'iphone', (send) => ({
      role: 'iphone',
      sessionId: SESSION_ID,
      identityKeyPair: id,
      send,
      onAppMessage: () => undefined
    }))
    const closed = deferred<number>()
    const second = new WebSocket(url, { headers: { 'x-taskwraith-role': 'iphone' } })
    openSockets.push(second)
    second.on('close', (code) => closed.resolve(code))
    const code = await closed.promise
    expect(code).toBe(4002)
  })

  it('closes a connection with a bad role header', async () => {
    relay = await createRelayServer({})
    const url = `ws://127.0.0.1:${relay.port}/v1/session/${SESSION_ID}`
    const closed = deferred<number>()
    const ws = new WebSocket(url, { headers: { 'x-taskwraith-role': 'bogus' } })
    openSockets.push(ws)
    ws.on('close', (code) => closed.resolve(code))
    expect(await closed.promise).toBe(4001)
  })
})
