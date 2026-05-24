import type { ExternalPathGrant, ProviderId } from './types'

export const EXTERNAL_PATH_GRANT_METADATA_KEYS = [
  'externalPathGrants',
  'codexExternalPathGrants',
  'claudeExternalPathGrants',
  'geminiExternalPathGrants',
  'kimiExternalPathGrants'
] as const

const KNOWN_PROVIDERS = new Set<ProviderId>(['gemini', 'codex', 'claude', 'kimi'])

function grantKey(grant: ExternalPathGrant): string {
  return `${grant.provider}:${grant.path}`
}

function isGrantLike(value: unknown): value is ExternalPathGrant {
  if (!value || typeof value !== 'object') return false
  const grant = value as Partial<ExternalPathGrant>
  return (
    typeof grant.id === 'string' &&
    typeof grant.path === 'string' &&
    KNOWN_PROVIDERS.has(grant.provider as ProviderId)
  )
}

export function coalesceExternalPathGrants(
  grants: Array<ExternalPathGrant | null | undefined>
): ExternalPathGrant[] {
  const byKey = new Map<string, ExternalPathGrant>()
  for (const grant of grants) {
    if (!isGrantLike(grant)) continue
    const path = grant.path.trim()
    if (!path) continue
    const access = grant.access === 'write' ? 'write' : 'read'
    const key = `${grant.provider}:${path}`
    const normalized: ExternalPathGrant = {
      ...grant,
      path,
      access,
      kind: grant.kind === 'directory' ? 'directory' : 'file',
      duration: grant.duration || 'thisThread'
    }
    const existing = byKey.get(key)
    if (!existing || (existing.access === 'read' && access === 'write')) {
      byKey.set(key, normalized)
    }
  }
  return [...byKey.values()]
}

export function externalPathGrantMetadataLists(
  metadata: Record<string, unknown> | null | undefined
): ExternalPathGrant[] {
  if (!metadata) return []
  return EXTERNAL_PATH_GRANT_METADATA_KEYS.flatMap((key) =>
    Array.isArray(metadata[key]) ? (metadata[key] as ExternalPathGrant[]) : []
  )
}

export function collectExternalPathGrantsFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): ExternalPathGrant[] {
  if (!metadata) return []
  const canonical = coalesceExternalPathGrants(
    Array.isArray(metadata.externalPathGrants)
      ? (metadata.externalPathGrants as ExternalPathGrant[])
      : []
  )
  const canonicalKeys = new Set(canonical.map(grantKey))
  const legacy = coalesceExternalPathGrants(
    EXTERNAL_PATH_GRANT_METADATA_KEYS.filter((key) => key !== 'externalPathGrants').flatMap(
      (key) => (Array.isArray(metadata[key]) ? (metadata[key] as ExternalPathGrant[]) : [])
    )
  )
  return [...canonical, ...legacy.filter((grant) => !canonicalKeys.has(grantKey(grant)))]
}

export function canonicalizeExternalPathGrantMetadata(
  metadata: Record<string, unknown> | null | undefined,
  nextGrants?: ExternalPathGrant[]
): Record<string, unknown> {
  const base = { ...(metadata || {}) }
  const grants = nextGrants
    ? coalesceExternalPathGrants(nextGrants)
    : collectExternalPathGrantsFromMetadata(base)
  for (const key of EXTERNAL_PATH_GRANT_METADATA_KEYS) {
    delete base[key]
  }
  return {
    ...base,
    externalPathGrants: grants
  }
}
