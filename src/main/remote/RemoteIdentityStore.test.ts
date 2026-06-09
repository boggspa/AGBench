import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RemoteIdentityStore, type IdentitySafeStorage } from './RemoteIdentityStore'
import {
  exportRawEd25519PublicKey,
  signEd25519,
  verifyEd25519
} from '../../shared/e2ee/keys'

// Reversible fake of Electron's safeStorage (prefixes so we can assert at-rest encryption).
const fakeSafeStorage: IdentitySafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
  decryptString: (encrypted) => encrypted.toString('utf8').replace(/^enc:/, '')
}

const dirs: string[] = []
function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tw-identity-'))
  dirs.push(dir)
  return join(dir, 'remote-mac-identity.json')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('RemoteIdentityStore', () => {
  it('generates + persists, then reloads the same identity', () => {
    const path = tempPath()
    const first = new RemoteIdentityStore(path, fakeSafeStorage).load()
    const second = new RemoteIdentityStore(path, fakeSafeStorage).load()
    expect(exportRawEd25519PublicKey(second.publicKey).equals(exportRawEd25519PublicKey(first.publicKey))).toBe(
      true
    )
    // A signature from the reloaded key verifies against the original public key.
    const sig = signEd25519(second.privateKey, Buffer.from('transcript'))
    expect(verifyEd25519(first.publicKey, Buffer.from('transcript'), sig)).toBe(true)
  })

  it('stores the key encrypted at rest, not as plaintext DER', () => {
    const path = tempPath()
    new RemoteIdentityStore(path, fakeSafeStorage).load()
    const raw = readFileSync(path, 'utf8')
    expect(raw).toContain('encryptedKey')
    // The persisted blob is the fake-encrypted value (enc:...), never bare DER.
    const parsed = JSON.parse(raw) as { encryptedKey: string }
    expect(Buffer.from(parsed.encryptedKey, 'base64').toString('utf8').startsWith('enc:')).toBe(true)
  })

  it('regenerates if the stored file is corrupt', () => {
    const path = tempPath()
    const first = new RemoteIdentityStore(path, fakeSafeStorage).load()
    // Corrupt the file, then load → a new identity (different key), no throw.
    const { writeFileSync } = require('fs') as typeof import('fs')
    writeFileSync(path, 'not json')
    const second = new RemoteIdentityStore(path, fakeSafeStorage).load()
    expect(exportRawEd25519PublicKey(second.publicKey).equals(exportRawEd25519PublicKey(first.publicKey))).toBe(
      false
    )
  })
})
