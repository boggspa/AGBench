/**
 * 1.0.5-C3 — Permission envelope derivation + enforcement for
 * child-agent delegations. Pure helpers; no I/O, no global
 * state. The sub-thread delegation path (1.0.5-C3 follow-on
 * integration) imports these to construct + check envelopes.
 *
 * **Design centre**: every child action goes through an
 * explicit envelope. Defaults deny — write/network/custom-tool
 * grants must be opted in by the parent. Read access defaults
 * to a non-mutating tool whitelist + an inherited (or empty)
 * file-read scope.
 *
 * Glob matching is intentionally simple — only `*` wildcards
 * within a single path segment + the standard "ends with `/`
 * means subtree" convention. We don't ship a full glob
 * implementation here because the existing `ExternalPathGrant`
 * matchers already cover that surface; this module just
 * provides the structural envelope + the scope-match primitive
 * the broader system layers on top of.
 */

import type { ActorChainEntry, PermissionEnvelope, ProviderId } from './store/types'

// Re-export so existing imports of `ActorChainEntry` from this
// module keep working (now sourced from the canonical
// `store/types` location after 1.0.5-C4).
export type { ActorChainEntry }

/**
 * The "read-only" preset toolset. A child with no explicit
 * `allowedTools` override gets this list — non-mutating reads
 * + searches + status checks. Anything mutating
 * (`write_file`, `apply_patch`, `run_shell`, `git_commit`,
 * etc.) is excluded.
 *
 * Exported so the orchestrator's delegation pre-flight can
 * surface this set in the approval modal ("by default the
 * child can call: read_file, list_directory, grep, …").
 */
export const READ_ONLY_TOOL_PRESET: ReadonlyArray<string> = Object.freeze([
  'read_file',
  'list_directory',
  'grep',
  'glob',
  'attached_window_status',
  'appwatch_status',
  'ide_app_status',
  'ide_app_capabilities',
  'list_running_ides',
  'provider_auth_status',
  'creative_app_status',
  'creative_app_capabilities',
  'approval_status',
  'list_ensemble_participants',
  'provider_usage_status'
])

export interface DerivePermissionEnvelopeInput {
  parentRunId: string
  parentEnvelope?: PermissionEnvelope
  childProvider?: ProviderId
  purpose: string
  /** Explicit grants from the delegation request. Any field left
   * unset falls through to the read-only default. */
  request: {
    allowedTools?: string[]
    fileReadScope?: string[]
    fileWriteScope?: string[]
    networkScope?: string[]
    expiry?: string
    redactionPatterns?: string[]
  }
  /** ISO now timestamp. */
  nowIso: string
  /** Stable id generator — injected so tests can pin the
   * envelopeId. */
  envelopeIdFor: (parentRunId: string) => string
}

/**
 * Derive a child envelope from a parent context + a delegation
 * request. The resulting envelope:
 *
 *   - `allowedTools`: the request's list if provided; otherwise
 *     the read-only preset.
 *   - `fileReadScope`: the request's list if provided; otherwise
 *     the parent's read scope (or empty if no parent envelope).
 *   - `fileWriteScope`: ONLY what the request explicitly grants.
 *     Defaults to empty — children can't write unless opted in.
 *   - `networkScope`: same as writes — explicit opt-in only.
 *   - `expiry`: request's expiry if set; otherwise inherits
 *     parent's expiry; otherwise undefined.
 *   - `redactionPatterns`: request's patterns merged on top of
 *     the parent's (deduplicated). A child can't relax parent
 *     redactions, only add to them.
 *
 * A child can never have BROADER permissions than its parent —
 * the derivation enforces that with a final clamp pass for
 * file scopes, network scope, allowed tools, and expiry.
 */
export function derivePermissionEnvelope(input: DerivePermissionEnvelopeInput): PermissionEnvelope {
  const allowedTools = input.request.allowedTools ?? [...READ_ONLY_TOOL_PRESET]
  const fileReadScope = input.request.fileReadScope ?? input.parentEnvelope?.fileReadScope ?? []
  const fileWriteScope = input.request.fileWriteScope ?? []
  const networkScope = input.request.networkScope ?? []
  // Expiry: explicit > inherited > undefined.
  const expiry = input.request.expiry ?? input.parentEnvelope?.expiry
  // Redaction: parent patterns + request patterns, deduplicated.
  const redactionPatterns = Array.from(
    new Set([
      ...(input.parentEnvelope?.redactionPatterns ?? []),
      ...(input.request.redactionPatterns ?? [])
    ])
  )
  const draft: PermissionEnvelope = {
    envelopeId: input.envelopeIdFor(input.parentRunId),
    parentRunId: input.parentRunId,
    parentEnvelopeId: input.parentEnvelope?.envelopeId,
    childProvider: input.childProvider,
    purpose: input.purpose,
    allowedTools,
    fileReadScope,
    fileWriteScope,
    networkScope,
    expiry,
    redactionPatterns,
    createdAt: input.nowIso
  }
  return clampEnvelopeToParent(draft, input.parentEnvelope)
}

/**
 * Pure clamping pass: ensure the draft child envelope is no
 * broader than its parent. If the parent forbade a tool /
 * scope / network host, the child can't grant it back. Used
 * inside `derivePermissionEnvelope` + exposed for tests + the
 * future "edit envelope mid-delegation" surface.
 */
export function clampEnvelopeToParent(
  draft: PermissionEnvelope,
  parent: PermissionEnvelope | undefined
): PermissionEnvelope {
  if (!parent) return draft
  return {
    ...draft,
    allowedTools: intersectGrants(draft.allowedTools, parent.allowedTools),
    fileReadScope: intersectGrants(draft.fileReadScope, parent.fileReadScope),
    fileWriteScope: intersectGrants(draft.fileWriteScope, parent.fileWriteScope),
    networkScope: intersectGrants(draft.networkScope, parent.networkScope),
    expiry: clampExpiry(draft.expiry, parent.expiry)
  }
}

/**
 * Intersect two grant lists: a child entry survives only if the
 * parent also has it (or the parent has `'*'`). Returns the
 * defensive intersection. Order preserved from the child's list.
 */
export function intersectGrants(child: string[], parent: string[]): string[] {
  if (parent.includes('*')) return [...child]
  return child.filter((entry) => parent.includes(entry))
}

/**
 * Return the EARLIER of two ISO expirys. If either is undefined,
 * the other wins. If both are undefined, undefined.
 */
export function clampExpiry(
  childExpiry: string | undefined,
  parentExpiry: string | undefined
): string | undefined {
  if (!childExpiry) return parentExpiry
  if (!parentExpiry) return childExpiry
  return Date.parse(childExpiry) <= Date.parse(parentExpiry) ? childExpiry : parentExpiry
}

/**
 * Check: is the envelope expired at `nowIso`? Envelopes with no
 * expiry are never expired. Malformed expiry strings are treated
 * as expired (defensive — if we can't parse it, refuse rather
 * than silently allow).
 */
export function isEnvelopeExpired(envelope: PermissionEnvelope, nowIso: string): boolean {
  if (!envelope.expiry) return false
  const expMs = Date.parse(envelope.expiry)
  if (!Number.isFinite(expMs)) return true
  const nowMs = Date.parse(nowIso)
  if (!Number.isFinite(nowMs)) return false
  return nowMs > expMs
}

/**
 * Check: is the named tool allowed by the envelope? `'*'` in
 * `allowedTools` means all tools. Returns false for any
 * envelope-already-expired case (caller should also check
 * `isEnvelopeExpired` and surface a clearer error in UI).
 */
export function isToolAllowedByEnvelope(envelope: PermissionEnvelope, toolName: string): boolean {
  if (envelope.allowedTools.includes('*')) return true
  return envelope.allowedTools.includes(toolName)
}

/**
 * Check: is the given resource path in scope for the requested
 * mode (`'read'` or `'write'`)? Matches against
 * `fileReadScope` / `fileWriteScope` using a simple shape:
 *
 *   - `'*'` matches any path
 *   - exact string match
 *   - trailing `/` match means subtree (`/repo/src/` matches
 *     `/repo/src/foo.ts`)
 *
 * Full glob handling lives in the existing path-grant matchers;
 * this primitive is intentionally simple so the envelope's
 * intent is easy to reason about in tests.
 */
export function isPathAllowedByEnvelope(
  envelope: PermissionEnvelope,
  path: string,
  mode: 'read' | 'write'
): boolean {
  const scope = mode === 'read' ? envelope.fileReadScope : envelope.fileWriteScope
  if (scope.length === 0) return false
  for (const entry of scope) {
    if (entry === '*') return true
    if (entry === path) return true
    if (entry.endsWith('/') && path.startsWith(entry)) return true
  }
  return false
}

/**
 * Check: is the given host reachable per the envelope's
 * networkScope? Host patterns:
 *
 *   - `'*'` matches any host
 *   - exact host match (`'github.com'` matches `'github.com'`
 *     but not `'api.github.com'`)
 *   - `'*.domain'` matches any subdomain (`'*.openai.com'`
 *     matches `'api.openai.com'` but not `'openai.com'`)
 */
export function isHostAllowedByEnvelope(envelope: PermissionEnvelope, host: string): boolean {
  if (envelope.networkScope.length === 0) return false
  for (const pattern of envelope.networkScope) {
    if (pattern === '*') return true
    if (pattern === host) return true
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2)
      if (host.endsWith(`.${suffix}`)) return true
    }
  }
  return false
}

/**
 * Walk the actor chain from a leaf envelope up to its root via
 * the registry. Returns the chain (leaf first → root last) of
 * `{ envelopeId, parentRunId, childProvider, purpose }`
 * summaries. Used by the audit log to record actor chains on
 * approval rows.
 *
 * Caller passes an envelope-by-id resolver (typically a function
 * scanning all chats for matching `permissionEnvelope.envelopeId`).
 * When the parentEnvelopeId is unknown the walk stops gracefully
 * — partial chains are better than throws.
 *
 * `ActorChainEntry` is defined in `store/types.ts` as of
 * 1.0.5-C4 so `ApprovalLedgerRecord` can reference it without a
 * circular import; this module re-exports it for callers that
 * already import here.
 */

export function walkActorChain(
  leaf: PermissionEnvelope,
  resolveParent: (envelopeId: string) => PermissionEnvelope | undefined
): ActorChainEntry[] {
  const chain: ActorChainEntry[] = []
  const visited = new Set<string>()
  let cursor: PermissionEnvelope | undefined = leaf
  while (cursor) {
    if (visited.has(cursor.envelopeId)) break // cycle guard
    visited.add(cursor.envelopeId)
    chain.push({
      envelopeId: cursor.envelopeId,
      parentRunId: cursor.parentRunId,
      childProvider: cursor.childProvider,
      purpose: cursor.purpose
    })
    if (!cursor.parentEnvelopeId) break
    cursor = resolveParent(cursor.parentEnvelopeId)
  }
  return chain
}
