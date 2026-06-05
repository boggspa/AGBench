import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'

/**
 * RemoteWorkspaceAllowlist — Electron-side policy primitive for what an iOS
 * device is allowed to do against which workspace.
 *
 * Mirrors the shape of `CodexBridge/Sources/WorkspaceSecurity/
 * WorkspaceAllowlist.swift`, but the model lives Electron-side because
 * TaskWraith's main process owns the
 * workspace list and the agent runtime. The Swift bridge daemon never has
 * to know about workspaces directly; it just relays a `workspaceID` in
 * `bridge.requestPrepareStartTurnAck` and BridgeActionRouter consults this
 * allowlist before deciding.
 *
 * **Default policy: closed.** A workspace is NOT remote-accessible until the
 * user explicitly adds an entry. There is no "everything is read-only by
 * default" mode — the iOS device only sees workspaces the user has opted in.
 *
 * **Per-action revalidation** (per the C4 plan): `evaluate(...)` is called on
 * every iOS-initiated request, not just once at session open. A workspace
 * entry can carry an `expiresAt` so a paired phone can be granted access
 * for a bounded window (e.g. "next 2 hours") without manual revocation. We
 * also re-check provider + approvalMode on every call, because both might
 * have been tightened on the desktop between iOS requests.
 *
 * **Persistence** is best-effort JSON via atomic tmp-and-rename. When no
 * `storagePath` is provided the allowlist is purely in-memory (used by
 * tests and for ephemeral dev sessions). On read errors the in-memory
 * state is empty — we prefer "deny everything" over "load a possibly-
 * tampered allowlist".
 */

export type RemoteWorkspaceMode = 'read-only' | 'read-write'

export type RemoteWorkspaceCapability =
  | 'monitor'
  | 'approve'
  | 'answer'
  | 'cancel'
  | 'startTurn'
  | 'diffReview'
  | 'steer'
  /**
   * Admin-only remote capability. Not part of read-write task-console
   * defaults; it must be explicitly present on an allowlist entry before a
   * paired device can pin/unpin chats or workspaces.
   */
  | 'pin'
  /**
   * Admin-only remote capability. Not part of read-write task-console
   * defaults; it must be explicitly present on an allowlist entry before a
   * paired device can toggle session YOLO.
   */
  | 'yolo'

export const READ_ONLY_REMOTE_WORKSPACE_CAPABILITIES: readonly RemoteWorkspaceCapability[] = [
  'monitor',
  'approve'
]

export const READ_WRITE_REMOTE_WORKSPACE_CAPABILITIES: readonly RemoteWorkspaceCapability[] = [
  'monitor',
  'approve',
  'answer',
  'cancel',
  'startTurn',
  'diffReview',
  'steer'
]

export const ADMIN_REMOTE_WORKSPACE_CAPABILITIES: readonly RemoteWorkspaceCapability[] = [
  'pin',
  'yolo'
]

export interface RemoteWorkspaceCapabilityDescription {
  capability: RemoteWorkspaceCapability
  label: string
  description: string
  adminOnly: boolean
}

export const REMOTE_WORKSPACE_CAPABILITY_DESCRIPTIONS: Record<
  RemoteWorkspaceCapability,
  RemoteWorkspaceCapabilityDescription
> = {
  monitor: {
    capability: 'monitor',
    label: 'Monitor tasks',
    description: 'View remote task status, transcript projections, and pending prompts.',
    adminOnly: false
  },
  approve: {
    capability: 'approve',
    label: 'Approve prompts',
    description: 'Respond to desktop-origin approval requests from a paired device.',
    adminOnly: false
  },
  answer: {
    capability: 'answer',
    label: 'Answer questions',
    description: 'Send answers back to agent questions that are waiting for user input.',
    adminOnly: false
  },
  cancel: {
    capability: 'cancel',
    label: 'Cancel work',
    description: 'Cancel active runs, rounds, or pending wakeups from a paired device.',
    adminOnly: false
  },
  startTurn: {
    capability: 'startTurn',
    label: 'Start turns',
    description: 'Start a new provider turn against the allowlisted workspace.',
    adminOnly: false
  },
  diffReview: {
    capability: 'diffReview',
    label: 'Review diffs',
    description: 'Inspect bounded diff summaries sent to the paired device.',
    adminOnly: false
  },
  steer: {
    capability: 'steer',
    label: 'Steer ensembles',
    description: 'Queue, steer, skip, or wake Ensemble participants from the paired device.',
    adminOnly: false
  },
  pin: {
    capability: 'pin',
    label: 'Pin items (admin)',
    description: 'Pin or unpin chats and workspaces from a paired device.',
    adminOnly: true
  },
  yolo: {
    capability: 'yolo',
    label: 'Session YOLO (admin)',
    description: 'Toggle the desktop session YOLO approval bypass from a paired device.',
    adminOnly: true
  }
}

export interface RemoteWorkspaceEntry {
  /** Stable id used by TaskWraith's internal workspace registry. */
  workspaceId: string
  /** Absolute path on disk. Informational; not used for evaluation today. */
  path: string
  /** `read-only`: iOS can watch + approve, never mutate. `read-write`: iOS
   * can compose, run, and approve. The router uses this to gate actions
   * that mutate state (Phase C-late, when typed action payloads land). */
  mode: RemoteWorkspaceMode
  /** Optional future policy shape. When omitted, `mode` maps to the default
   * capability sets above so existing allowlist entries keep working until
   * the persisted store and renderer grow first-class capability controls. */
  capabilities?: RemoteWorkspaceCapability[]
  /** Provider IDs (e.g. `'gemini'`, `'codex'`, `'claude'`, `'kimi'`) that the
   * iOS client may select for this workspace. Empty array = no providers
   * allowed (the workspace is read-only-watch in practice). */
  allowedProviders: string[]
  /** Approval modes (`'default'`, `'plan'`, `'allow-all'`) the iOS client
   * may select. Typically `['default', 'plan']` for phone clients; we leave
   * `'allow-all'` out by default since that's a desktop-only escalation. */
  allowedApprovalModes: string[]
  /** Optional auto-revoke timestamp (ms since epoch). The desktop UI can
   * surface "expires in N minutes". After this point the entry is treated
   * as denied without being deleted (a grace period for renewal). */
  expiresAt?: number
  createdAt: number
  updatedAt: number
}

export interface PrepareStartTurnEvaluation {
  workspaceId: string
  /** Optional — the iOS prepare-start-turn payload may not always include a
   * provider hint. When omitted, only workspace + expiry + mode are checked. */
  provider?: string
  /** Same caveat as `provider`. */
  approvalMode?: string
  /** Optional fine-grained capability required by the action being evaluated. */
  capability?: RemoteWorkspaceCapability
}

export type AllowlistDecision =
  | { allowed: true; entry: RemoteWorkspaceEntry }
  | { allowed: false; reason: string }

export interface RemoteWorkspaceAllowlistOptions {
  /** Filesystem path for the JSON allowlist file. When omitted, the
   * allowlist is in-memory only (tests, ephemeral dev). */
  storagePath?: string
  /** Clock injectable for tests. */
  now?: () => number
  /** Logger sink. Defaults to no-op. Production wires console.log. */
  log?: (line: string) => void
}

interface PersistedShape {
  version: number
  entries: RemoteWorkspaceEntry[]
}

const SCHEMA_VERSION = 1

export class RemoteWorkspaceAllowlist {
  private readonly entries = new Map<string, RemoteWorkspaceEntry>()
  private readonly storagePath?: string
  private readonly now: () => number
  private readonly log: (line: string) => void

  constructor(options: RemoteWorkspaceAllowlistOptions = {}) {
    this.storagePath = options.storagePath
    this.now = options.now ?? (() => Date.now())
    this.log = options.log ?? (() => {})
    if (this.storagePath) {
      this.loadFromDisk()
    }
  }

  /** Number of entries currently held (active + expired). */
  size(): number {
    return this.entries.size
  }

  /** Add or replace an entry. Timestamps are managed internally. */
  upsert(entry: Omit<RemoteWorkspaceEntry, 'createdAt' | 'updatedAt'>): RemoteWorkspaceEntry {
    const now = this.now()
    const existing = this.entries.get(entry.workspaceId)
    const merged: RemoteWorkspaceEntry = {
      ...entry,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    this.entries.set(entry.workspaceId, merged)
    this.persist()
    this.log(
      `[RemoteWorkspaceAllowlist] upserted workspaceId=${entry.workspaceId} mode=${entry.mode}`
    )
    return merged
  }

  /** Remove an entry. Returns whether anything was removed. */
  remove(workspaceId: string): boolean {
    const had = this.entries.delete(workspaceId)
    if (had) {
      this.persist()
      this.log(`[RemoteWorkspaceAllowlist] removed workspaceId=${workspaceId}`)
    }
    return had
  }

  /** Snapshot of all entries (caller may not mutate the array members). */
  list(): RemoteWorkspaceEntry[] {
    return Array.from(this.entries.values())
  }

  get(workspaceId: string): RemoteWorkspaceEntry | null {
    return this.entries.get(workspaceId) ?? null
  }

  /** Drop every entry. Useful for tests and the future admin "revoke all"
   * action. Persists immediately. */
  clear(): void {
    if (this.entries.size === 0) return
    this.entries.clear()
    this.persist()
    this.log('[RemoteWorkspaceAllowlist] cleared all entries')
  }

  /** Per-action revalidation hook. Called on every iOS request that names
   * a workspace. Returns a structured decision so the router can surface a
   * useful reason in the ack message. */
  evaluate(check: PrepareStartTurnEvaluation): AllowlistDecision {
    const entry = this.entries.get(check.workspaceId)
    if (!entry) {
      return {
        allowed: false,
        reason: `Workspace "${check.workspaceId}" is not on the remote allowlist`
      }
    }
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      return {
        allowed: false,
        reason: `Workspace "${check.workspaceId}" allowlist entry expired at ${new Date(entry.expiresAt).toISOString()}`
      }
    }
    if (check.provider !== undefined && !entry.allowedProviders.includes(check.provider)) {
      return {
        allowed: false,
        reason: `Provider "${check.provider}" is not allowed for workspace "${check.workspaceId}"`
      }
    }
    if (
      check.approvalMode !== undefined &&
      !entry.allowedApprovalModes.includes(check.approvalMode)
    ) {
      return {
        allowed: false,
        reason: `Approval mode "${check.approvalMode}" is not allowed for workspace "${check.workspaceId}"`
      }
    }
    if (
      check.capability !== undefined &&
      !capabilitiesForRemoteWorkspaceEntry(entry).includes(check.capability)
    ) {
      const description = describeRemoteWorkspaceCapability(check.capability)
      return {
        allowed: false,
        reason: `Capability "${check.capability}" (${description.label}) is not allowed for workspace "${check.workspaceId}"`
      }
    }
    return { allowed: true, entry }
  }

  // MARK: - Persistence

  private persist(): void {
    if (!this.storagePath) return
    try {
      mkdirSync(dirname(this.storagePath), { recursive: true })
      const data: PersistedShape = {
        version: SCHEMA_VERSION,
        entries: Array.from(this.entries.values())
      }
      const serialized = JSON.stringify(data, null, 2)
      const tmpPath = `${this.storagePath}.tmp`
      writeFileSync(tmpPath, serialized, 'utf-8')
      renameSync(tmpPath, this.storagePath)
    } catch (err) {
      this.log(
        `[RemoteWorkspaceAllowlist] persist failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  private loadFromDisk(): void {
    if (!this.storagePath || !existsSync(this.storagePath)) return
    try {
      const raw = readFileSync(this.storagePath, 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      if (!isPersistedShape(parsed)) {
        this.log(
          `[RemoteWorkspaceAllowlist] discarded malformed allowlist file at ${this.storagePath}`
        )
        return
      }
      if (parsed.version !== SCHEMA_VERSION) {
        // Future migration hook lands here. For now: drop unknown versions.
        this.log(
          `[RemoteWorkspaceAllowlist] unknown schema version ${parsed.version} — starting empty`
        )
        return
      }
      for (const entry of parsed.entries) {
        if (isValidEntry(entry)) {
          this.entries.set(entry.workspaceId, entry)
        }
      }
      this.log(
        `[RemoteWorkspaceAllowlist] loaded ${this.entries.size} entries from ${this.storagePath}`
      )
    } catch (err) {
      this.log(
        `[RemoteWorkspaceAllowlist] load failed (starting empty): ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}

export function capabilitiesForRemoteWorkspaceMode(
  mode: RemoteWorkspaceMode
): readonly RemoteWorkspaceCapability[] {
  return mode === 'read-only'
    ? READ_ONLY_REMOTE_WORKSPACE_CAPABILITIES
    : READ_WRITE_REMOTE_WORKSPACE_CAPABILITIES
}

export function capabilitiesForRemoteWorkspaceEntry(
  entry: RemoteWorkspaceEntry
): readonly RemoteWorkspaceCapability[] {
  return entry.capabilities ?? capabilitiesForRemoteWorkspaceMode(entry.mode)
}

export function isAdminRemoteWorkspaceCapability(
  capability: RemoteWorkspaceCapability
): boolean {
  return ADMIN_REMOTE_WORKSPACE_CAPABILITIES.includes(capability)
}

export function describeRemoteWorkspaceCapability(
  capability: RemoteWorkspaceCapability
): RemoteWorkspaceCapabilityDescription {
  return REMOTE_WORKSPACE_CAPABILITY_DESCRIPTIONS[capability]
}

export function isRemoteWorkspaceCapability(value: unknown): value is RemoteWorkspaceCapability {
  return (
    value === 'monitor' ||
    value === 'approve' ||
    value === 'answer' ||
    value === 'cancel' ||
    value === 'startTurn' ||
    value === 'diffReview' ||
    value === 'steer' ||
    value === 'pin' ||
    value === 'yolo'
  )
}

function isPersistedShape(value: unknown): value is PersistedShape {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.version === 'number' && Array.isArray(v.entries)
}

function isValidEntry(value: unknown): value is RemoteWorkspaceEntry {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.workspaceId === 'string' &&
    typeof v.path === 'string' &&
    (v.mode === 'read-only' || v.mode === 'read-write') &&
    (v.capabilities === undefined ||
      (Array.isArray(v.capabilities) &&
        (v.capabilities as unknown[]).every(isRemoteWorkspaceCapability))) &&
    Array.isArray(v.allowedProviders) &&
    (v.allowedProviders as unknown[]).every((p) => typeof p === 'string') &&
    Array.isArray(v.allowedApprovalModes) &&
    (v.allowedApprovalModes as unknown[]).every((p) => typeof p === 'string') &&
    typeof v.createdAt === 'number' &&
    typeof v.updatedAt === 'number' &&
    (v.expiresAt === undefined || typeof v.expiresAt === 'number')
  )
}
