/**
 * Canonical workspace-id resolution.
 *
 * Chat records in the store carry TWO workspace-id conventions: real
 * workspace uuids, and legacy display-name ids (e.g. `workspaceId:
 * "Test 3"`) written by older folder-chip flows. The desktop sidebar
 * tolerates both, so the data never got migrated — which means every
 * boundary that compares a chat's workspaceId against a WorkspaceRecord.id
 * (remote allowlist visibility, projection grouping, chat↔workspace
 * identity validation) must resolve the legacy form or it silently
 * mismatches: allowlisted workspaces project EMPTY to a paired phone and
 * legacy chats reject follow-up turns.
 *
 * Resolution order: exact id → unique displayName → normalized path.
 * Returns null when nothing matches — callers choose their own fallback
 * (visibility treats null as not-visible; identity validation falls back
 * to the strict comparison it always did).
 */

import type { WorkspaceRecord } from './store/types'

export function resolveCanonicalWorkspaceId(
  workspaceId: string | null | undefined,
  workspaces: readonly WorkspaceRecord[],
  normalizePath?: (value: string) => string
): string | null {
  if (!workspaceId) return null
  const raw = workspaceId.trim()
  if (!raw) return null
  if (workspaces.some((ws) => ws.id === raw)) return raw
  const byName = workspaces.filter((ws) => (ws.displayName || '').trim() === raw)
  if (byName.length === 1) return byName[0].id
  if (normalizePath) {
    const normalized = tryNormalize(raw, normalizePath)
    if (normalized) {
      const byPath = workspaces.find(
        (ws) => tryNormalize(ws.path, normalizePath) === normalized
      )
      if (byPath) return byPath.id
    }
  }
  return null
}

function tryNormalize(value: string, normalizePath: (value: string) => string): string | null {
  try {
    return normalizePath(value)
  } catch {
    return null
  }
}
