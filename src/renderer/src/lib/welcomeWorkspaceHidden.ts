const STORAGE_KEY = 'taskwraith-welcome-workspace-hidden-ids'

function readRawHiddenIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  } catch {
    return []
  }
}

export function readWelcomeWorkspaceHiddenIds(): Set<string> {
  return new Set(readRawHiddenIds())
}

export function hideWelcomeWorkspaceId(workspaceId: string): void {
  if (typeof window === 'undefined' || !workspaceId) return
  const next = new Set(readRawHiddenIds())
  next.add(workspaceId)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
}

export function showWelcomeWorkspaceId(workspaceId: string): void {
  if (typeof window === 'undefined' || !workspaceId) return
  const next = new Set(readRawHiddenIds())
  next.delete(workspaceId)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
}
