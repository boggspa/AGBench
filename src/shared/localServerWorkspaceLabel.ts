import type { LocalServerEntry } from '../main/localServers/types'

/** Legacy workspace display names from the AGBench → TaskWraith rebrand. */
const LEGACY_WORKSPACE_LABELS = new Set(['AGBench', 'agbench'])

/** Normalize a workspace label for Local Servers UI (sidebar + settings). */
export function formatLocalServerWorkspaceLabel(raw: string | undefined): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (LEGACY_WORKSPACE_LABELS.has(trimmed)) return 'TaskWraith'
  return trimmed
}

/** Resolve the subtitle shown under each detected local server row. */
export function localServerWorkspaceLabel(
  entry: Pick<LocalServerEntry, 'workspaceName' | 'workspacePath'>
): string {
  if (entry.workspaceName) return formatLocalServerWorkspaceLabel(entry.workspaceName)
  const path = entry.workspacePath
  if (!path) return ''
  const base = path.split(/[\\/]/).filter(Boolean).pop() || path
  return formatLocalServerWorkspaceLabel(base)
}
