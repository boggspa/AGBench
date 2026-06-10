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
  it('round-trips multiple pairing records in v2 format', () => {
    const path = tempPath()
    const keyA = b64.encode(exportRawEd25519PublicKey(generateIdentityKeyPair().publicKey))
    const keyB = b64.encode(exportRawEd25519PublicKey(generateIdentityKeyPair().publicKey))
    const store = new RemotePairingStore(path)
    store.upsert({
      v: 1,
      iphoneIdentityPubKey: keyA,
      controllerDisplayName: 'My iPad',
      pairedAt: '2026-06-09T12:00:00.000Z'
    })
    store.upsert({
      v: 1,
      iphoneIdentityPubKey: keyB,
      controllerDisplayName: 'Chris iPhone',
      pairedAt: '2026-06-10T12:00:00.000Z'
    })
    const loaded = new RemotePairingStore(path).list()
    expect(loaded).toHaveLength(2)
    expect(loaded.map((entry) => entry.controllerDisplayName).sort()).toEqual([
      'Chris iPhone',
      'My iPad'
    ])
  })

  it('migrates legacy v1 single-device files into a one-entry list', () => {
    const path = tempPath()
    const key = b64.encode(exportRawEd25519PublicKey(generateIdentityKeyPair().publicKey))
    writeFileSync(
      path,
      JSON.stringify({
        v: 1,
        iphoneIdentityPubKey: key,
        controllerDisplayName: 'Legacy iPad',
        pairedAt: '2026-06-09T12:00:00.000Z'
      })
    )
    const loaded = new RemotePairingStore(path).list()
    expect(loaded).toEqual([
      {
        v: 1,
        iphoneIdentityPubKey: key,
        controllerDisplayName: 'Legacy iPad',
        pairedAt: '2026-06-09T12:00:00.000Z'
      }
    ])
  })

  it('returns an empty list for a missing, corrupt, or wrong-shape file', () => {
    const missing = new RemotePairingStore(tempPath())
    expect(missing.list()).toEqual([])

    const corruptPath = tempPath()
    writeFileSync(corruptPath, 'not json')
    expect(new RemotePairingStore(corruptPath).list()).toEqual([])

    const wrongShapePath = tempPath()
    writeFileSync(wrongShapePath, JSON.stringify({ v: 1, iphoneIdentityPubKey: 'too-short' }))
    expect(new RemotePairingStore(wrongShapePath).list()).toEqual([])
  })

  it('remove() forgets one device and clear() forgets all', () => {
    const path = tempPath()
    const store = new RemotePairingStore(path)
    const keyA = b64.encode(exportRawEd25519PublicKey(generateIdentityKeyPair().publicKey))
    const keyB = b64.encode(exportRawEd25519PublicKey(generateIdentityKeyPair().publicKey))
    store.upsert({
      v: 1,
      iphoneIdentityPubKey: keyA,
      controllerDisplayName: 'iPad',
      pairedAt: '2026-06-09T12:00:00.000Z'
    })
    store.upsert({
      v: 1,
      iphoneIdentityPubKey: keyB,
      controllerDisplayName: 'iPhone',
      pairedAt: '2026-06-09T13:00:00.000Z'
    })
    expect(store.remove(keyA)).toBe(true)
    expect(store.list()).toHaveLength(1)
    store.clear()
    expect(store.list()).toEqual([])
    expect(() => store.clear()).not.toThrow()
  })
})
