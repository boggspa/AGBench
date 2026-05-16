import type { ProviderId } from '../../../main/store/types'

/**
 * A subset of `AgentApprovalRequest` that the visibility helper actually
 * needs to inspect. Keeping the type narrow (rather than importing the
 * full preload typing) means this helper stays test-friendly with no
 * dependency on the IPC layer.
 */
export interface RunningChatApprovalLike {
  provider: ProviderId
}

/**
 * Kimi keeps the wire-mode child process alive while it waits for the
 * user to resolve an `ApprovalRequest`. That means no `agent-exit`
 * fires, and the renderer's `runningChatIds` set never sheds the chat.
 * The sidebar then keeps painting a "Running" badge even though the
 * agent is parked on user input.
 *
 * Filter the visible "running" set so Kimi chats with a pending
 * approval drop out of the badge logic. Other providers retain their
 * existing semantics — for them, awaiting an approval is short and the
 * badge is intentional. Once the user resolves the Kimi approval, the
 * follow-up `agent-output`/`agent-exit` traffic restores the badge via
 * the regular `setRunningChatIds` path.
 */
export function visibleRunningChatIds(
  runningChatIds: ReadonlyArray<string> | ReadonlySet<string>,
  pendingApprovalsByChatId: Readonly<Record<string, RunningChatApprovalLike | null>>
): string[] {
  const iterable: Iterable<string> = runningChatIds instanceof Set
    ? runningChatIds
    : runningChatIds as ReadonlyArray<string>
  const result: string[] = []
  for (const chatId of iterable) {
    const pending = pendingApprovalsByChatId[chatId]
    if (pending && pending.provider === 'kimi') continue
    result.push(chatId)
  }
  return result
}
