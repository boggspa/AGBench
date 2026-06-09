import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomBytes } from 'crypto'
import { createRelayServer, type RelayServerHandle } from '../src/server'
import {
  b64,
  exportRawEd25519PublicKey,
  generateIdentityKeyPair,
  type KeyPair
} from '../../src/shared/e2ee/keys'
import {
  signRegisterRequest,
  signResolveRequest,
  type RegisterRequest,
  type ResolveRequest
} from '../../src/shared/e2ee/resolve'

let relay: RelayServerHandle
let baseUrl = ''

beforeAll(async () => {
  relay = await createRelayServer({ port: 0, resolve: { freshnessMs: 60_000 } })
  baseUrl = `http://127.0.0.1:${relay.port}`
})

afterAll(async () => {
  await relay.close()
})

const rawKeyB64 = (pair: KeyPair): string => b64.encode(exportRawEd25519PublicKey(pair.publicKey))
const freshNonce = (): string => b64.encode(randomBytes(16))

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: response.status, json: await response.json() }
}

const register = (body: RegisterRequest) => post('/v1/resolve/register', body)
const resolve = (body: ResolveRequest) => post('/v1/resolve', body)

describe('relay resolve directory', () => {
  it('register → resolve round-trips the current sessionId', async () => {
    const mac = generateIdentityKeyPair()
    const phone = generateIdentityKeyPair()

    const registered = await register(
      signRegisterRequest(mac, {
        sessionId: 'sess-roundtrip',
        allowedPeers: [rawKeyB64(phone)],
        issuedAt: Date.now(),
        ttlMs: 60_000
      })
    )
    expect(registered.status).toBe(200)
    expect(registered.json.ok).toBe(true)
    expect(registered.json.expiresAt).toBeGreaterThan(Date.now())

    const resolved = await resolve(
      signResolveRequest(phone, {
        macIdentityPubKey: rawKeyB64(mac),
        nonce: freshNonce(),
        issuedAt: Date.now()
      })
    )
    expect(resolved.status).toBe(200)
    expect(resolved.json).toEqual({ ok: true, sessionId: 'sess-roundtrip' })
  })

  it('re-registration with a newer issuedAt replaces the sessionId', async () => {
    const mac = generateIdentityKeyPair()
    const phone = generateIdentityKeyPair()
    const peers = [rawKeyB64(phone)]
    const t = Date.now()

    await register(signRegisterRequest(mac, { sessionId: 'sess-old', allowedPeers: peers, issuedAt: t, ttlMs: 60_000 }))
    await register(
      signRegisterRequest(mac, { sessionId: 'sess-new', allowedPeers: peers, issuedAt: t + 10, ttlMs: 60_000 })
    )

    const resolved = await resolve(
      signResolveRequest(phone, { macIdentityPubKey: rawKeyB64(mac), nonce: freshNonce(), issuedAt: Date.now() })
    )
    expect(resolved.json.sessionId).toBe('sess-new')
  })

  it('rejects a replayed OLDER registration (no sessionId rollback)', async () => {
    const mac = generateIdentityKeyPair()
    const phone = generateIdentityKeyPair()
    const peers = [rawKeyB64(phone)]
    const t = Date.now()
    const older = signRegisterRequest(mac, { sessionId: 'sess-1', allowedPeers: peers, issuedAt: t - 10, ttlMs: 60_000 })
    const newer = signRegisterRequest(mac, { sessionId: 'sess-2', allowedPeers: peers, issuedAt: t, ttlMs: 60_000 })

    expect((await register(newer)).status).toBe(200)
    const replayed = await register(older)
    expect(replayed.status).toBe(409)

    const resolved = await resolve(
      signResolveRequest(phone, { macIdentityPubKey: rawKeyB64(mac), nonce: freshNonce(), issuedAt: Date.now() })
    )
    expect(resolved.json.sessionId).toBe('sess-2')
  })

  it('uniform 404 for unknown Mac AND unauthorized peer', async () => {
    const mac = generateIdentityKeyPair()
    const allowedPhone = generateIdentityKeyPair()
    const strangerPhone = generateIdentityKeyPair()
    await register(
      signRegisterRequest(mac, {
        sessionId: 'sess-secret',
        allowedPeers: [rawKeyB64(allowedPhone)],
        issuedAt: Date.now(),
        ttlMs: 60_000
      })
    )

    const unknownMac = await resolve(
      signResolveRequest(allowedPhone, {
        macIdentityPubKey: rawKeyB64(generateIdentityKeyPair()),
        nonce: freshNonce(),
        issuedAt: Date.now()
      })
    )
    const unauthorizedPeer = await resolve(
      signResolveRequest(strangerPhone, {
        macIdentityPubKey: rawKeyB64(mac),
        nonce: freshNonce(),
        issuedAt: Date.now()
      })
    )
    expect(unknownMac.status).toBe(404)
    expect(unauthorizedPeer.status).toBe(404)
    // Byte-identical bodies — no online-status oracle.
    expect(unknownMac.json).toEqual(unauthorizedPeer.json)
  })

  it('rejects tampered signatures on both verbs', async () => {
    const mac = generateIdentityKeyPair()
    const phone = generateIdentityKeyPair()

    const reg = signRegisterRequest(mac, {
      sessionId: 'sess-sig',
      allowedPeers: [rawKeyB64(phone)],
      issuedAt: Date.now(),
      ttlMs: 60_000
    })
    expect((await register({ ...reg, sessionId: 'sess-hijacked' })).status).toBe(400)

    await register(reg)
    const res = signResolveRequest(phone, {
      macIdentityPubKey: rawKeyB64(mac),
      nonce: freshNonce(),
      issuedAt: Date.now()
    })
    // Re-point the request at a different Mac without re-signing.
    expect((await resolve({ ...res, macIdentityPubKey: rawKeyB64(generateIdentityKeyPair()) })).status).toBe(400)
  })

  it('rejects stale issuedAt on both verbs', async () => {
    const mac = generateIdentityKeyPair()
    const phone = generateIdentityKeyPair()
    const stale = Date.now() - 10 * 60 * 1000
    const reg = signRegisterRequest(mac, {
      sessionId: 'sess-stale',
      allowedPeers: [rawKeyB64(phone)],
      issuedAt: stale,
      ttlMs: 60_000
    })
    expect((await register(reg)).status).toBe(400)
    const res = signResolveRequest(phone, {
      macIdentityPubKey: rawKeyB64(mac),
      nonce: freshNonce(),
      issuedAt: stale
    })
    expect((await resolve(res)).status).toBe(400)
  })

  it('rejects a replayed resolve nonce', async () => {
    const mac = generateIdentityKeyPair()
    const phone = generateIdentityKeyPair()
    await register(
      signRegisterRequest(mac, {
        sessionId: 'sess-nonce',
        allowedPeers: [rawKeyB64(phone)],
        issuedAt: Date.now(),
        ttlMs: 60_000
      })
    )
    const request = signResolveRequest(phone, {
      macIdentityPubKey: rawKeyB64(mac),
      nonce: freshNonce(),
      issuedAt: Date.now()
    })
    expect((await resolve(request)).status).toBe(200)
    expect((await resolve(request)).status).toBe(400) // identical re-send
  })

  it('expired registrations resolve as 404', async () => {
    const mac = generateIdentityKeyPair()
    const phone = generateIdentityKeyPair()
    await register(
      signRegisterRequest(mac, {
        sessionId: 'sess-expiry',
        allowedPeers: [rawKeyB64(phone)],
        issuedAt: Date.now(),
        ttlMs: 40 // clamped low TTL
      })
    )
    await new Promise((r) => setTimeout(r, 80))
    const resolved = await resolve(
      signResolveRequest(phone, { macIdentityPubKey: rawKeyB64(mac), nonce: freshNonce(), issuedAt: Date.now() })
    )
    expect(resolved.status).toBe(404)
  })

  it('rejects non-POST and unknown resolve paths', async () => {
    const get = await fetch(`${baseUrl}/v1/resolve`)
    expect(get.status).toBe(405)
    const weird = await post('/v1/resolve/other', {})
    expect(weird.status).toBe(404)
  })
})
