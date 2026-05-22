import type { ChatRecord } from '../../../main/store/types'

/** Phase I3.3 — node in the rendered delegation tree. */
export interface DelegationTimelineNode {
  chat: ChatRecord
  children: DelegationTimelineNode[]
  isCurrent: boolean
}

/** Pure helper: given a chat list + a focus chat id, return the root of
 * its delegation tree (walks up parentChatId, then collects descendants). */
export function buildDelegationTree(
  chats: ChatRecord[],
  focusChatId?: string
): DelegationTimelineNode | null {
  if (!chats.length) return null
  const byId = new Map(chats.map((chat) => [chat.appChatId, chat]))
  const childrenByParent = new Map<string, ChatRecord[]>()
  for (const chat of chats) {
    if (!chat.parentChatId) continue
    const bucket = childrenByParent.get(chat.parentChatId)
    if (bucket) bucket.push(chat)
    else childrenByParent.set(chat.parentChatId, [chat])
  }
  for (const bucket of childrenByParent.values()) {
    bucket.sort((a, b) => a.createdAt - b.createdAt)
  }

  let root = focusChatId ? byId.get(focusChatId) : undefined
  if (!root) return null
  while (root.parentChatId && byId.has(root.parentChatId)) {
    root = byId.get(root.parentChatId)!
  }

  const build = (chat: ChatRecord): DelegationTimelineNode => ({
    chat,
    isCurrent: chat.appChatId === focusChatId,
    children: (childrenByParent.get(chat.appChatId) || []).map(build)
  })
  return build(root)
}
