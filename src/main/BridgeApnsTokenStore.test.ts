import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { BridgeApnsTokenStore } from './BridgeApnsTokenStore'

describe('BridgeApnsTokenStore', () => {
  describe('CRUD (in-memory)', () => {
    it('starts empty', () => {
      const store = new BridgeApnsTokenStore()
      expect(store.size()).toBe(0)
      expect(store.list()).toEqual([])
      expect(store.get('any')).toBeNull()
    })

    it('upserts a token with timestamp', () => {
      const store = new BridgeApnsTokenStore({ now: () => 1000 })
      const entry = store.upsert('pair-1', 'tok-abc', 'production')
      expect(entry.pairID).toBe('pair-1')
      expect(entry.deviceToken).toBe('tok-abc')
      expect(entry.env).toBe('production')
      expect(entry.updatedAt).toBe(1000)
    })

    it('overwrites on re-upsert (token rotation)', () => {
      let clock = 1000
      const store = new BridgeApnsTokenStore({ now: () => clock })
      store.upsert('pair-1', 'tok-1', 'production')
      clock = 2000
      const updated = store.upsert('pair-1', 'tok-2', 'production')
      expect(updated.deviceToken).toBe('tok-2')
      expect(updated.updatedAt).toBe(2000)
      expect(store.size()).toBe(1)
    })

    it('keeps a separate entry per pairID', () => {
      const store = new BridgeApnsTokenStore()
      store.upsert('pair-A', 'tok-A', 'production')
      store.upsert('pair-B', 'tok-B', 'sandbox')
      expect(store.size()).toBe(2)
      expect(store.get('pair-A')?.deviceToken).toBe('tok-A')
      expect(store.get('pair-B')?.env).toBe('sandbox')
    })

    it('removes a token and reports whether it existed', () => {
      const store = new BridgeApnsTokenStore()
      store.upsert('pair-1', 'tok-1', 'production')
      expect(store.remove('pair-1')).toBe(true)
      expect(store.remove('pair-1')).toBe(false)
      expect(store.size()).toBe(0)
    })

    it('clears all tokens', () => {
      const store = new BridgeApnsTokenStore()
      store.upsert('pair-1', 'tok-1', 'production')
      store.upsert('pair-2', 'tok-2', 'sandbox')
      store.clear()
      expect(store.size()).toBe(0)
    })
  })

  describe('input validation', () => {
    it('rejects empty pairID', () => {
      const store = new BridgeApnsTokenStore()
      expect(() => store.upsert('', 'tok', 'production')).toThrow(/pairID is required/)
    })

    it('rejects empty deviceToken', () => {
      const store = new BridgeApnsTokenStore()
      expect(() => store.upsert('pair-1', '', 'production')).toThrow(/deviceToken is required/)
    })

    it('rejects invalid env', () => {
      const store = new BridgeApnsTokenStore()
      expect(() => store.upsert('pair-1', 'tok', 'staging' as never)).toThrow(/env must be/)
    })
  })

  describe('persistence', () => {
    let tmpDir: string
    let storagePath: string

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'apns-store-test-'))
      storagePath = join(tmpDir, 'apns-tokens.json')
    })

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('round-trips entries through disk', () => {
      const a = new BridgeApnsTokenStore({ storagePath, now: () => 1000 })
      a.upsert('pair-1', 'tok-A', 'production')
      a.upsert('pair-2', 'tok-B', 'sandbox')

      const b = new BridgeApnsTokenStore({ storagePath })
      expect(b.size()).toBe(2)
      expect(b.get('pair-1')?.deviceToken).toBe('tok-A')
      expect(b.get('pair-2')?.env).toBe('sandbox')
    })

    it('creates intermediate directories', () => {
      const deepPath = join(tmpDir, 'nested', 'a', 'apns-tokens.json')
      const a = new BridgeApnsTokenStore({ storagePath: deepPath })
      a.upsert('pair-1', 'tok-A', 'production')
      const b = new BridgeApnsTokenStore({ storagePath: deepPath })
      expect(b.size()).toBe(1)
    })

    it('starts empty when file is malformed JSON', () => {
      writeFileSync(storagePath, '{ not json', 'utf-8')
      const store = new BridgeApnsTokenStore({ storagePath })
      expect(store.size()).toBe(0)
    })

    it('starts empty on unknown schema version', () => {
      writeFileSync(storagePath, JSON.stringify({ version: 999, tokens: [] }), 'utf-8')
      const store = new BridgeApnsTokenStore({ storagePath })
      expect(store.size()).toBe(0)
    })

    it('skips invalid entries on load', () => {
      writeFileSync(
        storagePath,
        JSON.stringify({
          version: 1,
          tokens: [
            { pairID: 'good', deviceToken: 'tok', env: 'production', updatedAt: 1 },
            { pairID: 'bad' /* missing fields */ }
          ]
        }),
        'utf-8'
      )
      const store = new BridgeApnsTokenStore({ storagePath })
      expect(store.size()).toBe(1)
      expect(store.get('good')).toBeTruthy()
      expect(store.get('bad')).toBeNull()
    })

    it('persists via atomic rename (no tmp leak on success)', () => {
      const a = new BridgeApnsTokenStore({ storagePath })
      a.upsert('pair-1', 'tok-1', 'production')
      const onDisk = JSON.parse(readFileSync(storagePath, 'utf-8'))
      expect(onDisk.version).toBe(1)
      expect(onDisk.tokens).toHaveLength(1)
      let tmpExists = false
      try {
        readFileSync(`${storagePath}.tmp`)
        tmpExists = true
      } catch {
        tmpExists = false
      }
      expect(tmpExists).toBe(false)
    })

    it('is in-memory only when no storagePath is provided', () => {
      const a = new BridgeApnsTokenStore()
      a.upsert('pair-1', 'tok-1', 'production')
      const b = new BridgeApnsTokenStore()
      expect(b.size()).toBe(0)
    })
  })
})
