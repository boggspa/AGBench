/*
 * taskwraith-relay — trusted-reconnect resolve directory (T5).
 *
 * A small, signed, in-memory directory mapping a Mac's Ed25519 identity to
 * its CURRENT live sessionId, so a previously paired phone can reconnect
 * without re-scanning a QR. See src/shared/e2ee/resolve.ts for the protocol
 * (canonical signing strings, self-certifying requests).
 *
 * Hardening:
 *   - signatures verified against the identity key INSIDE the request — the
 *     identity is the principal; the relay needs no account database.
 *   - `issuedAt` freshness window on both verbs.
 *   - resolve nonces are single-use within the window (anti-replay).
 *   - registrations are monotonic per identity — a replayed old registration
 *     cannot roll the directory back to a dead sessionId (409 instead).
 *   - resolve failures are UNIFORM 404s: "no registration", "expired", and
 *     "peer not allowed" are indistinguishable to the caller, so the
 *     directory can't be used to probe which Macs are online.
 *   - verification failures are uniform 400s; the specific reason is logged
 *     server-side only.
 */

import type { IncomingMessage, ServerResponse } from 'http'
import {
  canonicalAllowedPeers,
  isRegisterRequest,
  isResolveRequest,
  verifyRegisterRequest,
  verifyResolveRequest
} from '../../src/shared/e2ee/resolve'

interface Registration {
  sessionId: string
  allowedPeers: Set<string>
  issuedAt: number
  expiresAt: number
}

export interface ResolveDirectoryOptions {
  /** |now - issuedAt| must be within this on both verbs. Default 2 min. */
  freshnessMs?: number
  /** Registrations clamp to this lifetime. Default 1 h. */
  maxTtlMs?: number
  now?: () => number
  log?: (line: string) => void
}

export interface ResolveDirectory {
  handle: (req: IncomingMessage, res: ServerResponse) => void
  registrationCount: () => number
  close: () => void
}

const MAX_BODY_BYTES = 16 * 1024

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

export function createResolveDirectory(options: ResolveDirectoryOptions = {}): ResolveDirectory {
  const freshnessMs = options.freshnessMs ?? 2 * 60 * 1000
  const maxTtlMs = options.maxTtlMs ?? 60 * 60 * 1000
  const now = options.now ?? Date.now
  const log = options.log ?? (() => {})

  const registrations = new Map<string, Registration>()
  /** nonce → expiry. Swept lazily + on an interval. */
  const seenNonces = new Map<string, number>()

  const sweep = (): void => {
    const t = now()
    for (const [nonce, expiry] of seenNonces) {
      if (expiry <= t) seenNonces.delete(nonce)
    }
    for (const [key, registration] of registrations) {
      if (registration.expiresAt <= t) registrations.delete(key)
    }
  }
  const sweeper = setInterval(sweep, Math.max(5_000, Math.floor(freshnessMs / 2)))
  sweeper.unref?.()

  const handleRegister = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch (err) {
      respond(res, 400, { ok: false, error: 'invalid request' })
      log(`[resolve] register rejected: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    if (!isRegisterRequest(body) || !verifyRegisterRequest(body)) {
      respond(res, 400, { ok: false, error: 'invalid request' })
      log('[resolve] register rejected: shape or signature')
      return
    }
    if (Math.abs(now() - body.issuedAt) > freshnessMs) {
      respond(res, 400, { ok: false, error: 'invalid request' })
      log('[resolve] register rejected: stale issuedAt')
      return
    }
    const existing = registrations.get(body.macIdentityPubKey)
    if (existing && body.issuedAt < existing.issuedAt) {
      // Replayed old registration — never roll back to a dead sessionId.
      respond(res, 409, { ok: false, error: 'stale registration' })
      log('[resolve] register rejected: older than current registration')
      return
    }
    const ttlMs = Math.min(body.ttlMs, maxTtlMs)
    const expiresAt = now() + ttlMs
    registrations.set(body.macIdentityPubKey, {
      sessionId: body.sessionId,
      allowedPeers: new Set(canonicalAllowedPeers(body.allowedPeers)),
      issuedAt: body.issuedAt,
      expiresAt
    })
    respond(res, 200, { ok: true, expiresAt })
  }

  const handleResolve = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch (err) {
      respond(res, 400, { ok: false, error: 'invalid request' })
      log(`[resolve] resolve rejected: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    if (!isResolveRequest(body) || !verifyResolveRequest(body)) {
      respond(res, 400, { ok: false, error: 'invalid request' })
      log('[resolve] resolve rejected: shape or signature')
      return
    }
    if (Math.abs(now() - body.issuedAt) > freshnessMs) {
      respond(res, 400, { ok: false, error: 'invalid request' })
      log('[resolve] resolve rejected: stale issuedAt')
      return
    }
    const nonceExpiry = seenNonces.get(body.nonce)
    if (nonceExpiry && nonceExpiry > now()) {
      respond(res, 400, { ok: false, error: 'invalid request' })
      log('[resolve] resolve rejected: replayed nonce')
      return
    }
    seenNonces.set(body.nonce, now() + 2 * freshnessMs)

    const registration = registrations.get(body.macIdentityPubKey)
    const allowed =
      registration &&
      registration.expiresAt > now() &&
      registration.allowedPeers.has(body.iphoneIdentityPubKey)
    if (!allowed) {
      // Uniform: unknown Mac, expired registration, and unauthorized peer are
      // indistinguishable — no online-status oracle.
      respond(res, 404, { ok: false, error: 'not found' })
      return
    }
    respond(res, 200, { ok: true, sessionId: registration.sessionId })
  }

  return {
    handle: (req, res) => {
      const path = (req.url || '').split('?')[0]
      if (req.method !== 'POST') {
        respond(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      if (path === '/v1/resolve/register') {
        void handleRegister(req, res)
        return
      }
      if (path === '/v1/resolve') {
        void handleResolve(req, res)
        return
      }
      respond(res, 404, { ok: false, error: 'not found' })
    },
    registrationCount: () => {
      sweep()
      return registrations.size
    },
    close: () => clearInterval(sweeper)
  }
}
