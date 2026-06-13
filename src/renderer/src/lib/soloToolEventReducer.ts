import type { ChatMessage, ProviderId, ToolActivity } from '../../../main/store/types'
import { createToolActivity, isToolResultEvent, isToolUseEvent, pairToolResult } from './ToolParser'

interface SoloToolEventReducerOptions {
  createMessageId: () => string
  nowIso?: () => string
  provider?: ProviderId
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

function eventDataWithProvider(data: any, event: any, fallbackProvider?: ProviderId): any {
  const provider = data?.provider ?? event?.provider ?? fallbackProvider
  if (!provider) return data
  const base = data && typeof data === 'object' ? data : {}
  return { ...base, provider }
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
  // Only collapse into an EXISTING tool row when it is the trailing message —
  // i.e. consecutive tool events with no text between them. If the last
  // message is anything else (most commonly a trailing assistant streamed
  // between two tool bursts), start a NEW tool row appended at the end so the
  // tools land at their true sequence position. Reaching back past a trailing
  // assistant to the prior tool row would merge tool bursts that are separated
  // by text into one ActivityStack, destroying the interleaving (text → tools
  // → text → tools collapses to [all tools] → [all text]).
  if (nextMessages.length === 0 || lastMsg?.role !== 'tool') {
    const toolMessage = createToolMessage()
    nextMessages = [...nextMessages, toolMessage]
    lastMsgIndex = nextMessages.length - 1
    lastMsg = toolMessage
  }

  const acts = [...(lastMsg.toolActivities || [])]
  const tData = event.data
  const activityData = eventDataWithProvider(tData, event, options.provider)
  const isUse = event.isUse || isToolUseEvent(tData)
  const isResult = event.isResult || isToolResultEvent(tData)
  const tId = toolEventId(event)
  let latestToolActivity: ToolActivity | null = null

  if (isUse) {
    const newActivity = createToolActivity(activityData)
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
        tool_name: event.name || 'unknown',
        ...(activityData?.provider ? { provider: activityData.provider } : {})
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
      ...activityData
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
