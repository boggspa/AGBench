import type { RunEventRecord } from '../../../main/store/types'
import { redactLog } from './ErrorClassifier'

export type RawLogEntry = {
  type: 'stdout' | 'stderr' | 'tool' | 'info'
  content: string
  sequence?: number
  hash?: string
  spanId?: string
  toolCallId?: string
  artifactCount?: number
}

export const rawLogFromRunEvent = (event: RunEventRecord): RawLogEntry | null => {
  const payload = event.payload
  const payloadRecord = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {}
  const payloadText =
    typeof payload === 'string'
      ? payload
      : typeof payloadRecord.data === 'string'
        ? payloadRecord.data
        : typeof payloadRecord.error === 'string'
          ? payloadRecord.error
          : typeof payloadRecord.preview === 'string'
            ? payloadRecord.preview
            : event.summary || ''
  if (!payloadText.trim()) return null
  const metadata = {
    sequence: event.sequence,
    hash: event.hash,
    spanId: event.spanId,
    toolCallId: event.toolCallId,
    artifactCount: event.artifacts?.length
  }
  if (event.kind === 'provider_error') return { type: 'stderr', content: redactLog(payloadText), ...metadata }
  if (event.kind === 'provider_raw') return { type: 'stdout', content: redactLog(payloadText), ...metadata }
  if (event.kind === 'tool') return { type: 'tool', content: redactLog(payloadText), ...metadata }
  if (event.kind === 'approval_request' || event.kind === 'approval_response' || event.kind === 'provider_exit' || event.kind === 'lifecycle') {
    return { type: 'info', content: redactLog(payloadText), ...metadata }
  }
  return null
}
