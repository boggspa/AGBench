/*
 * Trusted-reconnect e2e (T5) — the cold path the resolve directory exists for:
 * pair once via QR, then BOTH endpoints die (Mac restart, phone offline).
 * On restart the Mac resumes listening from its persisted pairing and
 * registers with the relay; the phone — holding only its Keychain identities —
 * resolves the new sessionId and reconnects with NO user prompt on either
 * side. Also proves the directory + handshake refuse a stranger, and that a
 * failed stranger handshake can't lock the legitimate phone out.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createHash } from 'crypto'
import { createRelayServer, type RelayServerHandle } from '../../relay/src/server'
import {
  RemoteBridgeRuntime,
  relayHttpBase,
  type RemotePairingPrompt,
  type RemotePairingPersistence
} from '../../src/main/remote/RemoteBridgeRuntime'
import type { PersistedRemotePairing } from '../../src/main/remote/RemotePairingStore'
import { wsTransportSocketFactory } from '../../src/main/remote/wsTransportSocket'
import { buildRemoteProjectionEnvelope } from '../../src/main/RemoteTaskProjection'
import {
  b64,
  exportRawEd25519PublicKey,
  generateIdentityKeyPair,
  type KeyPair
} from '../../src/shared/e2ee/keys'
import { E2EE_PROTOCOL } from '../../src/shared/e2ee/protocol'
import { FakeIphoneClient } from './FakeIphoneClient'

const settle = (ms = 25): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function until(check: () => boolean, timeoutMs = 5_000, label = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await settle(10)
  }
}

function memoryPairingStore(): {
  store: RemotePairingPersistence
  current: () => PersistedRemotePairing | null
} {
  // Multi-device store shape (5b9ccf7e): list/upsert/remove keyed by the
  // phone identity; load/save kept as the deprecated single-device shims.
  let records: PersistedRemotePairing[] = []
  return {
    store: {
      list: () => [...records],
      upsert: (pairing) => {
        records = [
          ...records.filter(
            (entry) => entry.iphoneIdentityPubKey !== pairing.iphoneIdentityPubKey
          ),
          pairing
        ]
      },
      remove: (iphoneIdentityPubKey) => {
        const before = records.length
        records = records.filter(
          (entry) => entry.iphoneIdentityPubKey !== iphoneIdentityPubKey
        )
        return records.length !== before
      },
      load: () => records[0] ?? null,
      save: (pairing) => {
        records = [pairing]
      },
      clear: () => {
        records = []
      }
    },
    current: () => records[0] ?? null
  }
}

let relay: RelayServerHandle
let relayUrl = ''
const cleanups: Array<() => void> = []

beforeAll(async () => {
  relay = await createRelayServer({ port: 0, resolve: { freshnessMs: 60_000 } })
  relayUrl = `ws://127.0.0.1:${relay.port}`
})

afterAll(async () => {
  await relay.close()
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

interface MacSide {
  runtime: RemoteBridgeRuntime
  prompts: RemotePairingPrompt[]
  routedPairIds: string[]
  registrationsCompleted: () => number
}

function makeMacSide(identity: KeyPair, store: RemotePairingPersistence): MacSide {
  const prompts: RemotePairingPrompt[] = []
  const routedPairIds: string[] = []
  let completed = 0
  const envelope = buildRemoteProjectionEnvelope({
    kind: 'taskCard',
    payload: { id: 'chat-cold', title: 'Cold reconnect task' },
    generatedAt: '2026-06-09T00:00:00.000Z',
    envelopeId: 'remote-task:chat-cold:no-run'
  })
  const runtime = new RemoteBridgeRuntime({
    relayUrl,
    macDisplayName: 'Cold Mac',
    identity,
    socketFactory: wsTransportSocketFactory,
    appStore: { getWorkspaces: () => [], getChats: () => [], getChat: () => null },
    projectionSource: { listRemoteProjectionEnvelopes: () => [envelope] },
    routeAction: async (_method, params) => {
      routedPairIds.push(String((params as { pairID?: unknown })?.pairID))
      return { accepted: true }
    },
    subscribeRunEvents: () => () => {},
    onPairingPrompt: (prompt) => prompts.push(prompt),
    pairingStore: store,
    // Real HTTP to the real relay, instrumented so tests can await completion.
    postRegistration: async (url, body) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      completed += 1
      return { ok: response.ok, status: response.status }
    }
  })
  cleanups.push(() => runtime.dispose())
  return { runtime, prompts, routedPairIds, registrationsCompleted: () => completed }
}

const expectedPairId = (identity: KeyPair): string =>
  `iphone-${createHash('sha256')
    .update(exportRawEd25519PublicKey(identity.publicKey))
    .digest('hex')
    .slice(0, 16)}`

describe('e2e: trusted reconnect', () => {
  it('phone app relaunches while the Mac listener stays alive', async () => {
    const macIdentity = generateIdentityKeyPair()
    const macKeyB64 = b64.encode(exportRawEd25519PublicKey(macIdentity.publicKey))
    const phoneIdentity = generateIdentityKeyPair()
    const memory = memoryPairingStore()

    const mac = makeMacSide(macIdentity, memory.store)
    const begin = mac.runtime.beginPairing('Relaunch iPhone')
    const phoneA = new FakeIphoneClient({ identity: phoneIdentity })
    cleanups.push(() => phoneA.close())
    phoneA.scan(begin.bootstrap.bootstrapPayload)
    await phoneA.connect()
    await until(() => mac.prompts.length > 0, 5_000, 'pairing prompt')
    mac.runtime.finalizePairing(begin.bootstrap.pairingSessionID, true)
    await phoneA.waitForEstablished()
    await until(() => mac.registrationsCompleted() > 0, 5_000, 'first registration')

    phoneA.close()
    await settle(100)

    const phoneB = new FakeIphoneClient({ identity: phoneIdentity })
    cleanups.push(() => phoneB.close())
    await phoneB.resolveAndScan(relayUrl, macKeyB64)
    await phoneB.connect()
    await phoneB.waitForEstablished()

    expect(mac.prompts).toHaveLength(1)
    await phoneB.waitForMessage(
      (m) => m.method === 'bridge.broadcastRemoteProjectionSnapshot',
      5_000,
      'post-relaunch snapshot'
    )
    const ack = await phoneB.request('bridge.requestActionAck', { payloadBytes: 0 })
    expect(ack.ok).toBe(true)
    expect(mac.routedPairIds).toEqual([expectedPairId(phoneIdentity)])
  }, 20_000)

  it('phone app relaunches while its OLD socket is still seated (no-FIN zombie)', async () => {
    // The cellular field case: an app killed behind tailscale serve never
    // FINs, so the relay still holds the old iphone seat when the relaunched
    // app resolves its way back. The relay must seat the newcomer (takeover)
    // instead of rejecting it — pre-fix this deadlocked until the proxy gave
    // up, which over a dead tunnel is effectively never.
    const macIdentity = generateIdentityKeyPair()
    const macKeyB64 = b64.encode(exportRawEd25519PublicKey(macIdentity.publicKey))
    const phoneIdentity = generateIdentityKeyPair()
    const memory = memoryPairingStore()

    const mac = makeMacSide(macIdentity, memory.store)
    const begin = mac.runtime.beginPairing('Cellular iPhone')
    const phoneA = new FakeIphoneClient({ identity: phoneIdentity })
    cleanups.push(() => phoneA.close())
    phoneA.scan(begin.bootstrap.bootstrapPayload)
    await phoneA.connect()
    await until(() => mac.prompts.length > 0, 5_000, 'pairing prompt')
    mac.runtime.finalizePairing(begin.bootstrap.pairingSessionID, true)
    await phoneA.waitForEstablished()
    await until(() => mac.registrationsCompleted() > 0, 5_000, 'first registration')

    // phoneA is NOT closed — its socket stays seated, exactly like a killed
    // app whose FIN never crossed the tunnel.
    const phoneB = new FakeIphoneClient({ identity: phoneIdentity })
    cleanups.push(() => phoneB.close())
    await phoneB.resolveAndScan(relayUrl, macKeyB64)
    await phoneB.connect()
    await phoneB.waitForEstablished()

    await phoneB.waitForMessage(
      (m) => m.method === 'bridge.broadcastRemoteProjectionSnapshot',
      5_000,
      'post-takeover snapshot'
    )
    const ack = await phoneB.request('bridge.requestActionAck', { payloadBytes: 0 })
    expect(ack.ok).toBe(true)
  }, 20_000)

  it('cold restart on both sides — resolve + reconnect with no prompt, same audit pairID', async () => {
    const macIdentity = generateIdentityKeyPair()
    const macKeyB64 = b64.encode(exportRawEd25519PublicKey(macIdentity.publicKey))
    const phoneIdentity = generateIdentityKeyPair()
    const memory = memoryPairingStore()

    // ── Run 1: QR pairing ────────────────────────────────────────────────────
    const macA = makeMacSide(macIdentity, memory.store)
    const begin = macA.runtime.beginPairing('Cold iPad')
    const phoneA = new FakeIphoneClient({ identity: phoneIdentity })
    cleanups.push(() => phoneA.close())
    phoneA.scan(begin.bootstrap.bootstrapPayload)
    await phoneA.connect()
    await until(() => macA.prompts.length > 0, 5_000, 'pairing prompt')
    macA.runtime.finalizePairing(begin.bootstrap.pairingSessionID, true)
    await phoneA.waitForEstablished()
    await until(() => macA.registrationsCompleted() > 0, 5_000, 'first registration')
    expect(relay.registrationCount()).toBeGreaterThanOrEqual(1)
    expect(memory.current()?.controllerDisplayName).toBe('Cold iPad')

    // ── Both sides die ───────────────────────────────────────────────────────
    macA.runtime.dispose()
    phoneA.close()
    await settle(50)

    // ── Run 2: Mac restarts from persistence; phone resolves its way back ───
    const macB = makeMacSide(macIdentity, memory.store)
    expect(macB.runtime.startListening()).toBe(true)
    await until(() => macB.registrationsCompleted() > 0, 5_000, 'restart registration')

    const phoneB = new FakeIphoneClient({ identity: phoneIdentity })
    cleanups.push(() => phoneB.close())
    await phoneB.resolveAndScan(relayUrl, macKeyB64)
    await phoneB.connect()
    await phoneB.waitForEstablished()

    // Silent on both sides: no prompt, no confirm code surfaced for trust.
    expect(macB.prompts).toHaveLength(0)
    await phoneB.waitForMessage(
      (m) => m.method === 'bridge.broadcastRemoteProjectionSnapshot',
      5_000,
      'post-reconnect snapshot'
    )

    // Actions still flow, audited under the SAME identity-derived pairID.
    const ack = await phoneB.request('bridge.requestActionAck', { payloadBytes: 0 })
    expect(ack.ok).toBe(true)
    expect(macB.routedPairIds).toEqual([expectedPairId(phoneIdentity)])
  }, 20_000)

  it('a stranger is refused by the directory AND the handshake — without locking the phone out', async () => {
    const macIdentity = generateIdentityKeyPair()
    const macKeyB64 = b64.encode(exportRawEd25519PublicKey(macIdentity.publicKey))
    const phoneIdentity = generateIdentityKeyPair()
    const memory = memoryPairingStore()
    memory.store.save({
      v: 1,
      iphoneIdentityPubKey: b64.encode(exportRawEd25519PublicKey(phoneIdentity.publicKey)),
      controllerDisplayName: 'Real iPad',
      pairedAt: '2026-06-09T12:00:00.000Z'
    })

    const mac = makeMacSide(macIdentity, memory.store)
    expect(mac.runtime.startListening()).toBe(true)
    await until(() => mac.registrationsCompleted() > 0, 5_000, 'registration')

    // The directory refuses an identity that was never paired.
    const stranger = new FakeIphoneClient()
    cleanups.push(() => stranger.close())
    await expect(stranger.resolveAndScan(relayUrl, macKeyB64)).rejects.toThrow(/404/)

    // Even WITH the sessionId (leaked out-of-band), the handshake refuses: the
    // Mac's pinned identity doesn't match. Learn the sessionId legitimately
    // first, then hand it to the stranger.
    const realPhone = new FakeIphoneClient({ identity: phoneIdentity })
    cleanups.push(() => realPhone.close())
    await realPhone.resolveAndScan(relayUrl, macKeyB64)
    const sessionId = (
      realPhone as unknown as { bootstrap: { sessionId: string } }
    ).bootstrap.sessionId

    stranger.scan({
      v: 1,
      protocol: E2EE_PROTOCOL,
      relayUrl,
      sessionId,
      macIdentityPubKey: macKeyB64,
      macDisplayName: '',
      expiresAt: Number.MAX_SAFE_INTEGER
    })
    await stranger.connect()
    await expect(stranger.waitForEstablished(1_200)).rejects.toThrow(/timed out/)
    expect(mac.prompts).toHaveLength(0) // pinned mode NEVER prompts trust
    stranger.close()
    await settle(50)

    // The legitimate phone still gets in after the failed hijack attempt.
    await realPhone.connect()
    await realPhone.waitForEstablished()
    expect(mac.runtime.isEstablished).toBe(true)
  }, 20_000)
})

describe('relayHttpBase sanity', () => {
  it('matches the relay listener', async () => {
    const response = await fetch(`${relayHttpBase(relayUrl)}/v1/resolve`, { method: 'GET' })
    expect(response.status).toBe(405)
  })
})
