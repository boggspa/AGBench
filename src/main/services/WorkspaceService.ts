import { parse } from 'path'
import type { RemoteWorkspaceEntry } from '../RemoteWorkspaceAllowlist'
import type { TrustStatusResult, WorkspaceRecord } from '../store/types'

export type RemoteAllowlistUpsertInput = Omit<RemoteWorkspaceEntry, 'createdAt' | 'updatedAt'>

export interface WorkspaceServiceStore {
  getWorkspaces: () => WorkspaceRecord[]
  addOrUpdateWorkspace: (
    workspacePath: string,
    partial?: Partial<WorkspaceRecord>
  ) => WorkspaceRecord
  removeWorkspace: (id: string) => void
  clearWorkspaces: () => void
}

export interface WorkspaceAllowlistStore {
  list: () => RemoteWorkspaceEntry[]
  upsert: (entry: RemoteAllowlistUpsertInput) => RemoteWorkspaceEntry
  remove: (workspaceId: string) => boolean
  clear: () => void
}

export interface WorkspaceServiceDeps {
  appStore: WorkspaceServiceStore
  allowlist: WorkspaceAllowlistStore
  canonicalPath: (path: string) => string
  selectDirectory: () => Promise<string | null>
  checkTrust: (workspacePath: string) => TrustStatusResult
}

/**
 * WorkspaceService — Phase B4 extraction.
 *
 * Owns the workspace/admin IPC policy while keeping path persistence
 * inside AppStore and remote allowlist persistence inside the existing
 * RemoteWorkspaceAllowlist instance.
 */
export class WorkspaceService {
  constructor(private deps: WorkspaceServiceDeps) {}

  getWorkspaces(): WorkspaceRecord[] {
    return this.deps.appStore.getWorkspaces()
  }

  addOrUpdateWorkspace(path: string, partial: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
    const workspacePath = this.requireRegisteredWorkspace(path)
    return this.deps.appStore.addOrUpdateWorkspace(
      workspacePath,
      this.safeWorkspacePartial(partial)
    )
  }

  removeWorkspace(id: string): void {
    this.deps.appStore.removeWorkspace(id)
  }

  clearWorkspaces(): void {
    this.deps.appStore.clearWorkspaces()
  }

  async selectWorkspace(): Promise<WorkspaceRecord | null> {
    const path = await this.deps.selectDirectory()
    if (!path) return null
    return this.addWorkspaceFromNativeSelection(path)
  }

  listRemoteAllowlist(): RemoteWorkspaceEntry[] {
    return this.deps.allowlist.list()
  }

  upsertRemoteAllowlist(entry: RemoteAllowlistUpsertInput): RemoteWorkspaceEntry {
    if (!entry || typeof entry !== 'object') {
      throw new Error('bridge-allowlist-upsert: entry must be an object')
    }
    const workspaceId = requireNonEmptyString(entry.workspaceId, 'workspaceId')
    const path = requireNonEmptyString(entry.path, 'path')
    if (entry.mode !== 'read-only' && entry.mode !== 'read-write') {
      throw new Error(
        `bridge-allowlist-upsert: mode must be 'read-only' or 'read-write' (got '${entry.mode}')`
      )
    }
    if (
      !Array.isArray(entry.allowedProviders) ||
      !entry.allowedProviders.every((p) => typeof p === 'string')
    ) {
      throw new Error('bridge-allowlist-upsert: allowedProviders must be string[]')
    }
    if (
      !Array.isArray(entry.allowedApprovalModes) ||
      !entry.allowedApprovalModes.every((p) => typeof p === 'string')
    ) {
      throw new Error('bridge-allowlist-upsert: allowedApprovalModes must be string[]')
    }
    if (
      entry.expiresAt !== undefined &&
      (typeof entry.expiresAt !== 'number' || entry.expiresAt <= 0)
    ) {
      throw new Error(
        'bridge-allowlist-upsert: expiresAt must be a positive number (ms since epoch)'
      )
    }
    return this.deps.allowlist.upsert({
      workspaceId,
      path,
      mode: entry.mode,
      allowedProviders: entry.allowedProviders,
      allowedApprovalModes: entry.allowedApprovalModes,
      expiresAt: entry.expiresAt
    })
  }

  removeRemoteAllowlist(workspaceId: string): boolean {
    return this.deps.allowlist.remove(requireNonEmptyString(workspaceId, 'workspaceId'))
  }

  clearRemoteAllowlist(): true {
    this.deps.allowlist.clear()
    return true
  }

  checkTrust(workspacePath: string): TrustStatusResult {
    return this.deps.checkTrust(this.requireRegisteredWorkspace(workspacePath))
  }

  findRegisteredWorkspace(workspacePath: string): WorkspaceRecord | undefined {
    const normalized = this.deps.canonicalPath(workspacePath)
    return this.deps.appStore
      .getWorkspaces()
      .find((workspace) => this.deps.canonicalPath(workspace.path) === normalized)
  }

  requireRegisteredWorkspace(workspacePath: string, label = 'Workspace'): string {
    const normalized = this.deps.canonicalPath(requireNonEmptyString(workspacePath, label))
    this.assertSafeWorkspaceRoot(normalized)
    if (!this.findRegisteredWorkspace(normalized)) {
      throw new Error(`${label} must be selected through AGBench before it can be used.`)
    }
    return normalized
  }

  addWorkspaceFromNativeSelection(workspacePath: string): WorkspaceRecord {
    const normalized = this.deps.canonicalPath(requireNonEmptyString(workspacePath, 'Workspace'))
    this.assertSafeWorkspaceRoot(normalized)
    return this.deps.appStore.addOrUpdateWorkspace(normalized)
  }

  private safeWorkspacePartial(partial: Partial<WorkspaceRecord> = {}): Partial<WorkspaceRecord> {
    const allowed: Partial<WorkspaceRecord> = {}
    if (typeof partial.displayName === 'string') allowed.displayName = partial.displayName
    if (typeof partial.branch === 'string') allowed.branch = partial.branch
    if (typeof partial.pinned === 'boolean') allowed.pinned = partial.pinned
    if ('geminiWorktree' in partial) {
      const geminiWorktree = sanitizeWorkspaceGeminiWorktree(partial.geminiWorktree)
      if (geminiWorktree) allowed.geminiWorktree = geminiWorktree
    }
    return allowed
  }

  private assertSafeWorkspaceRoot(workspacePath: string): void {
    const normalized = this.deps.canonicalPath(workspacePath)
    const root = parse(normalized).root
    if (normalized === root) {
      throw new Error('Filesystem roots cannot be registered as workspaces.')
    }
  }
}

function sanitizeWorkspaceGeminiWorktree(
  value: unknown
): WorkspaceRecord['geminiWorktree'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const sanitized: WorkspaceRecord['geminiWorktree'] = {
    enabled: Boolean(record.enabled)
  }
  if (typeof record.name === 'string' && record.name.trim()) {
    sanitized.name = record.name.trim()
  }
  return sanitized
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`)
  }
  return value
}
