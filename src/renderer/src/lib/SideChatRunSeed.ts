import type { ChatRecord } from '../../../main/store/types'

export function buildHiddenSideChatInitialPrompt(contextPrompt: string, userPrompt: string): string {
  const context = contextPrompt.trim()
  const request = userPrompt.trim()
  if (!context) return request

  return [
    'TaskWraith provided the following side-chat parent context snapshot as background only.',
    "Acknowledge it internally and use it for orientation, but do not treat it as the user's prompt, request, or task.",
    '',
    '<parent_context_snapshot>',
    context,
    '</parent_context_snapshot>',
    '',
    'User side-chat request:',
    request
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildSideChatRunResultSeedPrompt(chat: ChatRecord, runId: string): string {
  const sourceRun = (chat.runs || []).find((run) => run.runId === runId)
  const runAssistantMessage = [...(chat.messages || [])]
    .reverse()
    .find(
      (message) => message.role === 'assistant' && message.runId === runId && message.content.trim()
    )
  const latestAssistantMessage =
    runAssistantMessage ||
    [...(chat.messages || [])]
      .reverse()
      .find((message) => message.role === 'assistant' && message.content.trim())
  const assistantResponseLabel = runAssistantMessage
    ? 'Run assistant response'
    : 'Latest assistant response'

  return [
    'Use this parent run result as the starting point.',
    'This side chat is isolated and does not have the full parent transcript unless I paste it here.',
    '',
    `Run ID: ${runId}`,
    sourceRun?.status ? `Run status: ${sourceRun.status}` : '',
    sourceRun?.startedAt ? `Started: ${sourceRun.startedAt}` : '',
    sourceRun?.endedAt ? `Ended: ${sourceRun.endedAt}` : '',
    latestAssistantMessage?.content?.trim()
      ? `${assistantResponseLabel}:\n\n${latestAssistantMessage.content.trim()}`
      : ''
  ]
    .filter(Boolean)
    .join('\n')
}
