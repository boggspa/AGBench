import type { ChatRecord, WorkspaceRecord } from '../../../main/store/types'

export function rebindWelcomeEnsembleChatToWorkspace(
  chat: ChatRecord | null | undefined,
  workspace: WorkspaceRecord,
  isWelcomeChat: boolean,
  now = Date.now()
): ChatRecord | null {
  if (!isWelcomeChat || chat?.chatKind !== 'ensemble' || !chat.ensemble) return null
  return {
    ...chat,
    scope: 'workspace',
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    updatedAt: now,
    ensemble: {
      ...chat.ensemble,
      updatedAt: new Date(now).toISOString()
    }
  }
}

/**
 * 1.0.5-EW4 — Companion to `rebindWelcomeEnsembleChatToWorkspace`,
 * for the "No workspace (system chat)" path. The user is on an empty
 * Ensemble welcome chat in some workspace, has built their panel
 * (added participants, set per-participant providers / models /
 * reasoning, etc.), then clicks "No workspace" in the welcome
 * workspace picker. Pre-EW4 the click called `handleNewGlobalChat`
 * which created a brand-new global Ensemble chat with default
 * participants — silently losing the user's setup. Now: if we're on
 * a welcome Ensemble chat we rebind it in place to `scope: 'global'`
 * + clear the workspace fields, preserving every participant + the
 * rest of the ensemble config. The helper returns null when the
 * input isn't an unsendable Ensemble welcome chat, signalling the
 * caller should fall back to the create-new path.
 */
export function rebindWelcomeEnsembleChatToGlobal(
  chat: ChatRecord | null | undefined,
  isWelcomeChat: boolean,
  now = Date.now()
): ChatRecord | null {
  if (!isWelcomeChat || chat?.chatKind !== 'ensemble' || !chat.ensemble) return null
  // Already global — no-op signal so the caller can skip the
  // rebind/save round-trip entirely.
  if (chat.scope === 'global' && !chat.workspaceId && !chat.workspacePath) return null
  const next: ChatRecord = {
    ...chat,
    scope: 'global',
    updatedAt: now,
    ensemble: {
      ...chat.ensemble,
      updatedAt: new Date(now).toISOString()
    }
  }
  delete (next as Partial<ChatRecord>).workspaceId
  delete (next as Partial<ChatRecord>).workspacePath
  return next
}
