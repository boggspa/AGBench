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

  it('maps a Claude-shaped assistant message to a content event', () => {
    const events = grokEventToRunEvents(
      json({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello world' }] } })
    )
    expect(events).toEqual([{ type: 'content', text: 'Hello world', raw: expect.anything() }])
  })

  it('maps a content_block_delta to a content event (streaming partials)', () => {
    const events = grokEventToRunEvents(
      json({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } })
    )
    expect(events).toEqual([{ type: 'content', text: 'lo', raw: expect.anything() }])
  })

  it('maps a system init event to an init event carrying the session id', () => {
    const events = grokEventToRunEvents(json({ type: 'system', subtype: 'init', session_id: 's1' }))
    expect(events).toEqual([{ type: 'init', sessionId: 's1', raw: expect.anything() }])
  })

  it('maps a final result event to a result event (+ content when result text is present)', () => {
    const events = grokEventToRunEvents(
      json({ type: 'result', subtype: 'success', result: 'final answer', session_id: 's1' })
    )
    expect(events).toEqual([
      { type: 'content', text: 'final answer', raw: expect.anything() },
      { type: 'result', status: 'success', sessionId: 's1', raw: expect.anything() }
    ])
  })

  it('maps an error event to a provider_warning', () => {
    const events = grokEventToRunEvents(json({ type: 'error', message: 'boom' }))
    expect(events[0].type).toBe('provider_warning')
    expect(events[0].text).toBe('boom')
  })

  it('surfaces a non-JSON line verbatim as content (never drops output)', () => {
    const events = grokEventToRunEvents({ nonJson: 'plain stderr-ish line' })
    expect(events).toEqual([
      { type: 'content', text: 'plain stderr-ish line\n', raw: 'plain stderr-ish line' }
    ])
  })

  it('ignores an unknown event type with no text', () => {
    expect(grokEventToRunEvents(json({ type: 'mystery', foo: 1 }))).toEqual([])
  })

  it('still surfaces text from an unrecognized but text-bearing event', () => {
    const events = grokEventToRunEvents(json({ type: 'agent_output', text: 'surprise' }))
    expect(events).toEqual([{ type: 'content', text: 'surprise', raw: expect.anything() }])
  })

  it('returns nothing for an empty line', () => {
    expect(grokEventToRunEvents({})).toEqual([])
  })
})
