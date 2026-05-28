// Pure NDJSON parser + event mapper for `grok -p ... --output-format
// streaming-json`. No Electron / fs / child_process imports — unit-testable
// against fixture strings captured from the real Grok 0.2.3 CLI.
//
// Grok's streaming-json is its OWN shape (NOT Claude Code's): newline-delimited
// objects with a `type` discriminator and the payload text in `data`:
//   {"type":"thought","data":"..."}   reasoning / thinking token
//   {"type":"text","data":"..."}      assistant answer token
//   {"type":"end","stopReason":"EndTurn","sessionId":"...","requestId":"..."}
// All Grok-specific shape knowledge lives in `grokEventToRunEvents` (the single
// function to adjust if a future CLI version changes the wire shape).

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

/**
 * Map a single parsed NDJSON line to zero or more normalized run events. Never
 * throws; unknown event types are ignored (e.g. future tool events — read-only
 * G3 has no tools). Grok's shape: `{type, data}` for thought/text, and a
 * terminal `{type:'end', stopReason, sessionId}`.
 */
export function grokEventToRunEvents(line: GrokStreamLine): NormalizedGrokRunEvent[] {
  if (line.nonJson != null) {
    // Non-JSON stdout (banner / warning) is surfaced verbatim, never dropped.
    return [{ type: 'content', text: `${line.nonJson}\n`, raw: line.nonJson }]
  }
  const obj = line.json
  if (!obj) return []
  const eventType = typeof obj.type === 'string' ? obj.type : ''
  const data = typeof obj.data === 'string' ? obj.data : ''

  switch (eventType) {
    case 'text':
      // Assistant answer token.
      return data ? [{ type: 'content', text: data, raw: obj }] : []
    case 'thought':
    case 'reasoning':
      // Reasoning / thinking token.
      return data ? [{ type: 'thinking', text: data, raw: obj }] : []
    case 'end': {
      // Turn complete; carries the resumable session id.
      const sessionId = typeof obj.sessionId === 'string' ? obj.sessionId : undefined
      const stop = typeof obj.stopReason === 'string' ? obj.stopReason : ''
      const status = !stop || stop === 'EndTurn' || stop === 'Stop' ? 'success' : stop
      return [{ type: 'result', status, sessionId, raw: obj }]
    }
    case 'error':
      return [
        {
          type: 'provider_warning',
          text: data || (typeof obj.message === 'string' ? obj.message : 'Grok reported an error.'),
          raw: obj
        }
      ]
    default:
      return []
  }
}
