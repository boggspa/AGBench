// Pure NDJSON parser + event mapper for `grok -p ... --output-format
// streaming-json`. No Electron / fs / child_process imports — unit-testable
// against fixture strings (we never run a live/authenticated Grok prompt
// during the build).
//
// The Grok Build CLI is closely modelled on Claude Code, so the streaming-json
// events mirror Claude's stream-json shape (`type: 'system'|'assistant'|
// 'result'`, `message.content[].text`, `content_block_delta` → `delta.text`).
// The exact field names are NOT published, so the mapping is DEFENSIVE and the
// grok-specific shape knowledge is isolated in `grokEventToRunEvents` — the
// single function to adjust once the first read-only smoke run captures the
// real event lines.

export interface GrokStreamLine {
  /** Parsed JSON object for a well-formed NDJSON line. */
  json?: Record<string, unknown>
  /** Raw text for a non-JSON line (banner, warning, malformed) — never dropped. */
  nonJson?: string
}

export interface NormalizedGrokRunEvent {
  type: 'init' | 'content' | 'thinking' | 'result' | 'provider_warning'
  text?: string
  sessionId?: string
  status?: string
  raw?: unknown
}

/**
 * Split a streaming-json chunk into NDJSON lines, carrying any partial trailing
 * line across chunk boundaries. `carry` is the leftover from the previous call
 * ('' on first call). Mirrors the line-buffering in `runCliProviderProcess`.
 */
export function parseGrokStreamChunk(
  rawChunk: string,
  carry: string
): { lines: GrokStreamLine[]; carry: string } {
  const buffer = (carry || '') + (rawChunk || '')
  const segments = buffer.split(/\r?\n/)
  const nextCarry = segments.pop() ?? ''
  const lines: GrokStreamLine[] = []
  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        lines.push({ json: parsed as Record<string, unknown> })
      } else {
        lines.push({ nonJson: segment })
      }
    } catch {
      lines.push({ nonJson: segment })
    }
  }
  return { lines, carry: nextCarry }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Walk a Claude/Grok-shaped content value into plain text, defensively. */
function collectText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(collectText).join('')
  const obj = asObject(value)
  if (!obj) return ''
  if (typeof obj.text === 'string') return obj.text
  if ('content' in obj) return collectText(obj.content)
  if ('message' in obj) return collectText(obj.message)
  if ('delta' in obj) return collectText(obj.delta)
  return ''
}

function extractSessionId(obj: Record<string, unknown>): string | undefined {
  for (const candidate of [obj.session_id, obj.sessionId, obj.session]) {
    if (typeof candidate === 'string' && candidate) return candidate
  }
  return undefined
}

/**
 * Map a single parsed NDJSON line to zero or more normalized run events. Never
 * throws; unknown event types are ignored unless they carry assistant text (in
 * which case we still surface it so a schema we didn't anticipate never drops
 * visible output).
 */
export function grokEventToRunEvents(line: GrokStreamLine): NormalizedGrokRunEvent[] {
  if (line.nonJson != null) {
    return [{ type: 'content', text: `${line.nonJson}\n`, raw: line.nonJson }]
  }
  const obj = line.json
  if (!obj) return []
  const eventType = typeof obj.type === 'string' ? obj.type : ''
  const sessionId = extractSessionId(obj)

  switch (eventType) {
    case 'system':
      // Init handshake: carries the (resumable) session id, no visible text.
      return [{ type: 'init', sessionId, raw: obj }]
    case 'assistant':
    case 'message':
    case 'message_delta':
    case 'content_block_delta':
    case 'stream_event': {
      const text = collectText(obj)
      const events: NormalizedGrokRunEvent[] = []
      if (sessionId) events.push({ type: 'init', sessionId, raw: obj })
      if (text) events.push({ type: 'content', text, raw: obj })
      return events
    }
    case 'thinking':
    case 'reasoning': {
      const text = collectText(obj)
      return text ? [{ type: 'thinking', text, raw: obj }] : []
    }
    case 'result':
    case 'turn_end':
    case 'TurnEnd': {
      const text = collectText('result' in obj ? obj.result : obj)
      const status =
        typeof obj.subtype === 'string'
          ? obj.subtype
          : typeof obj.status === 'string'
            ? obj.status
            : 'success'
      const events: NormalizedGrokRunEvent[] = []
      if (text) events.push({ type: 'content', text, raw: obj })
      events.push({ type: 'result', status, sessionId, raw: obj })
      return events
    }
    case 'error':
      return [
        { type: 'provider_warning', text: collectText(obj) || 'Grok reported an error.', raw: obj }
      ]
    default: {
      // Unrecognized event type: ignore unless it obviously carries text.
      const text = collectText(obj)
      return text ? [{ type: 'content', text, raw: obj }] : []
    }
  }
}
