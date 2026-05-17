/*
 * SubThreadRecall — Phase J2 resolver for `delegate_to_subthread`
 * recall mode.
 *
 * The MCP `delegate_to_subthread` tool accepts an optional
 * `subThreadId` argument. When set, the calling agent is asking the
 * tool to send its prompt as a follow-up turn to an existing
 * sub-thread it spawned earlier (whose id was returned in the
 * tool_result of the original call). This module decides whether
 * recall is valid:
 *
 *  - `{ mode: 'spawn' }` — no `subThreadId` was supplied; the caller
 *    should spawn a fresh sub-thread as before.
 *
 *  - `{ mode: 'recall', chat }` — the supplied id resolves to a chat
 *    that's a sub-thread of the calling parent, on the same target
 *    provider, and not archived. The caller dispatches a new turn
 *    against that chat. If `chat.linkedProviderSessionId` is set,
 *    the dispatch should inject it as `providerSessionId` so the
 *    target provider's native session resumes. If it's not set yet
 *    (the chat's first turn is still in flight or never completed),
 *    the recall still targets the same chat for transcript
 *    continuity but the provider runtime starts a fresh session.
 *
 *  - `{ mode: 'error', message }` — the supplied id was missing /
 *    wrong parent / wrong provider / archived. The caller returns
 *    the message as the tool_result so the agent learns what went
 *    wrong (no run is dispatched).
 *
 * Pure function — no IPC, no broker, no state. The caller hands in a
 * `chatLookup` closure so this stays test-friendly without spinning
 * up the full AppStore.
 */

import type { ChatRecord, ProviderId } from './store/types'

export interface SubThreadRecallRequest {
  subThreadId?: string | null
  parentChatId: string
  targetProvider: ProviderId
}

export type SubThreadRecallResolution =
  | { mode: 'spawn' }
  | { mode: 'recall'; chat: ChatRecord; warning?: string }
  | { mode: 'error'; message: string }

export type SubThreadRecallChatLookup = (chatId: string) => ChatRecord | undefined

export function resolveSubThreadRecall(
  request: SubThreadRecallRequest,
  lookup: SubThreadRecallChatLookup
): SubThreadRecallResolution {
  const requestedId = typeof request.subThreadId === 'string' ? request.subThreadId.trim() : ''
  if (!requestedId) {
    return { mode: 'spawn' }
  }
  const chat = lookup(requestedId)
  if (!chat) {
    return {
      mode: 'error',
      message:
        `delegate_to_subthread: subThreadId "${requestedId}" does not match any AGBench chat record. ` +
        `Recall requires the id returned by an earlier delegate_to_subthread tool_result; ` +
        `the id is stable for the lifetime of the sub-thread.`
    }
  }
  if (chat.archived) {
    return {
      mode: 'error',
      message:
        `delegate_to_subthread: sub-thread "${requestedId}" is archived. ` +
        `Spawn a new sub-thread (omit subThreadId) or unarchive the existing one in AGBench.`
    }
  }
  if (!chat.parentChatId || chat.parentChatId !== request.parentChatId) {
    return {
      mode: 'error',
      message:
        `delegate_to_subthread: sub-thread "${requestedId}" belongs to a different parent chat ` +
        `(${chat.parentChatId || 'no parent'}), not the chat issuing this delegation. ` +
        `Recall only works for sub-threads YOU spawned from THIS parent.`
    }
  }
  if (chat.provider !== request.targetProvider) {
    return {
      mode: 'error',
      message:
        `delegate_to_subthread: sub-thread "${requestedId}" runs ${chat.provider}, ` +
        `but this call requested provider="${request.targetProvider}". ` +
        `Recall requires the provider to match the existing sub-thread.`
    }
  }
  const warning = chat.linkedProviderSessionId
    ? undefined
    : `Sub-thread "${requestedId}" does not yet have a linked provider session id ` +
      `(first turn may not have completed). The recall targets the same AGBench chat so ` +
      `the transcript continues, but the ${chat.provider} runtime starts a fresh session for this turn.`
  return { mode: 'recall', chat, warning }
}
