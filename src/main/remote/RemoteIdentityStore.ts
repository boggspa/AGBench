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

  /** Load the persisted identity, or generate + persist a fresh one.
   *
   * Security review (residual MED, fixed): an EXISTING identity that can't
   * be read must NEVER be silently replaced — every paired phone pins this
   * key, so silent regeneration both breaks pairings with no explanation
   * and masks tampering with the identity file. Likewise a fresh identity
   * that can't be durably persisted would break every pairing on the next
   * restart — fail loudly instead of running amnesiac. */
  load(): KeyPair {
    const existing = this.tryLoad()
    if (existing) return existing
    return this.generateAndPersist()
  }

  private tryLoad(): KeyPair | null {
    if (!existsSync(this.path)) return null
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as PersistedIdentity
      if (!parsed?.encryptedKey) {
        throw new Error('identity file is malformed (no encryptedKey)')
      }
      const derB64 = this.safeStorage.decryptString(Buffer.from(parsed.encryptedKey, 'base64'))
      const privateKey = importEd25519PrivateKeyDer(Buffer.from(derB64, 'base64'))
      const publicKey = createPublicKey(privateKey)
      return { publicKey, privateKey }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      this.log(`[identity] failed to load existing identity: ${detail}`)
      throw new Error(
        `The Mac's remote identity key exists but can't be read (${detail}). ` +
          `Refusing to silently replace it — paired devices pin this key. ` +
          `If your login keychain changed, unlock it and relaunch; to start over, ` +
          `delete ${this.path} and re-pair your devices.`
      )
    }
  }

  private generateAndPersist(): KeyPair {
    if (!this.safeStorage.isEncryptionAvailable()) {
      this.log('[identity] safeStorage unavailable — cannot protect a new identity key')
      throw new Error(
        'macOS keychain encryption (safeStorage) is unavailable, so a new remote ' +
          'identity key cannot be stored safely. Unlock your login keychain and relaunch.'
      )
    }
    const keyPair = generateIdentityKeyPair()
    try {
      const derB64 = exportPrivateKeyDer(keyPair.privateKey).toString('base64')
      const encryptedKey = this.safeStorage.encryptString(derB64).toString('base64')
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(this.path, JSON.stringify({ version: 1, encryptedKey } satisfies PersistedIdentity), {
        mode: 0o600
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      this.log(`[identity] failed to persist new identity: ${detail}`)
      // An identity that only lives in memory breaks every pairing on the
      // next restart — surface now rather than fail mysteriously later.
      throw new Error(
        `A new remote identity key was generated but couldn't be saved (${detail}). ` +
          `Check disk permissions for ${this.path} and relaunch.`
      )
    }
    return keyPair
  }
}
