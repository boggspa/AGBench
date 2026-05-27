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
 * 1.0.5-EW41 — Sibling of `rebindWelcomeEnsembleChatToWorkspace`
 * for the non-welcome case. The user is mid-Ensemble (curated
 * panel, possibly with transcript) and switches the workspace
 * from the composer's workspace switcher. Pre-EW41 the caller
 * (`handleSelectExistingWorkspace`) only had the welcome-gated
 * helper, so non-welcome Ensemble chats fell through to the
 * single-provider "create new chat in target workspace" path —
 * tossing the user out of their Ensemble entirely.
 *
 * This helper rebinds in place: same chat id, same participants,
 * same transcript, same ensemble config; only the workspace
 * pointer changes. Subsequent rounds dispatch against the new
 * workspace path. The transcript history references the old
 * workspace by string, but no agent can reach into it after the
 * switch — they get the new sandbox.
 *
 * Returns null when the rebind is a no-op (chat is already on
 * this workspace) or when the input isn't a valid Ensemble chat,
 * signalling the caller can skip the save round-trip OR fall
 * back to the create-new path respectively.
 */
export function rebindEnsembleChatToWorkspace(
  chat: ChatRecord | null | undefined,
  workspace: WorkspaceRecord,
  now = Date.now()
): ChatRecord | null {
  if (chat?.chatKind !== 'ensemble' || !chat.ensemble) return null
  // Already pointing at this workspace — no-op so callers can
  // skip the rebind/save round-trip entirely.
  if (
    chat.scope === 'workspace' &&
    chat.workspaceId === workspace.id &&
    chat.workspacePath === workspace.path
  ) {
    return null
  }
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
