import { describe, it, expect } from 'vitest'
import {
  deriveSharedSecret,
  exportRawEd25519PublicKey,
  exportRawX25519PublicKey,
  generateEphemeralKeyPair,
  generateIdentityKeyPair,
  importEd25519PrivateKeyDer,
  importRawEd25519PublicKey,
  importRawX25519PublicKey,
  exportPrivateKeyDer,
  signEd25519,
  verifyEd25519
} from './keys'

describe('raw<->DER public key conversion (CryptoKit parity)', () => {
  it('round-trips an X25519 public key as raw 32 bytes', () => {
    const kp = generateEphemeralKeyPair()
    const raw = exportRawX25519PublicKey(kp.publicKey)
    expect(raw.length).toBe(32)
    const reimported = importRawX25519PublicKey(raw)
    expect(exportRawX25519PublicKey(reimported).equals(raw)).toBe(true)
  })

  it('round-trips an Ed25519 public key as raw 32 bytes', () => {
    const kp = generateIdentityKeyPair()
    const raw = exportRawEd25519PublicKey(kp.publicKey)
    expect(raw.length).toBe(32)
    const reimported = importRawEd25519PublicKey(raw)
    expect(exportRawEd25519PublicKey(reimported).equals(raw)).toBe(true)
  })

  it('rejects a wrong-length raw key', () => {
    expect(() => importRawX25519PublicKey(Buffer.alloc(31))).toThrow()
    expect(() => importRawEd25519PublicKey(Buffer.alloc(33))).toThrow()
  })
})

describe('X25519 ECDH', () => {
  it('both sides derive the same 32-byte shared secret (via raw round-trip)', () => {
    const a = generateEphemeralKeyPair()
    const b = generateEphemeralKeyPair()
    const bPubFromRaw = importRawX25519PublicKey(exportRawX25519PublicKey(b.publicKey))
    const aPubFromRaw = importRawX25519PublicKey(exportRawX25519PublicKey(a.publicKey))
    const ss1 = deriveSharedSecret(a.privateKey, bPubFromRaw)
    const ss2 = deriveSharedSecret(b.privateKey, aPubFromRaw)
    expect(ss1.length).toBe(32)
    expect(ss1.equals(ss2)).toBe(true)
  })
})

describe('Ed25519 sign/verify', () => {
  it('verifies a valid signature and rejects tampering', () => {
    const id = generateIdentityKeyPair()
    const msg = Buffer.from('transcript-hash')
    const sig = signEd25519(id.privateKey, msg)
    expect(sig.length).toBe(64)
    const pub = importRawEd25519PublicKey(exportRawEd25519PublicKey(id.publicKey))
    expect(verifyEd25519(pub, msg, sig)).toBe(true)
    expect(verifyEd25519(pub, Buffer.from('other'), sig)).toBe(false)
    const other = generateIdentityKeyPair()
    expect(verifyEd25519(other.publicKey, msg, sig)).toBe(false)
  })

  it('persists + reloads an identity private key (DER round-trip)', () => {
    const id = generateIdentityKeyPair()
    const der = exportPrivateKeyDer(id.privateKey)
    const reloaded = importEd25519PrivateKeyDer(der)
    const msg = Buffer.from('hello')
    const sig = signEd25519(reloaded, msg)
    expect(verifyEd25519(id.publicKey, msg, sig)).toBe(true)
  })
})
