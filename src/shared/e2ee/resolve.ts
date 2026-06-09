/*
 * taskwraith-resolve-v1 — trusted-reconnect resolve protocol.
 *
 * After a successful QR pairing both endpoints hold long-lived Ed25519
 * identities. When BOTH sides later go away (Mac restart, phone offline for
 * days), the phone needs the Mac's CURRENT sessionId without re-scanning a
 * QR. The relay keeps a small, signed directory:
 *
 *   register  Mac → relay   "identity M is listening on sessionId S; only
 *                            these peer identities may resolve me"
 *   resolve   phone → relay "I am identity P — where is identity M?"
 *
 * Both requests are self-certifying: the identity key IS the principal, and
 * the signature is over a canonical pipe-joined string (byte-identical in the
 * CryptoKit port — keep these builders in sync with ios/TaskWraithKit).
 * The relay learns nothing it didn't already see during pairing (public keys
 * + a session id), and a malicious relay can at worst hand back a wrong
 * sessionId — the e2ee handshake's pinned identities turn that into a
 * connection failure, never a confidentiality loss.
 *
 * Replay/freshness: `issuedAt` must be within the relay's freshness window;
 * resolve requests additionally carry a single-use `nonce`. Registrations are
 * monotonic per Mac identity (a replayed OLD registration cannot roll the
 * directory back to a dead sessionId).
 */

import type { KeyObject } from 'crypto'
import {
  b64,
  exportRawEd25519PublicKey,
  importRawEd25519PublicKey,
  signEd25519,
  verifyEd25519,
  type KeyPair
} from './keys'

export const RESOLVE_PROTOCOL = 'taskwraith-resolve-v1'

/** Mirrors the relay's WebSocket session-path constraint. */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/

export interface RegisterRequest {
  v: 1
  /** base64 raw 32B Ed25519 Mac identity public key (the principal). */
  macIdentityPubKey: string
  /** The session id the Mac is currently listening on. */
  sessionId: string
  /** base64 raw 32B Ed25519 identities allowed to resolve this Mac. */
  allowedPeers: string[]
  /** ms epoch; relay enforces freshness + per-identity monotonicity. */
  issuedAt: number
  /** Requested registration lifetime; relay clamps to its max. */
  ttlMs: number
  /** base64 Ed25519 signature over `registerSigningString(...)`. */
  sig: string
}

export interface ResolveRequest {
  v: 1
  macIdentityPubKey: string
  /** base64 raw 32B Ed25519 phone identity public key (the requester). */
  iphoneIdentityPubKey: string
  /** base64 random (≥ 8 bytes); single-use within the freshness window. */
  nonce: string
  issuedAt: number
  /** base64 Ed25519 signature over `resolveSigningString(...)`. */
  sig: string
}

/** Canonical allowedPeers order — sorted + deduped — so signer and verifier
 * derive the same signing string regardless of wire array order. */
export function canonicalAllowedPeers(peers: readonly string[]): string[] {
  return [...new Set(peers)].sort()
}

export function registerSigningString(input: {
  macIdentityPubKey: string
  sessionId: string
  allowedPeers: readonly string[]
  issuedAt: number
  ttlMs: number
}): string {
  return [
    RESOLVE_PROTOCOL,
    'register',
    input.macIdentityPubKey,
    input.sessionId,
    canonicalAllowedPeers(input.allowedPeers).join(','),
    String(input.issuedAt),
    String(input.ttlMs)
  ].join('|')
}

export function resolveSigningString(input: {
  macIdentityPubKey: string
  iphoneIdentityPubKey: string
  nonce: string
  issuedAt: number
}): string {
  return [
    RESOLVE_PROTOCOL,
    'resolve',
    input.macIdentityPubKey,
    input.iphoneIdentityPubKey,
    input.nonce,
    String(input.issuedAt)
  ].join('|')
}

export function signRegisterRequest(
  macIdentity: KeyPair,
  input: { sessionId: string; allowedPeers: readonly string[]; issuedAt: number; ttlMs: number }
): RegisterRequest {
  const macIdentityPubKey = b64.encode(exportRawEd25519PublicKey(macIdentity.publicKey))
  const allowedPeers = canonicalAllowedPeers(input.allowedPeers)
  const sig = signEd25519(
    macIdentity.privateKey,
    Buffer.from(
      registerSigningString({
        macIdentityPubKey,
        sessionId: input.sessionId,
        allowedPeers,
        issuedAt: input.issuedAt,
        ttlMs: input.ttlMs
      }),
      'utf8'
    )
  )
  return {
    v: 1,
    macIdentityPubKey,
    sessionId: input.sessionId,
    allowedPeers,
    issuedAt: input.issuedAt,
    ttlMs: input.ttlMs,
    sig: b64.encode(sig)
  }
}

export function signResolveRequest(
  iphoneIdentity: KeyPair,
  input: { macIdentityPubKey: string; nonce: string; issuedAt: number }
): ResolveRequest {
  const iphoneIdentityPubKey = b64.encode(exportRawEd25519PublicKey(iphoneIdentity.publicKey))
  const sig = signEd25519(
    iphoneIdentity.privateKey,
    Buffer.from(
      resolveSigningString({
        macIdentityPubKey: input.macIdentityPubKey,
        iphoneIdentityPubKey,
        nonce: input.nonce,
        issuedAt: input.issuedAt
      }),
      'utf8'
    )
  )
  return {
    v: 1,
    macIdentityPubKey: input.macIdentityPubKey,
    iphoneIdentityPubKey,
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    sig: b64.encode(sig)
  }
}

function isRawKeyB64(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false
  try {
    return b64.decode(value).length === 32
  } catch {
    return false
  }
}

export function isRegisterRequest(value: unknown): value is RegisterRequest {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.v === 1 &&
    isRawKeyB64(v.macIdentityPubKey) &&
    typeof v.sessionId === 'string' &&
    SESSION_ID_PATTERN.test(v.sessionId) &&
    Array.isArray(v.allowedPeers) &&
    v.allowedPeers.length >= 1 &&
    v.allowedPeers.length <= 8 &&
    v.allowedPeers.every(isRawKeyB64) &&
    typeof v.issuedAt === 'number' &&
    Number.isFinite(v.issuedAt) &&
    typeof v.ttlMs === 'number' &&
    Number.isFinite(v.ttlMs) &&
    v.ttlMs > 0 &&
    typeof v.sig === 'string'
  )
}

export function isResolveRequest(value: unknown): value is ResolveRequest {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const nonceOk =
    typeof v.nonce === 'string' &&
    v.nonce.length <= 128 &&
    (() => {
      try {
        return b64.decode(v.nonce as string).length >= 8
      } catch {
        return false
      }
    })()
  return (
    v.v === 1 &&
    isRawKeyB64(v.macIdentityPubKey) &&
    isRawKeyB64(v.iphoneIdentityPubKey) &&
    nonceOk &&
    typeof v.issuedAt === 'number' &&
    Number.isFinite(v.issuedAt) &&
    typeof v.sig === 'string'
  )
}

function verifyWith(rawKeyB64: string, message: string, sigB64: string): boolean {
  let publicKey: KeyObject
  try {
    publicKey = importRawEd25519PublicKey(b64.decode(rawKeyB64))
  } catch {
    return false
  }
  let sig: Buffer
  try {
    sig = b64.decode(sigB64)
  } catch {
    return false
  }
  return verifyEd25519(publicKey, Buffer.from(message, 'utf8'), sig)
}

export function verifyRegisterRequest(request: RegisterRequest): boolean {
  return verifyWith(request.macIdentityPubKey, registerSigningString(request), request.sig)
}

export function verifyResolveRequest(request: ResolveRequest): boolean {
  return verifyWith(request.iphoneIdentityPubKey, resolveSigningString(request), request.sig)
}
