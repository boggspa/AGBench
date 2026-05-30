import { describe, it, expect } from 'vitest'
import {
  parseGrokStreamChunk,
  grokEventToRunEvents,
  type GrokStreamLine
} from './GrokStreamingJson'

describe('parseGrokStreamChunk', () => {
  it('parses a single NDJSON line and drains the carry', () => {
    const { lines, carry } = parseGrokStreamChunk('{"type":"assistant","text":"hi"}\n', '')
    expect(carry).toBe('')
    expect(lines).toHaveLength(1)
    expect(lines[0].json).toEqual({ type: 'assistant', text: 'hi' })
  })

  it('parses multiple lines in one chunk, in order', () => {
    const chunk = '{"type":"system","session_id":"s1"}\n{"type":"assistant","text":"a"}\n'
    const { lines } = parseGrokStreamChunk(chunk, '')
    expect(lines.map((l) => (l.json as { type: string }).type)).toEqual(['system', 'assistant'])
  })

  it('carries a partial trailing line across chunk boundaries', () => {
    const first = parseGrokStreamChunk('{"type":"assist', '')
    expect(first.lines).toHaveLength(0)
    expect(first.carry).toBe('{"type":"assist')
    const second = parseGrokStreamChunk('ant","text":"hello"}\n', first.carry)
    expect(second.lines).toHaveLength(1)
    expect(second.lines[0].json).toEqual({ type: 'assistant', text: 'hello' })
    expect(second.carry).toBe('')
  })

  it('skips blank lines and treats malformed JSON as a non-JSON line', () => {
    const { lines } = parseGrokStreamChunk('\n{not json\n   \n', '')
    expect(lines).toHaveLength(1)
    expect(lines[0].nonJson).toBe('{not json')
  })

  it('treats non-object JSON (array / scalar) as a non-JSON line', () => {
    const { lines } = parseGrokStreamChunk('[1,2,3]\n42\n', '')
    expect(lines).toHaveLength(2)
    expect(lines[0].nonJson).toBe('[1,2,3]')
    expect(lines[1].nonJson).toBe('42')
  })

  it('returns empty for empty / whitespace-only input', () => {
    expect(parseGrokStreamChunk('', '')).toEqual({ lines: [], carry: '' })
    expect(parseGrokStreamChunk('   \n  \n', '').lines).toHaveLength(0)
  })
})

describe('grokEventToRunEvents', () => {
  const json = (obj: Record<string, unknown>): GrokStreamLine => ({ json: obj })

  it('maps a Grok text token to a content event', () => {
    expect(grokEventToRunEvents(json({ type: 'text', data: 'Hi' }))).toEqual([
      { type: 'content', text: 'Hi', raw: expect.anything() }
    ])
  })

  it('maps a Grok thought token to a thinking event', () => {
    expect(grokEventToRunEvents(json({ type: 'thought', data: 'The user said hi.' }))).toEqual([
      { type: 'thinking', text: 'The user said hi.', raw: expect.anything() }
    ])
  })

  it('maps the terminal end event to a result event carrying the session id', () => {
    const events = grokEventToRunEvents(
      json({
        type: 'end',
        stopReason: 'EndTurn',
        sessionId: '019e708b-f82a-77a1-8836-9e3d2a025bf0',
        requestId: '2b4fc376-c1fd-45d8-abdf-e4831f550a5c'
      })
    )
    expect(events).toEqual([
      {
        type: 'result',
        status: 'success',
        sessionId: '019e708b-f82a-77a1-8836-9e3d2a025bf0',
        raw: expect.anything()
      }
    ])
  })

  it('reconstructs the assistant answer from a real token stream', () => {
    // Captured shape from grok 0.2.3: thought tokens, then text tokens, then end.
    const lines = [
      { type: 'thought', data: 'Greeting.' },
      { type: 'text', data: 'Hi' },
      { type: 'text', data: '!' },
      { type: 'text', data: ' How can I help?' },
      { type: 'end', stopReason: 'EndTurn', sessionId: 's1' }
    ]
    const answer = lines
      .flatMap((line) => grokEventToRunEvents({ json: line }))
      .filter((evt) => evt.type === 'content')
      .map((evt) => evt.text)
      .join('')
    expect(answer).toBe('Hi! How can I help?')
  })

  it('maps an error event to a provider_warning', () => {
    const events = grokEventToRunEvents(json({ type: 'error', data: 'boom' }))
    expect(events[0].type).toBe('provider_warning')
    expect(events[0].text).toBe('boom')
  })

  it('surfaces a non-JSON line verbatim as content (never drops output)', () => {
    expect(grokEventToRunEvents({ nonJson: 'plain stderr-ish line' })).toEqual([
      { type: 'content', text: 'plain stderr-ish line\n', raw: 'plain stderr-ish line' }
    ])
  })

  it('ignores genuinely-unknown event types and empty tokens', () => {
    expect(grokEventToRunEvents(json({ type: 'mystery_event', foo: 1 }))).toEqual([])
    expect(grokEventToRunEvents(json({ type: 'text' }))).toEqual([])
    expect(grokEventToRunEvents({})).toEqual([])
  })
})

describe('grokEventToRunEvents — tool events (G5d, best-effort shape)', () => {
  const json = (obj: Record<string, unknown>): GrokStreamLine => ({ json: obj })

  it('maps a flattened tool_use to a tool_use run event', () => {
    expect(
      grokEventToRunEvents(
        json({ type: 'tool_use', id: 't1', name: 'Write', input: { path: 'a.ts' } })
      )
    ).toEqual([
      {
        type: 'tool_use',
        toolId: 't1',
        toolName: 'Write',
        toolInput: { path: 'a.ts' },
        raw: expect.anything()
      }
    ])
  })

  it('accepts the tool_call alias + an arguments field + a generic name fallback', () => {
    expect(grokEventToRunEvents(json({ type: 'tool_call', arguments: { cmd: 'ls' } }))).toEqual([
      {
        type: 'tool_use',
        toolId: undefined,
        toolName: 'tool',
        toolInput: { cmd: 'ls' },
        raw: expect.anything()
      }
    ])
  })

  it('maps a successful tool_result carrying the originating tool id', () => {
    expect(
      grokEventToRunEvents(json({ type: 'tool_result', tool_use_id: 't1', output: 'ok' }))
    ).toEqual([
      {
        type: 'tool_result',
        toolId: 't1',
        toolStatus: 'success',
        toolOutput: 'ok',
        raw: expect.anything()
      }
    ])
  })

  it('flags an errored tool_result and stringifies structured output', () => {
    expect(
      grokEventToRunEvents(
        json({ type: 'tool_result', tool_call_id: 't2', is_error: true, content: { msg: 'boom' } })
      )
    ).toEqual([
      {
        type: 'tool_result',
        toolId: 't2',
        toolStatus: 'error',
        toolOutput: '{"msg":"boom"}',
        raw: expect.anything()
      }
    ])
  })
})
