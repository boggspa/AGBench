import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  READ_ONLY_REMOTE_WORKSPACE_CAPABILITIES,
  READ_WRITE_REMOTE_WORKSPACE_CAPABILITIES,
  RemoteWorkspaceAllowlist,
  capabilitiesForRemoteWorkspaceEntry,
  capabilitiesForRemoteWorkspaceMode
} from './RemoteWorkspaceAllowlist'

describe('RemoteWorkspaceAllowlist', () => {
  describe('CRUD', () => {
    it('starts empty', () => {
      const allowlist = new RemoteWorkspaceAllowlist()
      expect(allowlist.size()).toBe(0)
      expect(allowlist.list()).toEqual([])
      expect(allowlist.get('anything')).toBeNull()
    })

    it('upserts a new entry with timestamps', () => {
      const allowlist = new RemoteWorkspaceAllowlist({ now: () => 1000 })
      const entry = allowlist.upsert({
        workspaceId: 'ws-1',
        path: '/Users/foo/projects/a',
        mode: 'read-write',
        allowedProviders: ['gemini'],
        allowedApprovalModes: ['default', 'plan']
      })
      expect(entry.workspaceId).toBe('ws-1')
      expect(entry.createdAt).toBe(1000)
      expect(entry.updatedAt).toBe(1000)
      expect(allowlist.size()).toBe(1)
    })

    it('updates an existing entry while preserving createdAt', () => {
      let clock = 1000
      const allowlist = new RemoteWorkspaceAllowlist({ now: () => clock })
      allowlist.upsert({
        workspaceId: 'ws-1',
        path: '/a',
        mode: 'read-only',
        allowedProviders: ['gemini'],
        allowedApprovalModes: ['default']
      })
      clock = 2000
      const updated = allowlist.upsert({
        workspaceId: 'ws-1',
        path: '/a',
        mode: 'read-write',
        allowedProviders: ['gemini', 'codex'],
        allowedApprovalModes: ['default', 'plan']
      })
      expect(updated.createdAt).toBe(1000)
      expect(updated.updatedAt).toBe(2000)
      expect(updated.mode).toBe('read-write')
      expect(updated.allowedProviders).toEqual(['gemini', 'codex'])
    })

    it('removes an entry and reports whether it existed', () => {
      const allowlist = new RemoteWorkspaceAllowlist()
      allowlist.upsert({
        workspaceId: 'ws-1',
        path: '/a',
        mode: 'read-write',
        allowedProviders: ['gemini'],
        allowedApprovalModes: ['default']
      })
      expect(allowlist.remove('ws-1')).toBe(true)
      expect(allowlist.remove('ws-1')).toBe(false)
      expect(allowlist.size()).toBe(0)
    })

    it('clears all entries', () => {
      const allowlist = new RemoteWorkspaceAllowlist()
      allowlist.upsert({
        workspaceId: 'ws-1',
        path: '/a',
        mode: 'read-write',
        allowedProviders: ['gemini'],
        allowedApprovalModes: ['default']
      })
      allowlist.upsert({
        workspaceId: 'ws-2',
        path: '/b',
        mode: 'read-only',
        allowedProviders: ['claude'],
        allowedApprovalModes: ['default']
      })
      allowlist.clear()
      expect(allowlist.size()).toBe(0)
    })
  })

  describe('evaluate', () => {
    const seed = (clock = 1000) => {
      const allowlist = new RemoteWorkspaceAllowlist({ now: () => clock })
      allowlist.upsert({
        workspaceId: 'ws-1',
        path: '/a',
        mode: 'read-write',
        allowedProviders: ['gemini', 'codex'],
        allowedApprovalModes: ['default', 'plan']
      })
      return allowlist
    }

    it('denies an unlisted workspace', () => {
      const allowlist = seed()
      const decision = allowlist.evaluate({ workspaceId: 'ws-missing' })
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) {
        expect(decision.reason).toMatch(/not on the remote allowlist/i)
      }
    })

    it('allows a listed workspace with no extra checks', () => {
      const allowlist = seed()
      const decision = allowlist.evaluate({ workspaceId: 'ws-1' })
      expect(decision.allowed).toBe(true)
    })

    it('denies a listed workspace when its provider is not allowed', () => {
      const allowlist = seed()
      const decision = allowlist.evaluate({ workspaceId: 'ws-1', provider: 'claude' })
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) {
        expect(decision.reason).toMatch(/provider "claude"/i)
      }
    })

    it('allows a listed workspace when the provider is allowed', () => {
      const allowlist = seed()
      const decision = allowlist.evaluate({ workspaceId: 'ws-1', provider: 'gemini' })
      expect(decision.allowed).toBe(true)
    })

    it('denies a listed workspace when approvalMode is not allowed', () => {
      const allowlist = seed()
      const decision = allowlist.evaluate({
        workspaceId: 'ws-1',
        provider: 'gemini',
        approvalMode: 'allow-all'
      })
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) {
        expect(decision.reason).toMatch(/approval mode "allow-all"/i)
      }
    })

    it('maps legacy read-only mode to monitor + approve capabilities', () => {
      const allowlist = new RemoteWorkspaceAllowlist()
      allowlist.upsert({
        workspaceId: 'ws-readonly',
        path: '/a',
        mode: 'read-only',
        allowedProviders: ['gemini'],
        allowedApprovalModes: ['default']
      })
      expect(capabilitiesForRemoteWorkspaceMode('read-only')).toEqual(
        READ_ONLY_REMOTE_WORKSPACE_CAPABILITIES
      )
      expect(
        allowlist.evaluate({ workspaceId: 'ws-readonly', capability: 'approve' }).allowed
      ).toBe(true)
      const decision = allowlist.evaluate({ workspaceId: 'ws-readonly', capability: 'startTurn' })
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) {
        expect(decision.reason).toMatch(/capability "startTurn"/i)
      }
    })

    it('maps legacy read-write mode to the default task-console capability set', () => {
      const allowlist = seed()
      expect(capabilitiesForRemoteWorkspaceMode('read-write')).toEqual(
        READ_WRITE_REMOTE_WORKSPACE_CAPABILITIES
      )
      expect(allowlist.evaluate({ workspaceId: 'ws-1', capability: 'startTurn' }).allowed).toBe(
        true
      )
      expect(allowlist.evaluate({ workspaceId: 'ws-1', capability: 'yolo' }).allowed).toBe(false)
    })

    it('uses explicit capabilities when present instead of mode defaults', () => {
      const allowlist = new RemoteWorkspaceAllowlist()
      const entry = allowlist.upsert({
        workspaceId: 'ws-custom',
        path: '/a',
        mode: 'read-write',
        capabilities: ['monitor', 'approve'],
        allowedProviders: ['gemini'],
        allowedApprovalModes: ['default']
      })
      expect(capabilitiesForRemoteWorkspaceEntry(entry)).toEqual(['monitor', 'approve'])
      expect(allowlist.evaluate({ workspaceId: 'ws-custom', capability: 'approve' }).allowed).toBe(
        true
      )
      expect(allowlist.evaluate({ workspaceId: 'ws-custom', capability: 'yolo' }).allowed).toBe(
        false
      )
    })

    it('treats an expired entry as denied', () => {
      let clock = 1000
      const allowlist = new RemoteWorkspaceAllowlist({ now: () => clock })
      allowlist.upsert({
        workspaceId: 'ws-1',
        path: '/a',
        mode: 'read-write',
        allowedProviders: ['gemini'],
        allowedApprovalModes: ['default'],
        expiresAt: 5000
      })
      // Within window.
      clock = 4999
      expect(allowlist.evaluate({ workspaceId: 'ws-1' }).allowed).toBe(true)
      // Exactly at expiry — denied (the boundary is exclusive on the right).
      clock = 5000
      const atBoundary = allowlist.evaluate({ workspaceId: 'ws-1' })
      expect(atBoundary.allowed).toBe(false)
      // After expiry.
      clock = 10_000
      const afterExpiry = allowlist.evaluate({ workspaceId: 'ws-1' })
      expect(afterExpiry.allowed).toBe(false)
      if (!afterExpiry.allowed) {
        expect(afterExpiry.reason).toMatch(/expired/i)
      }
    })
  })

  describe('persistence', () => {
    let tmpDir: string
    let storagePath: string

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'allowlist-test-'))
      storagePath = join(tmpDir, 'allowlist.json')
    })

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('round-trips entries through disk', () => {
      const a = new RemoteWorkspaceAllowlist({ storagePath, now: () => 1000 })
      a.upsert({
        workspaceId: 'ws-1',
        path: '/a',
        mode: 'read-write',
        allowedProviders: ['gemini'],
        allowedApprovalModes: ['default', 'plan'],
        expiresAt: 9999
      })
      a.upsert({
        workspaceId: 'ws-2',
        path: '/b',
        mode: 'read-only',
        capabilities: ['monitor', 'approve'],
        allowedProviders: ['claude'],
        allowedApprovalModes: ['default']
      })

      // Reload via a fresh instance pointed at the same path.
      const b = new RemoteWorkspaceAllowlist({ storagePath, now: () => 1500 })
      expect(b.size()).toBe(2)
      expect(b.get('ws-1')?.mode).toBe('read-write')
      expect(b.get('ws-1')?.expiresAt).toBe(9999)
      expect(b.get('ws-2')?.mode).toBe('read-only')
      expect(b.get('ws-2')?.capabilities).toEqual(['monitor', 'approve'])
    })

    it('creates intermediate directories', () => {
      const deepPath = join(tmpDir, 'nested', 'a', 'b', 'allowlist.json')
      const a = new RemoteWorkspaceAllowlist({ storagePath: deepPath })
      a.upsert({
        workspaceId: 'ws-1',
        path: '/a',
        mode: 'read-write',
        allowedProviders: ['gemini'],
        allowedApprovalModes: ['default']
      })
      const reloaded = new RemoteWorkspaceAllowlist({ storagePath: deepPath })
      expect(reloaded.size()).toBe(1)
    })

    it('starts empty when the file is malformed', () => {
      writeFileSync(storagePath, '{ not valid json', 'utf-8')
      const allowlist = new RemoteWorkspaceAllowlist({ storagePath })
      expect(allowlist.size()).toBe(0)
    })

    it('starts empty when version is unknown', () => {
      writeFileSync(storagePath, JSON.stringify({ version: 999, entries: [] }), 'utf-8')
      const allowlist = new RemoteWorkspaceAllowlist({ storagePath })
      expect(allowlist.size()).toBe(0)
    })

    it('skips invalid entries when loading', () => {
      const goodEntry = {
        workspaceId: 'good',
        path: '/g',
        mode: 'read-write',
        allowedProviders: ['gemini'],
        allowedApprovalModes: ['default'],
        createdAt: 1,
        updatedAt: 1
      }
      const badEntry = {
        workspaceId: 'bad'
        // missing required fields
      }
      writeFileSync(
        storagePath,
        JSON.stringify({ version: 1, entries: [goodEntry, badEntry] }),
        'utf-8'
      )
      const allowlist = new RemoteWorkspaceAllowlist({ storagePath })
      expect(allowlist.size()).toBe(1)
      expect(allowlist.get('good')).toBeTruthy()
      expect(allowlist.get('bad')).toBeNull()
    })

    it('persists atomic-rename-style (no tmp file leak on success)', () => {
      const a = new RemoteWorkspaceAllowlist({ storagePath })
      a.upsert({
        workspaceId: 'ws-1',
        path: '/a',
        mode: 'read-write',
        allowedProviders: ['gemini'],
        allowedApprovalModes: ['default']
      })
      const onDisk = JSON.parse(readFileSync(storagePath, 'utf-8'))
      expect(onDisk.version).toBe(1)
      expect(onDisk.entries).toHaveLength(1)
      // tmp file should be gone (renamed away)
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
      const a = new RemoteWorkspaceAllowlist()
      a.upsert({
        workspaceId: 'ws-1',
        path: '/a',
        mode: 'read-write',
        allowedProviders: ['gemini'],
        allowedApprovalModes: ['default']
      })
      // A second instance with no path sees nothing.
      const b = new RemoteWorkspaceAllowlist()
      expect(b.size()).toBe(0)
    })
  })
})
