import type { ChatRecord, ProviderId, ChatScope } from '../../../main/store/types'

const GLOBAL_USAGE_WORKSPACE_ID = '__agentbench_global_chats__'

const getChatProvider = (chat?: ChatRecord | null): ProviderId => chat?.provider || 'gemini'
const getChatScope = (chat?: Pick<ChatRecord, 'scope'> | null): ChatScope =>
  chat?.scope === 'global' ? 'global' : 'workspace'
const isGlobalChat = (chat?: Pick<ChatRecord, 'scope'> | null): boolean =>
  getChatScope(chat) === 'global'
const getUsageWorkspaceIdForChat = (chat?: ChatRecord | null): string | undefined =>
  isGlobalChat(chat) ? GLOBAL_USAGE_WORKSPACE_ID : chat?.workspaceId

export {
  GLOBAL_USAGE_WORKSPACE_ID,
  getChatProvider,
  getChatScope,
  isGlobalChat,
  getUsageWorkspaceIdForChat
}
