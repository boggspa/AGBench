import type { ChatRecord, ProviderId, ChatScope } from '../../../main/store/types'

const GLOBAL_USAGE_WORKSPACE_ID = '__taskwraith_global_chats__'

const getChatProvider = (chat?: ChatRecord | null): ProviderId => chat?.provider || 'gemini'
const getChatScope = (chat?: Pick<ChatRecord, 'scope'> | null): ChatScope =>
  chat?.scope === 'global' ? 'global' : 'workspace'
const isGlobalChat = (chat?: Pick<ChatRecord, 'scope'> | null): boolean =>
  getChatScope(chat) === 'global'
const isSubThreadChat = (
  chat?: Pick<ChatRecord, 'parentChatId' | 'parentChatRelation'> | null
): boolean =>
  Boolean(
    chat?.parentChatId &&
      (chat.parentChatRelation === undefined || chat.parentChatRelation === 'subThread')
  )
const getUsageWorkspaceIdForChat = (chat?: ChatRecord | null): string | undefined =>
  isGlobalChat(chat) ? GLOBAL_USAGE_WORKSPACE_ID : chat?.workspaceId

export {
  GLOBAL_USAGE_WORKSPACE_ID,
  getChatProvider,
  getChatScope,
  isGlobalChat,
  isSubThreadChat,
  getUsageWorkspaceIdForChat
}
