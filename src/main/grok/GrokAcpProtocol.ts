// Pure helpers for Grok's ACP (Agent Client Protocol) wire format, as spoken by
// `grok agent stdio`. No Electron / fs / child_process imports — unit-testable
// against fixtures captured from the real 0.2.8 agent (see the G1 spike log in
// docs/1.0.6-GROK-PROVIDER-INTEGRATION-BLUEPRINT.md).
//
// ACP is JSON-RPC 2.0 over NDJSON (one JSON object per line, both directions):
//   client→agent requests:  {jsonrpc,id,method,params}
//   agent→client responses: {jsonrpc,id,result|error}
//   agent→client notifs:    {jsonrpc,method:'session/update',params:{sessionId,update:{...}}}
// The assistant answer streams as session/update `agent_message_chunk`
// (`update.content.text`); reasoning as `agent_thought_chunk`. The session/prompt
// response (and the `_x.ai/session/prompt_complete` notification) carry the
// terminal `stopReason`. session/new's result carries the resumable `sessionId`.

import type { NormalizedGrokRunEvent } from './GrokStreamingJson'

export type { NormalizedGrokRunEvent }

/** Serialize a JSON-RPC message as one NDJSON frame (trailing newline). */
export function encodeAcpFrame(message: unknown): string {
  return `${JSON.stringify(message)}\n`
}

/**
 * Split a chunk of agent stdout into parsed JSON-RPC messages, carrying a
 * partial trailing line across chunks. Non-JSON lines are skipped (ACP is
 * strictly JSON; banners would be noise).
 */
export function parseAcpStreamChunk(
  rawChunk: string,
  carry: string
): { messages: Record<string, unknown>[]; carry: string } {
  const buffer = (carry || '') + (rawChunk || '')
  const segments = buffer.split(/\r?\n/)
  const nextCarry = segments.pop() ?? ''
  const messages: Record<string, unknown>[] = []
  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        messages.push(parsed as Record<string, unknown>)
      }
    } catch {
      // ACP is strict JSON; ignore any non-JSON noise line.
    }
  }
  return { messages, carry: nextCarry }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * Map one parsed ACP message to zero or more normalized run events. Never
 * throws; unrecognized messages (model/command updates, summaries) yield [].
 */
export function acpMessageToRunEvents(message: Record<string, unknown>): NormalizedGrokRunEvent[] {
  const method = typeof message.method === 'string' ? message.method : ''

  // Streaming notifications.
  if (method === 'session/update') {
    const update = asObject(asObject(message.params)?.update)
    const sub = update && typeof update.sessionUpdate === 'string' ? update.sessionUpdate : ''
    const content = asObject(update?.content)
    const text = content && typeof content.text === 'string' ? content.text : ''
    if (sub === 'agent_message_chunk' && text) return [{ type: 'content', text, raw: message }]
    if (sub === 'agent_thought_chunk' && text) return [{ type: 'thinking', text, raw: message }]
    return []
  }

  // xAI extension: explicit turn-complete notification.
  if (method === '_x.ai/session/prompt_complete') {
    const stop = asObject(message.params)?.stopReason
    return [{ type: 'result', status: typeof stop === 'string' ? stop : 'success', raw: message }]
  }

  // Responses (have `result` / `error`, no `method`).
  const result = asObject(message.result)
  if (result) {
    const events: NormalizedGrokRunEvent[] = []
    const meta = asObject(result._meta)
    const sessionId =
      typeof result.sessionId === 'string'
        ? result.sessionId
        : meta && typeof meta.sessionId === 'string'
          ? meta.sessionId
          : undefined
    if (sessionId) events.push({ type: 'init', sessionId, raw: message })
    if (typeof result.stopReason === 'string') {
      events.push({ type: 'result', status: result.stopReason, sessionId, raw: message })
    }
    return events
  }

  const error = asObject(message.error)
  if (error) {
    const text = typeof error.message === 'string' ? error.message : 'Grok ACP error.'
    return [{ type: 'provider_warning', text, raw: message }]
  }

  return []
}
