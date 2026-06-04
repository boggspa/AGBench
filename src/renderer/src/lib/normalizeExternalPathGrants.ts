import type { ExternalPathGrant, ProviderId } from '../../../main/store/types'
import { coalesceExternalPathGrants } from '../../../main/store/ExternalPathGrants'

const normalizeExternalPathGrants = (value: unknown): ExternalPathGrant[] => {
  if (!Array.isArray(value)) return []
  const grants: ExternalPathGrant[] = []
  // Slice 2 of the external-path-redesign arc: the previous hard
  // filter `grant.provider !== 'codex'` was a leftover from the
  // era when only Codex CLI consumed external-path grants. The
  // CLI translation layer (`externalPathGrantsToCliAddDirArgs` in
  // main/index.ts) has been provider-agnostic for a while now —
  // Gemini, Claude, and Kimi all consume the same grant list via
  // `--add-dir <path>`. Loosen the filter so runtime-issued grants
  // for any provider can persist into chat metadata.
  // 1.0.6-CRUX21 — grok + cursor are first-class; their signed grants must
  // persist into chat metadata too (integrity still guarded by issuedBy/sig).
  const VALID_PROVIDERS: ReadonlySet<ProviderId> = new Set([
    'codex',
    'claude',
    'gemini',
    'kimi',
    'grok',
    'cursor'
  ])
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const grant = item as Partial<ExternalPathGrant>
    const providerToken = grant.provider as ProviderId | undefined
    if (!providerToken || !VALID_PROVIDERS.has(providerToken)) continue
    if (typeof grant.path !== 'string' || !grant.path.trim()) continue
    if (grant.issuedBy !== 'main' || typeof grant.signature !== 'string' || !grant.signature)
      continue
    const access = grant.access === 'write' ? 'write' : 'read'
    grants.push({
      id: grant.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      provider: providerToken,
      workspaceId: grant.workspaceId,
      chatId: grant.chatId,
      path: grant.path.trim(),
      kind: grant.kind === 'directory' ? 'directory' : 'file',
      access,
      duration: grant.duration || 'thisThread',
      securityScopedBookmark: grant.securityScopedBookmark,
      issuedBy: 'main',
      signature: grant.signature,
      createdAt: grant.createdAt || new Date().toISOString(),
      // 1.0.6-EW66 — preserve the persisted display order through
      // normalization so a user's drag-reorder survives reload.
      // `coalesceExternalPathGrants` (below) self-heals any missing
      // value from createdAt sequence, so undefined is safe here.
      order: typeof grant.order === 'number' ? grant.order : undefined
    })
  }
  return coalesceExternalPathGrants(grants)
}

export { normalizeExternalPathGrants }
