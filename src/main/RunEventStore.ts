import { randomUUID } from 'crypto'
import type {
  RunEventFilter,
  RunEventInput,
  RunEventKind,
  RunEventRecord,
  RunEventReplay
} from './store/types'

export const RUN_EVENT_SCHEMA_VERSION = 1
export const MAX_RUN_EVENT_SUMMARY_CHARS = 500
export const MAX_RUN_EVENT_PAYLOAD_CHARS = 80_000
export const MAX_REDACTED_PROVIDER_PREVIEW_CHARS = 8_000

export function safeRunEventFileName(runId: string): string {
  const normalized = String(runId || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${normalized || 'unknown-run'}.jsonl`
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`
}

function compactSummary(value: unknown): string | undefined {
  const summary = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
  return summary ? truncate(summary, MAX_RUN_EVENT_SUMMARY_CHARS) : undefined
}

function payloadToText(payload: unknown): string {
  if (typeof payload === 'string') return payload
  try {
    return JSON.stringify(payload)
  } catch {
    return String(payload)
  }
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{16,})\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\b(xox[baprs]-[A-Za-z0-9-]{16,})\b/g, '[REDACTED_SLACK_TOKEN]')
    .replace(
      /((?:password|passwd|pwd|token|secret|api[_-]?key)\s*[:=]\s*)("[^"]+"|'[^']+'|[^\s,;}]+)/gi,
      '$1[REDACTED]'
    )
}

export function prepareRunEventPayload(
  payload: unknown,
  options: { storeRawPayload?: boolean; rawProviderPayload?: boolean } = {}
): unknown {
  if (payload === undefined) return undefined
  const text = payloadToText(payload)
  const byteLength = Buffer.byteLength(text, 'utf8')

  if (options.rawProviderPayload && options.storeRawPayload === false) {
    return {
      redacted: true,
      byteLength,
      preview: truncate(redactSensitiveText(text), MAX_REDACTED_PROVIDER_PREVIEW_CHARS)
    }
  }

  if (text.length > MAX_RUN_EVENT_PAYLOAD_CHARS) {
    return {
      truncated: true,
      byteLength,
      preview: truncate(text, MAX_RUN_EVENT_PAYLOAD_CHARS)
    }
  }

  return payload
}

export function createRunEventRecord(
  input: RunEventInput,
  sequence: number,
  options: { now?: string; storeRawPayload?: boolean } = {}
): RunEventRecord {
  const runId = String(input.runId || '').trim()
  if (!runId) {
    throw new Error('Run event requires a runId.')
  }

  const isRawProviderPayload = input.kind === 'provider_raw' || input.kind === 'provider_error'
  return {
    schemaVersion: RUN_EVENT_SCHEMA_VERSION,
    id: input.id || randomUUID(),
    sequence: Number.isFinite(sequence) && sequence > 0 ? Math.floor(sequence) : 1,
    runId,
    chatId: input.chatId || undefined,
    workspaceId: input.workspaceId || undefined,
    workspacePath: input.workspacePath || undefined,
    provider: input.provider,
    providerSessionId: input.providerSessionId || undefined,
    providerRunId: input.providerRunId || undefined,
    kind: input.kind,
    phase: input.phase,
    source: input.source,
    timestamp: input.timestamp || options.now || new Date().toISOString(),
    summary: compactSummary(input.summary),
    payload: prepareRunEventPayload(input.payload, {
      rawProviderPayload: isRawProviderPayload,
      storeRawPayload: options.storeRawPayload
    })
  }
}

export function parseRunEventLine(line: string): RunEventRecord | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as RunEventRecord
    if (!parsed || parsed.schemaVersion !== RUN_EVENT_SCHEMA_VERSION || !parsed.runId) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function serializeRunEventRecord(record: RunEventRecord): string {
  return `${JSON.stringify(record)}\n`
}

export function nextRunEventSequence(events: RunEventRecord[]): number {
  return events.reduce((max, event) => Math.max(max, Number(event.sequence) || 0), 0) + 1
}

export function filterRunEvents(
  events: RunEventRecord[],
  filter: RunEventFilter = {}
): RunEventRecord[] {
  const kindSet = filter.kinds?.length ? new Set<RunEventKind>(filter.kinds) : null
  const phaseSet = filter.phases?.length ? new Set(filter.phases) : null
  const fromSequence = Number.isFinite(filter.fromSequence)
    ? Math.max(1, Number(filter.fromSequence))
    : null

  const filtered = events.filter((event) => {
    if (filter.runId && event.runId !== filter.runId) return false
    if (filter.chatId && event.chatId !== filter.chatId) return false
    if (filter.workspaceId && event.workspaceId !== filter.workspaceId) return false
    if (filter.provider && event.provider !== filter.provider) return false
    if (kindSet && !kindSet.has(event.kind)) return false
    if (phaseSet && !phaseSet.has(event.phase)) return false
    if (fromSequence !== null && event.sequence < fromSequence) return false
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    if (a.runId === b.runId) return a.sequence - b.sequence
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  })

  return filter.limit && filter.limit > 0 ? sorted.slice(-Math.floor(filter.limit)) : sorted
}

export function createRunEventReplay(runId: string, events: RunEventRecord[]): RunEventReplay {
  const runEvents = filterRunEvents(events, { runId })
  const countsByKind: Partial<Record<RunEventKind, number>> = {}
  for (const event of runEvents) {
    countsByKind[event.kind] = (countsByKind[event.kind] || 0) + 1
  }

  const lifecycleEvents = runEvents.filter((event) => event.kind === 'lifecycle')
  const terminalEvent = [...lifecycleEvents].reverse().find((event) => {
    const status =
      event.payload && typeof event.payload === 'object'
        ? (event.payload as { status?: unknown }).status
        : undefined
    return status === 'completed' || status === 'failed' || status === 'cancelled'
  })

  return {
    runId,
    events: runEvents,
    count: runEvents.length,
    lastSequence: runEvents.reduce((max, event) => Math.max(max, event.sequence), 0),
    countsByKind,
    startedAt: lifecycleEvents[0]?.timestamp || runEvents[0]?.timestamp,
    endedAt: terminalEvent?.timestamp || runEvents[runEvents.length - 1]?.timestamp
  }
}
