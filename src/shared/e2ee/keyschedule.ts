/*
 * taskwraith-e2ee-v1 — handshake transcript + key schedule.
 */

import { createHash, hkdfSync, type KeyObject } from 'crypto'
import { E2EE_PROTOCOL, HKDF_INFO_IPHONE_TO_MAC, HKDF_INFO_MAC_TO_IPHONE } from './protocol'
import { deriveSharedSecret } from './keys'

export interface TranscriptInputs {
  sessionId: string
  clientEphemeralPubKeyB64: string
  serverEphemeralPubKeyB64: string
  clientNonceB64: string
  serverNonceB64: string
  /** Raw Ed25519 (b64) — binding BOTH long-lived identities into the
   * signed transcript + confirm code defeats identity-splicing: a relay
   * that swaps either identity changes the code the user compares AND
   * breaks the serverAuth signature the phone verifies. */
  macIdentityPubKeyB64: string
  iphoneIdentityPubKeyB64: string
}

/**
 * SHA-256 over the canonical transcript string. Both sides sign this (binding
 * their identity to the exact ephemerals + nonces) and derive the confirm code
 * from it — so a relay that swaps an ephemeral key produces a different hash →
 * different confirm code → the user sees a mismatch (MITM defeated).
 */
export function computeTranscriptHash(inputs: TranscriptInputs): Buffer {
  const transcript = [
    E2EE_PROTOCOL,
    inputs.sessionId,
    inputs.clientEphemeralPubKeyB64,
    inputs.serverEphemeralPubKeyB64,
    inputs.clientNonceB64,
    inputs.serverNonceB64,
    inputs.macIdentityPubKeyB64,
    inputs.iphoneIdentityPubKeyB64
  ].join('|')
  return createHash('sha256').update(transcript, 'utf8').digest()
}

/** 6-digit confirmation code from the transcript hash (shown on both screens). */
export function confirmCodeFromTranscript(transcriptHash: Buffer): string {
  return String(transcriptHash.readUInt32BE(0) % 1_000_000).padStart(6, '0')
}

export interface SessionKeys {
  /** AES-256-GCM key for the mac->iphone direction. */
  macToIphone: Buffer
  /** AES-256-GCM key for the iphone->mac direction. */
  iphoneToMac: Buffer
}

/**
 * Derive the two directional AES-256-GCM keys. `ikm` is the X25519 shared
 * secret; `salt` binds both handshake nonces; HKDF info strings keep the two
 * directions on separate keys (no nonce reuse across directions).
 */
export function deriveSessionKeys(args: {
  myEphemeralPrivate: KeyObject
  peerEphemeralPublic: KeyObject
  clientNonce: Buffer
  serverNonce: Buffer
}): SessionKeys {
  const ikm = deriveSharedSecret(args.myEphemeralPrivate, args.peerEphemeralPublic)
  const salt = createHash('sha256')
    .update(Buffer.concat([args.clientNonce, args.serverNonce]))
    .digest()
  return {
    macToIphone: Buffer.from(hkdfSync('sha256', ikm, salt, HKDF_INFO_MAC_TO_IPHONE, 32)),
    iphoneToMac: Buffer.from(hkdfSync('sha256', ikm, salt, HKDF_INFO_IPHONE_TO_MAC, 32))
  }
}
