import { describe, expect, it, vi } from 'vitest'
import {
  WorkspaceService,
  type WorkspaceAllowlistStore,
  type WorkspaceServiceDeps,
  type WorkspaceServiceStore
} from './WorkspaceService'
import type { RemoteWorkspaceEntry } from '../RemoteWorkspaceAllowlist'
import type { WorkspaceRecord } from '../store/types'

function makeWorkspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: 'workspace-1',
    path: '/repo',
    displayName: 'repo',
    createdAt: 1,
    lastOpenedAt: 1,
    pinned: false,
    ...overrides
  }
}

function makeAllowlistEntry(overrides: Partial<RemoteWorkspaceEntry> = {}): RemoteWorkspaceEntry {
  return {
    workspaceId: 'workspace-1',
    path: '/repo',
    mode: 'read-write',
    allowedProviders: ['gemini', 'codex'],
    allowedApprovalModes: ['default', 'plan'],
    createdAt: 1,
    updatedAt: 2,
    ...overrides
  }
}

function makeStore(overrides: Partial<WorkspaceServiceStore> = {}): WorkspaceServiceStore {
  return {
    getWorkspaces: vi.fn(() => [makeWorkspace()]),
    addOrUpdateWorkspace: vi.fn((workspacePath: string, partial?: Partial<WorkspaceRecord>) =>
      makeWorkspace({ path: workspacePath, ...partial })
    ),
    removeWorkspace: vi.fn(),
    clearWorkspaces: vi.fn(),
    ...overrides
  }
}

function makeAllowlist(overrides: Partial<WorkspaceAllowlistStore> = {}): WorkspaceAllowlistStore {
  return {
    list: vi.fn(() => [makeAllowlistEntry()]),
    upsert: vi.fn((entry) => makeAllowlistEntry(entry)),
    remove: vi.fn(() => true),
    clear: vi.fn(),
    ...overrides
  }
}

function makeDeps(overrides: Partial<WorkspaceServiceDeps> = {}): {
  deps: WorkspaceServiceDeps
  store: WorkspaceServiceStore
  allowlist: WorkspaceAllowlistStore
} {
  const store = makeStore()
  const allowlist = makeAllowlist()
  const deps: WorkspaceServiceDeps = {
    appStore: store,
    allowlist,
    canonicalPath: vi.fn((value: string) => value.replace('/input', '/repo')),
    selectDirectory: vi.fn(async () => '/input'),
    checkTrust: vi.fn(() => ({ status: 'trusted' as const })),
    ...overrides
  }
  return { deps, store: deps.appStore, allowlist: deps.allowlist }
}

describe('WorkspaceService', () => {
  it('returns workspaces from the injected store', () => {
    const { deps, store } = makeDeps()
    const service = new WorkspaceService(deps)
    expect(service.getWorkspaces()).toEqual([makeWorkspace()])
    expect(store.getWorkspaces).toHaveBeenCalledTimes(1)
  })

  it('updates only registered workspaces and sanitizes partial fields', () => {
    const { deps, store } = makeDeps()
    const service = new WorkspaceService(deps)
    const workspace = service.addOrUpdateWorkspace('/input', {
      displayName: 'Renamed',
      branch: 'main',
      pinned: true,
      notes: 'ignored',
      geminiWorktree: {
        enabled: true,
        name: 'feature'
      }
    })
    expect(workspace.path).toBe('/repo')
    expect(store.addOrUpdateWorkspace).toHaveBeenCalledWith('/repo', {
      displayName: 'Renamed',
      branch: 'main',
      pinned: true,
      geminiWorktree: {
        enabled: true,
        name: 'feature'
      }
    })
  })

  it('preserves the original unregistered workspace error', () => {
    const store = makeStore({ getWorkspaces: vi.fn(() => []) })
    const { deps } = makeDeps({ appStore: store })
    const service = new WorkspaceService(deps)
    expect(() => service.addOrUpdateWorkspace('/input')).toThrow(
      'Workspace must be selected through AGBench before it can be used.'
    )
    expect(store.addOrUpdateWorkspace).not.toHaveBeenCalled()
  })

  it('selectWorkspace returns null when the native picker has no path', async () => {
    const { deps, store } = makeDeps({
      selectDirectory: vi.fn(async () => null)
    })
    const service = new WorkspaceService(deps)
    await expect(service.selectWorkspace()).resolves.toBeNull()
    expect(store.addOrUpdateWorkspace).not.toHaveBeenCalled()
  })

  it('selectWorkspace registers a safe native selection', async () => {
    const { deps, store } = makeDeps()
    const service = new WorkspaceService(deps)
    await expect(service.selectWorkspace()).resolves.toEqual(makeWorkspace({ path: '/repo' }))
    expect(store.addOrUpdateWorkspace).toHaveBeenCalledWith('/repo')
  })

  it('rejects filesystem roots when registering native selections', async () => {
    const { deps, store } = makeDeps({
      canonicalPath: vi.fn(() => '/')
    })
    const service = new WorkspaceService(deps)
    await expect(service.selectWorkspace()).rejects.toThrow(
      'Filesystem roots cannot be registered as workspaces.'
    )
    expect(store.addOrUpdateWorkspace).not.toHaveBeenCalled()
  })

  it('validates and upserts remote allowlist entries with the original shape', () => {
    const { deps, allowlist } = makeDeps()
    const service = new WorkspaceService(deps)
    const result = service.upsertRemoteAllowlist({
      workspaceId: 'workspace-1',
      path: '/repo',
      mode: 'read-only',
      allowedProviders: ['gemini'],
      allowedApprovalModes: ['default'],
      expiresAt: 100
    })
    expect(result.mode).toBe('read-only')
    expect(allowlist.upsert).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      path: '/repo',
      mode: 'read-only',
      allowedProviders: ['gemini'],
      allowedApprovalModes: ['default'],
      expiresAt: 100
    })
  })

  it('keeps remote allowlist validation error messages stable', () => {
    const { deps, allowlist } = makeDeps()
    const service = new WorkspaceService(deps)
    expect(() =>
      service.upsertRemoteAllowlist({
        workspaceId: 'workspace-1',
        path: '/repo',
        mode: 'bad' as 'read-only',
        allowedProviders: ['gemini'],
        allowedApprovalModes: ['default']
      })
    ).toThrow("bridge-allowlist-upsert: mode must be 'read-only' or 'read-write' (got 'bad')")
    expect(() =>
      service.upsertRemoteAllowlist({
        workspaceId: 'workspace-1',
        path: '/repo',
        mode: 'read-only',
        allowedProviders: ['gemini'],
        allowedApprovalModes: ['default'],
        expiresAt: 0
      })
    ).toThrow('bridge-allowlist-upsert: expiresAt must be a positive number (ms since epoch)')
    expect(allowlist.upsert).not.toHaveBeenCalled()
  })

  it('removes and clears remote allowlist entries through stable IPC return values', () => {
    const { deps, allowlist } = makeDeps()
    const service = new WorkspaceService(deps)
    expect(service.removeRemoteAllowlist('workspace-1')).toBe(true)
    expect(allowlist.remove).toHaveBeenCalledWith('workspace-1')
    expect(service.clearRemoteAllowlist()).toBe(true)
    expect(allowlist.clear).toHaveBeenCalledTimes(1)
  })

  it('checks trust only after the workspace is registered', () => {
    const { deps } = makeDeps()
    const service = new WorkspaceService(deps)
    expect(service.checkTrust('/input')).toEqual({ status: 'trusted' })
    expect(deps.checkTrust).toHaveBeenCalledWith('/repo')
  })
})
