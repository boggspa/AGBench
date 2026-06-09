/*
 * taskwraith-e2ee-v1 — AES-256-GCM seal/open with directional nonces + AAD.
 */

import { createCipheriv, createDecipheriv } from 'crypto'
import { NONCE_PREFIX, type Direction } from './protocol'

const NONCE_LEN = 12
const TAG_LEN = 16

/** 12-byte nonce = 4B big-endian direction prefix ‖ 8B big-endian seq. */
export function buildNonce(direction: Direction, seq: number): Buffer {
  const nonce = Buffer.alloc(NONCE_LEN)
  nonce.writeUInt32BE(NONCE_PREFIX[direction], 0)
  nonce.writeBigUInt64BE(BigInt(seq), 4)
  return nonce
}

/** AAD binds ciphertext to its session + position (defeats cross-session/replay splices). */
export function buildAad(sessionId: string, seq: number): Buffer {
  return Buffer.from(`${sessionId}:${seq}`, 'utf8')
}

export interface SealedFrame {
  nonce: Buffer
  ct: Buffer
  tag: Buffer
}

export function seal(
  key: Buffer,
  direction: Direction,
  sessionId: string,
  seq: number,
  plaintext: Buffer
): SealedFrame {
  const nonce = buildNonce(direction, seq)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(buildAad(sessionId, seq))
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { nonce, ct, tag: cipher.getAuthTag() }
}

/**
 * Decrypt + authenticate. Recomputes the expected nonce from (direction, seq)
 * and rejects a mismatched wire nonce before doing anything else; the GCM tag
 * check (bound to the AAD) then rejects any tamper. Throws on any failure.
 */
export function open(
  key: Buffer,
  direction: Direction,
  sessionId: string,
  seq: number,
  frame: { nonce: Buffer; ct: Buffer; tag: Buffer }
): Buffer {
  const expected = buildNonce(direction, seq)
  if (!frame.nonce.equals(expected)) throw new Error('nonce mismatch')
  if (frame.tag.length !== TAG_LEN) throw new Error('bad tag length')
  const decipher = createDecipheriv('aes-256-gcm', key, expected)
  decipher.setAAD(buildAad(sessionId, seq))
  decipher.setAuthTag(frame.tag)
  return Buffer.concat([decipher.update(frame.ct), decipher.final()])
}
