/**
 * A transcript message can be the anchor of an in-flight prompt: an
 * `ask_user_question` modal (`pendingAgentQuestion`) and a plan-mode choice
 * (`pendingPlanChoice`) each store the `messageId` of the synthetic message
 * they hang off. Deleting that anchor message while the prompt is still open
 * strands the prompt — its `messageId` then points at a row that no longer
 * exists in the transcript.
 *
 * `handleDeleteMessage` uses this to block such a delete (the user should
 * answer or dismiss the prompt first). Kept as a pure function so the guard is
 * unit-tested independently of the giant App component.
 */
export function messageAnchorsActivePrompt(
  messageId: string,
  pendingAgentQuestionMessageId: string | null | undefined,
  pendingPlanChoiceMessageId: string | null | undefined
): boolean {
  if (!messageId) return false
  return (
    messageId === pendingAgentQuestionMessageId || messageId === pendingPlanChoiceMessageId
  )
}
