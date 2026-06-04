import type {
  AgentActivity,
  AgentActivityStatus,
  ProviderCapabilityContract,
  ProviderId
} from '../../../main/store/types'

type RawLogEntryLike = {
  type?: string
  content: string
  sequence?: number
  hash?: string
  spanId?: string
  toolCallId?: string
}

const DELEGATION_NAMES = new Set([
  'agent',
  'task',
  'invoke_agent',
  'subagentevent',
  'collabtoolcall',
  'collab_tool_call'
])

const PROGRESS_NAMES = new Set(['update_topic', 'summary', 'intent', 'progress', 'tool_progress'])

export function extractDelegationAuditItems(
  rawLogs: RawLogEntryLike[],
  provider: ProviderId,
  contract?: ProviderCapabilityContract | null
): AgentActivity[] {
  const activities = new Map<string, AgentActivity>()

  for (const log of rawLogs) {
    const parsed = parseRawLogContent(log.content)
    if (!parsed) continue

    const candidate = createDelegationActivity(parsed, log, provider, contract)
    if (!candidate) continue

    const existing = activities.get(candidate.activityId)
    if (!existing) {
      activities.set(candidate.activityId, candidate)
      continue
    }

    activities.set(candidate.activityId, {
      ...existing,
      ...candidate,
      name: isGenericActivityName(candidate.name) ? existing.name : candidate.name,
      status: preferStatus(existing.status, candidate.status),
      summary: candidate.summary || existing.summary,
      promptPreview: candidate.promptPreview || existing.promptPreview,
      rawEventRefs: [...(existing.rawEventRefs || []), ...(candidate.rawEventRefs || [])]
    })
  }

  return Array.from(activities.values())
}

export function providerDelegationChips(
  provider: ProviderId,
  contract?: ProviderCapabilityContract | null
): string[] {
  const chips: string[] = []

  if (provider === 'codex') {
    chips.push('Provider-native invocations', 'App-server threads', 'Provider MCP')
  } else if (provider === 'claude') {
    chips.push('Provider-native Task', 'Provider-managed approvals', 'SDK audit when available')
  } else if (provider === 'kimi') {
    chips.push('Provider-native Agent tool', 'Wire SubagentEvent', 'Provider MCP')
  } else {
    chips.push('Provider-native invocations', 'AGBench MCP bridge', 'Best-effort JSONL audit')
  }

  if (contract?.approvals.inAppApprovals) {
    chips.push('AGBench approvals')
  } else {
    chips.push('Provider-managed approvals')
  }

  if (contract?.tools.mcpTools.enforcedByAgentBench) {
    chips.push('AGBench MCP enforcement')
  } else if (contract?.mcp.state) {
    chips.push(`MCP ${contract.mcp.state}`)
  }

  return Array.from(new Set(chips))
}

export function summarizeDelegationActivity(activity: AgentActivity): string {
  const status = activity.status === 'unknown' ? '' : `${activity.status} `
  const provider = activity.provider ? `${activity.provider} ` : ''
  const summary = activity.summary || activity.promptPreview || ''
  return `${status}${provider}${activity.kind}: ${activity.name}${summary ? ` - ${summary}` : ''}`
}

function createDelegationActivity(
  event: any,
  log: RawLogEntryLike,
  provider: ProviderId,
  contract?: ProviderCapabilityContract | null
): AgentActivity | null {
  const name = normalizedEventName(event)
  const payload =
    event.payload ||
    event.params?.payload ||
    event.params ||
    event.parameters ||
    event.item ||
    event
  const itemType = String(
    event.item?.type || event.params?.item?.type || event.type || ''
  ).toLowerCase()
  const isDelegation = DELEGATION_NAMES.has(name) || itemType === 'collabtoolcall'
  const isProgress = PROGRESS_NAMES.has(name) && hasVisibleProgressPayload(payload, event)

  if (!isDelegation && !isProgress) return null

  const parentToolCallId = stringValue(
    event.parent_tool_call_id ||
      event.parentToolCallId ||
      event.parent_tool_use_id ||
      event.parentToolUseId ||
      event.params?.parent_tool_call_id ||
      event.params?.parentToolCallId ||
      payload.parent_tool_call_id ||
      payload.parentToolCallId
  )
  const providerAgentId = stringValue(
    event.agent_id ||
      event.agentId ||
      event.params?.agent_id ||
      event.params?.agentId ||
      payload.agent_id ||
      payload.agentId ||
      event.item?.agentId
  )
  const toolCallId = stringValue(
    event.tool_id ||
      event.toolId ||
      event.tool_call_id ||
      event.toolCallId ||
      event.id ||
      event.item?.id ||
      log.toolCallId
  )
  const activityId =
    [
      provider,
      providerAgentId || '',
      toolCallId || '',
      parentToolCallId || '',
      name,
      log.sequence || ''
    ]
      .filter(Boolean)
      .join(':') || `${provider}:${name}:${Date.now()}`

  const displayName =
    stringValue(payload.agent_name) ||
    stringValue(payload.agentName) ||
    stringValue(payload.subagent_type) ||
    stringValue(payload.subagentType) ||
    stringValue(event.params?.subagent_type) ||
    stringValue(event.params?.subagentType) ||
    stringValue(event.item?.agentName) ||
    stringValue(event.item?.name) ||
    stringValue(event.params?.item?.agentName) ||
    stringValue(event.params?.item?.name) ||
    labelForDelegationName(name, provider)

  const summary =
    stringValue(payload.summary) ||
    stringValue(event.summary) ||
    stringValue(payload.strategic_intent) ||
    stringValue(payload.intent) ||
    stringValue(payload.message) ||
    stringValue(payload.output) ||
    stringValue(event.output) ||
    stringValue(event.item?.summary)
  const promptPreview =
    stringValue(payload.prompt) ||
    stringValue(payload.description) ||
    stringValue(event.item?.prompt) ||
    stringValue(event.item?.input) ||
    stringValue(event.params?.item?.prompt) ||
    stringValue(event.params?.item?.input)

  return {
    activityId,
    parentActivityId: parentToolCallId || undefined,
    provider,
    providerThreadId:
      stringValue(
        event.providerThreadId ||
          event.provider_thread_id ||
          event.threadId ||
          event.params?.threadId
      ) || undefined,
    providerAgentId: providerAgentId || undefined,
    parentToolCallId: parentToolCallId || undefined,
    kind: isProgress ? 'progress' : name.includes('collab') ? 'subagent' : 'subagent',
    name: displayName,
    model: stringValue(payload.model || event.model) || undefined,
    status: statusFromEvent(event),
    promptPreview: truncate(promptPreview, 240),
    summary: truncate(summary, 360),
    toolPolicy: toolPolicyLabel(contract),
    mcpPolicy: mcpPolicyLabel(contract),
    approvalMode: stringValue(event.approvalMode || payload.approvalMode) || undefined,
    rawEventRefs: [
      {
        sequence: log.sequence,
        hash: log.hash,
        toolCallId: log.toolCallId || toolCallId || undefined,
        spanId: log.spanId
      }
    ]
  }
}

function parseRawLogContent(content: string): any | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function normalizedEventName(event: any): string {
  return String(
    event?.tool_name ||
      event?.toolName ||
      event?.name ||
      event?.function?.name ||
      event?.params?.type ||
      event?.item?.type ||
      event?.params?.item?.type ||
      event?.method ||
      event?.type ||
      ''
  )
    .trim()
    .toLowerCase()
}

function hasVisibleProgressPayload(payload: any, event: any): boolean {
  return Boolean(
    stringValue(payload?.title) ||
    stringValue(payload?.summary) ||
    stringValue(payload?.strategic_intent) ||
    stringValue(payload?.intent) ||
    stringValue(event?.summary)
  )
}

function statusFromEvent(event: any): AgentActivityStatus {
  const status = String(
    event.status || event.subtype || event.result?.status || event.params?.payload?.status || ''
  ).toLowerCase()
  if (status.includes('cancel')) return 'cancelled'
  if (status.includes('fail') || status.includes('error')) return 'failed'
  if (status.includes('success') || status.includes('complete') || status === 'ok') return 'success'
  if (status.includes('wait') || status.includes('approval')) return 'waiting'
  if (event.type === 'tool_use' || event.type === 'tool_call' || event.method === 'item/started')
    return 'running'
  if (event.type === 'tool_result' || event.method === 'item/completed') return 'success'
  return 'unknown'
}

function isGenericActivityName(value: string): boolean {
  return [
    'Delegated agent',
    'Kimi subagent',
    'Codex subagent',
    'Claude Agent',
    'Agent',
    'Task topic',
    'Task summary',
    'Intent',
    'Delegated activity'
  ].includes(value)
}

function preferStatus(a: AgentActivityStatus, b: AgentActivityStatus): AgentActivityStatus {
  const rank: Record<AgentActivityStatus, number> = {
    unknown: 0,
    queued: 1,
    running: 2,
    waiting: 3,
    success: 4,
    cancelled: 5,
    failed: 6
  }
  return rank[b] >= rank[a] ? b : a
}

function labelForDelegationName(name: string, provider: ProviderId): string {
  if (name === 'invoke_agent') return 'Delegated agent'
  if (name === 'subagentevent') return 'Kimi subagent'
  if (name.includes('collab')) return 'Codex subagent'
  if (name === 'agent' || name === 'task') return provider === 'claude' ? 'Claude Agent' : 'Agent'
  if (name === 'update_topic') return 'Task topic'
  if (name === 'summary') return 'Task summary'
  if (name === 'intent') return 'Intent'
  return name || 'Delegated activity'
}

// The five functional-control rows. The DISPLAY-only elicit/delegate rows are
// excluded from this enforcement tally so they never shift the count.
const TOOLING_CONTROL_KEYS = [
  'shellCommands',
  'fileChanges',
  'mcpTools',
  'creativeApps',
  'networkAccess'
] as const

function toolPolicyLabel(contract?: ProviderCapabilityContract | null): string | undefined {
  if (!contract) return undefined
  const controlRows = TOOLING_CONTROL_KEYS.map((key) => contract.tools[key])
  const controlled = controlRows.filter((tool) => tool.enforcedByAgentBench).length
  return controlled > 0
    ? `AGBench-enforced (${controlled}/${controlRows.length})`
    : 'provider-managed'
}

function mcpPolicyLabel(contract?: ProviderCapabilityContract | null): string | undefined {
  if (!contract) return undefined
  if (contract.tools.mcpTools.enforcedByAgentBench) return 'AGBench MCP bridge'
  return contract.mcp.state ? `provider MCP: ${contract.mcp.state}` : undefined
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function truncate(value: string, max: number): string | undefined {
  if (!value) return undefined
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
