import type { ChatMessage, ToolActivity } from '../../../main/store/types'
import { createToolActivity, isToolResultEvent, isToolUseEvent, pairToolResult } from './ToolParser'

interface SoloToolEventReducerOptions {
  createMessageId: () => string
  nowIso?: () => string
}

export interface SoloToolEventReduction {
  messages: ChatMessage[]
  latestToolActivity: ToolActivity | null
  isResult: boolean
}

function toolEventId(event: any): string {
  return (
    event?.data?.tool_id ||
    event?.data?.toolId ||
    event?.data?.id ||
    event?.data?.call_id ||
    `unknown-${Date.now()}`
  )
}

export function reduceSoloToolEventMessages(
  messages: ChatMessage[],
  event: any,
  options: SoloToolEventReducerOptions
): SoloToolEventReduction {
  const createToolMessage = (): ChatMessage => ({
    id: options.createMessageId(),
    role: 'tool',
    content: '',
    timestamp: options.nowIso?.() || new Date().toISOString(),
    toolActivities: []
  })

  let nextMessages = messages
  let lastMsgIndex = nextMessages.length - 1
  let lastMsg = nextMessages[lastMsgIndex]
  if (nextMessages.length === 0 || lastMsg?.role !== 'tool') {
    const trailingAssistant = lastMsg?.role === 'assistant' ? lastMsg : null
    const previousToolIndex = trailingAssistant ? nextMessages.length - 2 : -1
    const previousTool = previousToolIndex >= 0 ? nextMessages[previousToolIndex] : null
    if (trailingAssistant && previousTool?.role === 'tool') {
      lastMsgIndex = previousToolIndex
      lastMsg = previousTool
    } else {
      const toolMessage = createToolMessage()
      nextMessages = trailingAssistant
        ? [...nextMessages.slice(0, -1), toolMessage, trailingAssistant]
        : [...nextMessages, toolMessage]
      lastMsgIndex = trailingAssistant ? nextMessages.length - 2 : nextMessages.length - 1
      lastMsg = toolMessage
    }
  }

  const acts = [...(lastMsg.toolActivities || [])]
  const tData = event.data
  const isUse = event.isUse || isToolUseEvent(tData)
  const isResult = event.isResult || isToolResultEvent(tData)
  const tId = toolEventId(event)
  let latestToolActivity: ToolActivity | null = null

  if (isUse) {
    const newActivity = createToolActivity(tData)
    acts.push(newActivity)
    latestToolActivity = newActivity
  } else if (isResult) {
    const idx = acts.findIndex((activity) => activity.id === tId)
    if (idx >= 0) {
      acts[idx] = pairToolResult(acts[idx], tData)
      latestToolActivity = acts[idx]
    } else {
      const orphan = createToolActivity({
        type: 'tool_use',
        tool_id: tId,
        tool_name: event.name || 'unknown'
      })
      const paired = pairToolResult(orphan, tData)
      acts.push(paired)
      latestToolActivity = paired
    }
  } else {
    const fallback = createToolActivity({
      type: 'tool_use',
      tool_id: tId,
      tool_name: event.name || 'unknown',
      ...tData
    })
    fallback.status = 'success'
    acts.push(fallback)
    latestToolActivity = fallback
  }

  return {
    messages: [
      ...nextMessages.slice(0, lastMsgIndex),
      { ...lastMsg, toolActivities: acts },
      ...nextMessages.slice(lastMsgIndex + 1)
    ],
    latestToolActivity,
    isResult
  }
}
