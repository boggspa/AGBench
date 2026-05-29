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

// ============================================================
// G5 — session/request_permission (client-mediated tool approvals).
//
// ACP lets the agent ASK the client before running a tool:
//   agent→client request:  {jsonrpc,id,method:'session/request_permission',
//                            params:{sessionId,toolCall:{...},options:[{optionId,name,kind}]}}
//   client→agent response: {jsonrpc,id,result:{outcome:{outcome:'selected',optionId}}}
//                       or: {jsonrpc,id,result:{outcome:{outcome:'cancelled'}}}
// This is the seam where AGBench OWNS every Grok side effect: the request is
// surfaced as an approval card (the ledger), and the chosen option is sent back.
// Pure + fixture-tested here; the transport wiring + ledger routing live in
// GrokAcpClient / runGrokAcpProvider (gated behind grokAcpEnabled()).
//
// SAFETY: the response builder DEFAULTS TO CANCELLED. A missing/unknown option,
// a deny decision, or a malformed request can never resolve to an allow — a
// write is approved only when an explicit allow option is matched against an
// explicit allow decision. There is no silent-allow path.
// ============================================================

export const ACP_PERMISSION_METHOD = 'session/request_permission'

export interface AcpPermissionOption {
  optionId: string
  name: string
  /** ACP option kind, e.g. allow_once | allow_always | reject_once | reject_always. */
  kind: string
}

export interface AcpPermissionRequest {
  /** JSON-RPC id to respond to (number or string per the spec). */
  rpcId: number | string
  sessionId: string
  /** Best-effort human label for the requested tool (for the approval card). */
  toolName: string
  /** ACP tool kind (e.g. 'edit', 'execute', 'read') when present. */
  toolKind: string
  options: AcpPermissionOption[]
  /** The raw toolCall object (audit / detail rendering). */
  rawToolCall: Record<string, unknown> | null
}

/** True for an inbound agent→client `session/request_permission` request. */
export function isAcpPermissionRequest(message: Record<string, unknown>): boolean {
  return (
    message.method === ACP_PERMISSION_METHOD &&
    (typeof message.id === 'number' || typeof message.id === 'string')
  )
}

/**
 * Parse a `session/request_permission` request into a structured descriptor.
 * Defensive: returns null unless it's genuinely that request with a usable id.
 */
export function parseAcpPermissionRequest(
  message: Record<string, unknown>
): AcpPermissionRequest | null {
  if (!isAcpPermissionRequest(message)) return null
  const rpcId = message.id as number | string
  const params = asObject(message.params)
  const sessionId =
    params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const toolCall = asObject(params?.toolCall)
  const toolName =
    (toolCall && typeof toolCall.title === 'string' && toolCall.title) ||
    (toolCall && typeof toolCall.kind === 'string' && toolCall.kind) ||
    'tool'
  const toolKind = toolCall && typeof toolCall.kind === 'string' ? toolCall.kind : ''
  const rawOptions = Array.isArray(params?.options) ? (params!.options as unknown[]) : []
  const options: AcpPermissionOption[] = []
  for (const entry of rawOptions) {
    const opt = asObject(entry)
    if (!opt) continue
    const optionId = typeof opt.optionId === 'string' ? opt.optionId : ''
    if (!optionId) continue
    options.push({
      optionId,
      name: typeof opt.name === 'string' ? opt.name : optionId,
      kind: typeof opt.kind === 'string' ? opt.kind : ''
    })
  }
  return { rpcId, sessionId, toolName, toolKind, options, rawToolCall: toolCall }
}

export type AcpPermissionDecision = 'allow' | 'deny' | 'cancel'

/**
 * Pick the optionId that matches a decision, by ACP option kind. 'allow' prefers
 * a one-shot allow (allow_once) over a persistent one (allow_always); 'deny'
 * prefers reject_once over reject_always. Returns null when no option matches —
 * which the response builder turns into a 'cancelled' outcome (never an allow).
 */
export function selectAcpPermissionOption(
  options: AcpPermissionOption[],
  decision: AcpPermissionDecision
): string | null {
  if (decision === 'cancel') return null
  const prefix = decision === 'allow' ? 'allow' : 'reject'
  const oneShot = decision === 'allow' ? 'allow_once' : 'reject_once'
  const exact = options.find((o) => o.kind === oneShot)
  if (exact) return exact.optionId
  const byPrefix = options.find((o) => o.kind.startsWith(prefix))
  if (byPrefix) return byPrefix.optionId
  return null
}

/**
 * Build the JSON-RPC response for a permission request. Defaults to a
 * 'cancelled' outcome whenever a 'selected' option can't be resolved — so a
 * deny, a cancel, or any option-matching failure never approves a tool.
 */
export function buildAcpPermissionResponse(
  rpcId: number | string,
  options: AcpPermissionOption[],
  decision: AcpPermissionDecision
): Record<string, unknown> {
  const optionId = selectAcpPermissionOption(options, decision)
  const outcome =
    decision !== 'cancel' && optionId
      ? { outcome: 'selected', optionId }
      : { outcome: 'cancelled' }
  return { jsonrpc: '2.0', id: rpcId, result: { outcome } }
}
