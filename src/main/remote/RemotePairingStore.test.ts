import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RemotePairingStore } from './RemotePairingStore'
import { b64, exportRawEd25519PublicKey, generateIdentityKeyPair } from '../../shared/e2ee/keys'

const dirs: string[] = []
function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tw-pairing-'))
  dirs.push(dir)
  return join(dir, 'remote-pairing.json')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('RemotePairingStore', () => {
  it('round-trips a pairing record', () => {
    const path = tempPath()
    const key = b64.encode(exportRawEd25519PublicKey(generateIdentityKeyPair().publicKey))
    new RemotePairingStore(path).save({
      v: 1,
      iphoneIdentityPubKey: key,
      controllerDisplayName: 'My iPad',
      pairedAt: '2026-06-09T12:00:00.000Z'
    })
    const loaded = new RemotePairingStore(path).load()
    expect(loaded).toEqual({
      v: 1,
      iphoneIdentityPubKey: key,
      controllerDisplayName: 'My iPad',
      pairedAt: '2026-06-09T12:00:00.000Z'
    })
  })

  it('returns null for a missing, corrupt, or wrong-shape file', () => {
    const missing = new RemotePairingStore(tempPath())
    expect(missing.load()).toBeNull()

    const corruptPath = tempPath()
    writeFileSync(corruptPath, 'not json')
    expect(new RemotePairingStore(corruptPath).load()).toBeNull()

    const wrongShapePath = tempPath()
    writeFileSync(wrongShapePath, JSON.stringify({ v: 1, iphoneIdentityPubKey: 'too-short' }))
    expect(new RemotePairingStore(wrongShapePath).load()).toBeNull()
  })

  it('clear() forgets the pairing', () => {
    const path = tempPath()
    const store = new RemotePairingStore(path)
    store.save({
      v: 1,
      iphoneIdentityPubKey: b64.encode(
        exportRawEd25519PublicKey(generateIdentityKeyPair().publicKey)
      ),
      controllerDisplayName: 'iPad',
      pairedAt: '2026-06-09T12:00:00.000Z'
    })
    store.clear()
    expect(store.load()).toBeNull()
    expect(() => store.clear()).not.toThrow() // idempotent
  })
})
