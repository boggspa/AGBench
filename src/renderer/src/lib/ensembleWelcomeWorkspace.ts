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
