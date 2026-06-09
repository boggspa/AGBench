/*
 * RemotePairingStore — the persisted record of the ONE paired iOS device.
 *
 * Written when the user confirms a pairing, read at startup so the Mac can
 * resume listening (trusted reconnect, no QR re-scan) and register itself
 * with the relay's resolve directory. Holds only PUBLIC material (the
 * phone's raw Ed25519 identity key) + display metadata, so it lives as
 * plain 0600 JSON under userData/bridge/ alongside the allowlist — unlike
 * the Mac's own private identity, which stays safeStorage-encrypted in
 * RemoteIdentityStore.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'

export interface PersistedRemotePairing {
  v: 1
  /** base64 raw 32B Ed25519 iPhone identity public key (pinned at pairing). */
  iphoneIdentityPubKey: string
  controllerDisplayName: string
  /** ISO8601 timestamp of the user's confirm. */
  pairedAt: string
}

function isPersistedRemotePairing(value: unknown): value is PersistedRemotePairing {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.v === 1 &&
    typeof v.iphoneIdentityPubKey === 'string' &&
    Buffer.from(v.iphoneIdentityPubKey, 'base64').length === 32 &&
    typeof v.controllerDisplayName === 'string' &&
    typeof v.pairedAt === 'string'
  )
}

export class RemotePairingStore {
  constructor(
    private readonly path: string,
    private readonly log: (line: string) => void = () => {}
  ) {}

  load(): PersistedRemotePairing | null {
    if (!existsSync(this.path)) return null
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      return isPersistedRemotePairing(parsed) ? parsed : null
    } catch (err) {
      this.log(
        `[pairing-store] failed to load: ${err instanceof Error ? err.message : String(err)}`
      )
      return null
    }
  }

  save(pairing: PersistedRemotePairing): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(this.path, JSON.stringify(pairing, null, 2), { mode: 0o600 })
    } catch (err) {
      this.log(
        `[pairing-store] failed to save: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  clear(): void {
    try {
      if (existsSync(this.path)) unlinkSync(this.path)
    } catch (err) {
      this.log(
        `[pairing-store] failed to clear: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}
