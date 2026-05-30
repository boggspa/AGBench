import type { ProviderId, ToolActivity } from '../../../main/store/types'
import { prettyPrintJson, unwrapMcpEnvelope } from '../lib/ToolParser'

/** Inline preview shown on the row. Hard cap at 80 chars; appends a
 * truncation hint when the underlying result is long (> 500 chars) so
 * the user knows the foldout has more content. */
export const PREVIEW_CHAR_LIMIT = 80
export const RESULT_REDACTION_THRESHOLD = 500
export const REDACTION_HINT = '(truncated — expand to see full output)'

export function resolveProvider(
  activity: ToolActivity,
  fallback: ProviderId | undefined
): ProviderId | undefined {
  return activity.metadata?.ensembleProvider || activity.metadata?.provider || fallback
}

export function providerLabel(provider: ProviderId | undefined): string {
  if (!provider) return ''
  switch (provider) {
    case 'codex':
      return 'Codex'
    case 'claude':
      return 'Claude'
    case 'gemini':
      return 'Gemini'
    case 'kimi':
      return 'Kimi'
    case 'grok':
      return 'Grok'
    case 'cursor':
      return 'Cursor'
    default:
      return provider
  }
}

export function statusLabel(status: ToolActivity['status']): string {
  switch (status) {
    case 'success':
      return 'ok'
    case 'error':
      return 'error'
    case 'warning':
      return 'warn'
    case 'running':
      return 'running'
    case 'pending':
      return 'pending'
    default:
      return status || 'unknown'
  }
}

export function durationLabel(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  const secs = ms / 1000
  if (secs < 60) return `${secs.toFixed(secs < 10 ? 1 : 0)}s`
  const mins = Math.floor(secs / 60)
  const remSecs = Math.round(secs - mins * 60)
  return `${mins}m${remSecs}s`
}

/** Squeeze whitespace + strip line breaks for the one-line preview. */
function collapsePreview(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function getResultText(activity: ToolActivity): string {
  return activity.resultSummary || activity.outputPreview || ''
}

export interface RenderedPreview {
  /** The 80-char (or less) display string. */
  display: string
  /** Whether the underlying content was redacted (i.e. > 500 chars). */
  redacted: boolean
  /** Whether there is *any* preview content at all. */
  hasContent: boolean
}

export function buildResultPreview(activity: ToolActivity): RenderedPreview {
  const raw = getResultText(activity)
  if (!raw) {
    return { display: '', redacted: false, hasContent: false }
  }

  const cleaned = collapsePreview(unwrapMcpEnvelope(raw))
  if (!cleaned) {
    return { display: '', redacted: false, hasContent: false }
  }

  const redacted = raw.length > RESULT_REDACTION_THRESHOLD
  const sliced =
    cleaned.length > PREVIEW_CHAR_LIMIT ? `${cleaned.slice(0, PREVIEW_CHAR_LIMIT)}…` : cleaned
  return { display: sliced, redacted, hasContent: true }
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export interface FoldoutSection {
  label: string
  body: string
}

export function buildFoldoutSections(activity: ToolActivity): FoldoutSection[] {
  const sections: FoldoutSection[] = []

  const params = activity.parameters || {}
  if (Object.keys(params).length > 0) {
    sections.push({ label: 'Input', body: safeJsonStringify(params) })
  }

  const resultText = getResultText(activity)
  if (resultText) {
    sections.push({
      label: 'Result',
      body: prettyPrintJson(unwrapMcpEnvelope(resultText))
    })
  }

  const timelineParts: string[] = []
  if (activity.startedAt) timelineParts.push(`started: ${activity.startedAt}`)
  if (activity.endedAt) timelineParts.push(`ended:   ${activity.endedAt}`)
  if (typeof activity.durationMs === 'number') {
    timelineParts.push(`duration: ${activity.durationMs}ms`)
  }
  if (activity.status) timelineParts.push(`status:  ${activity.status}`)
  if (timelineParts.length > 0) {
    sections.push({ label: 'Timeline', body: timelineParts.join('\n') })
  }

  return sections
}
