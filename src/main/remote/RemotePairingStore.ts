/*
 * RemotePairingStore — persisted records of paired iOS companion devices.
 *
 * Written when the user confirms a pairing, read at startup so the Mac can
 * resume listening (trusted reconnect, no QR re-scan) and register each device
 * with the relay's resolve directory. Holds only PUBLIC material (each phone's
 * raw Ed25519 identity key) + display metadata, so it lives as plain 0600 JSON
 * under userData/bridge/ alongside the allowlist — unlike the Mac's own private
 * identity, which stays safeStorage-encrypted in RemoteIdentityStore.
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

interface PersistedRemotePairingFileV2 {
  v: 2
  devices: PersistedRemotePairing[]
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

function isPersistedRemotePairingFileV2(value: unknown): value is PersistedRemotePairingFileV2 {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return v.v === 2 && Array.isArray(v.devices) && v.devices.every(isPersistedRemotePairing)
}

function migrateFromDisk(parsed: unknown): PersistedRemotePairing[] {
  if (isPersistedRemotePairingFileV2(parsed)) {
    return parsed.devices
  }
  if (isPersistedRemotePairing(parsed)) {
    return [parsed]
  }
  return []
}

export class RemotePairingStore {
  private devices: PersistedRemotePairing[] = []

  constructor(
    private readonly path: string,
    private readonly log: (line: string) => void = () => {}
  ) {
    this.devices = this.readFromDisk()
  }

  /** @deprecated Use `list()` — kept for callers migrating from single-device. */
  load(): PersistedRemotePairing | null {
    return this.devices[0] ?? null
  }

  list(): PersistedRemotePairing[] {
    return [...this.devices]
  }

  upsert(pairing: PersistedRemotePairing): void {
    const index = this.devices.findIndex(
      (device) => device.iphoneIdentityPubKey === pairing.iphoneIdentityPubKey
    )
    if (index >= 0) {
      this.devices[index] = pairing
    } else {
      this.devices.push(pairing)
    }
    this.persist()
  }

  /** @deprecated Use `upsert()` — overwrites when the key already exists. */
  save(pairing: PersistedRemotePairing): void {
    this.upsert(pairing)
  }

  remove(iphoneIdentityPubKey: string): boolean {
    const before = this.devices.length
    this.devices = this.devices.filter((device) => device.iphoneIdentityPubKey !== iphoneIdentityPubKey)
    if (this.devices.length < before) {
      this.persist()
      return true
    }
    return false
  }

  clear(): void {
    if (this.devices.length === 0 && !existsSync(this.path)) return
    this.devices = []
    try {
      if (existsSync(this.path)) unlinkSync(this.path)
    } catch (err) {
      this.log(
        `[pairing-store] failed to clear: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  private readFromDisk(): PersistedRemotePairing[] {
    if (!existsSync(this.path)) return []
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      return migrateFromDisk(parsed)
    } catch (err) {
      this.log(
        `[pairing-store] failed to load: ${err instanceof Error ? err.message : String(err)}`
      )
      return []
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const payload: PersistedRemotePairingFileV2 = { v: 2, devices: this.devices }
      writeFileSync(this.path, JSON.stringify(payload, null, 2), { mode: 0o600 })
    } catch (err) {
      this.log(
        `[pairing-store] failed to save: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}
