/*
 * RemoteIdentityStore — the Mac's long-lived Ed25519 transport identity.
 *
 * Generated once and persisted (safeStorage-encrypted, like the APNs .p8 key)
 * as a JSON file under userData/bridge/, alongside the allowlist + audit ledger.
 * The iPhone pins this identity's public key from the QR bootstrap and verifies
 * it on every (re)connect. fs + safeStorage are injectable for tests.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { createPublicKey } from 'crypto'
import {
  exportPrivateKeyDer,
  generateIdentityKeyPair,
  importEd25519PrivateKeyDer,
  type KeyPair
} from '../../shared/e2ee/keys'

/** The subset of Electron's `safeStorage` this store needs. */
export interface IdentitySafeStorage {
  isEncryptionAvailable: () => boolean
  encryptString: (plain: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}

interface PersistedIdentity {
  version: 1
  /** base64( safeStorage.encrypt( base64(pkcs8 DER private key) ) ) */
  encryptedKey: string
}

export class RemoteIdentityStore {
  constructor(
    private readonly path: string,
    private readonly safeStorage: IdentitySafeStorage,
    private readonly log: (line: string) => void = () => {}
  ) {}

  /** Load the persisted identity, or generate + persist a fresh one. */
  load(): KeyPair {
    const existing = this.tryLoad()
    if (existing) return existing
    return this.generateAndPersist()
  }

  private tryLoad(): KeyPair | null {
    if (!existsSync(this.path)) return null
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as PersistedIdentity
      if (!parsed?.encryptedKey) return null
      const derB64 = this.safeStorage.decryptString(Buffer.from(parsed.encryptedKey, 'base64'))
      const privateKey = importEd25519PrivateKeyDer(Buffer.from(derB64, 'base64'))
      const publicKey = createPublicKey(privateKey)
      return { publicKey, privateKey }
    } catch (err) {
      this.log(
        `[identity] failed to load, regenerating: ${err instanceof Error ? err.message : String(err)}`
      )
      return null
    }
  }

  private generateAndPersist(): KeyPair {
    const keyPair = generateIdentityKeyPair()
    if (this.safeStorage.isEncryptionAvailable()) {
      try {
        const derB64 = exportPrivateKeyDer(keyPair.privateKey).toString('base64')
        const encryptedKey = this.safeStorage.encryptString(derB64).toString('base64')
        mkdirSync(dirname(this.path), { recursive: true })
        writeFileSync(this.path, JSON.stringify({ version: 1, encryptedKey } satisfies PersistedIdentity), {
          mode: 0o600
        })
      } catch (err) {
        // In-memory identity is still usable for this session; just won't persist.
        this.log(
          `[identity] failed to persist: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    } else {
      this.log('[identity] safeStorage unavailable — identity will not persist across restarts')
    }
    return keyPair
  }
}
