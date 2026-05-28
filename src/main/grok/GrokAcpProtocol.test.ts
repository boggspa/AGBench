import { describe, it, expect } from 'vitest'
import { encodeAcpFrame, parseAcpStreamChunk, acpMessageToRunEvents } from './GrokAcpProtocol'

describe('encodeAcpFrame', () => {
  it('serializes a JSON-RPC request as one NDJSON line', () => {
    const frame = encodeAcpFrame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(frame.endsWith('\n')).toBe(true)
    expect(JSON.parse(frame.trim())).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {}
    })
  })
})

describe('parseAcpStreamChunk', () => {
  it('parses NDJSON messages and carries a partial trailing line', () => {
    const first = parseAcpStreamChunk('{"jsonrpc":"2.0","id":1,"result":{}}\n{"jsonrpc":"2.', '')
    expect(first.messages).toHaveLength(1)
    expect(first.messages[0]).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
    expect(first.carry).toBe('{"jsonrpc":"2.')
    const second = parseAcpStreamChunk('0","method":"session/update","params":{}}\n', first.carry)
    expect(second.messages[0]).toEqual({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {}
    })
    expect(second.carry).toBe('')
  })

  it('skips non-JSON noise lines', () => {
    const { messages } = parseAcpStreamChunk('not json\n{"jsonrpc":"2.0","id":9,"result":{}}\n', '')
    expect(messages).toEqual([{ jsonrpc: '2.0', id: 9, result: {} }])
  })
})

describe('acpMessageToRunEvents', () => {
  it('maps an agent_message_chunk to a content event', () => {
    const events = acpMessageToRunEvents({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 's1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi' } }
      }
    })
    expect(events).toEqual([{ type: 'content', text: 'Hi', raw: expect.anything() }])
  })

  it('maps an agent_thought_chunk to a thinking event', () => {
    const events = acpMessageToRunEvents({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 's1',
        update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Hmm.' } }
      }
    })
    expect(events).toEqual([{ type: 'thinking', text: 'Hmm.', raw: expect.anything() }])
  })

  it('ignores command/model update notifications', () => {
    expect(
      acpMessageToRunEvents({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 's1', update: { sessionUpdate: 'available_commands_update' } }
      })
    ).toEqual([])
  })

  it('captures the session id from a session/new result', () => {
    const events = acpMessageToRunEvents({
      jsonrpc: '2.0',
      id: 2,
      result: {
        sessionId: '019e70a1-3763-7c93-a1b4-f02d31596701',
        models: { currentModelId: 'grok-build' }
      }
    })
    expect(events).toEqual([
      { type: 'init', sessionId: '019e70a1-3763-7c93-a1b4-f02d31596701', raw: expect.anything() }
    ])
  })

  it('maps the session/prompt result (stopReason in _meta) to a result event', () => {
    const events = acpMessageToRunEvents({
      jsonrpc: '2.0',
      id: 3,
      result: {
        stopReason: 'end_turn',
        _meta: { sessionId: 's1', requestId: 'r1', promptId: 'p1' }
      }
    })
    expect(events).toEqual([
      { type: 'init', sessionId: 's1', raw: expect.anything() },
      { type: 'result', status: 'end_turn', sessionId: 's1', raw: expect.anything() }
    ])
  })

  it('maps the _x.ai prompt_complete notification to a result event', () => {
    const events = acpMessageToRunEvents({
      jsonrpc: '2.0',
      method: '_x.ai/session/prompt_complete',
      params: { sessionId: 's1', stopReason: 'end_turn', agentResult: null }
    })
    expect(events).toEqual([{ type: 'result', status: 'end_turn', raw: expect.anything() }])
  })

  it('maps a JSON-RPC error to a provider_warning', () => {
    const events = acpMessageToRunEvents({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32000, message: 'boom' }
    })
    expect(events[0].type).toBe('provider_warning')
    expect(events[0].text).toBe('boom')
  })

  it('reconstructs the assistant answer from a real ACP update stream', () => {
    // Shape captured from grok 0.2.8 `agent stdio` (G1 spike).
    const stream = [
      {
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'Greeting.' }
          }
        }
      },
      {
        method: 'session/update',
        params: {
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi' } }
        }
      },
      {
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: '! How can I help?' }
          }
        }
      },
      { method: '_x.ai/session/prompt_complete', params: { stopReason: 'end_turn' } }
    ]
    const answer = stream
      .flatMap((m) => acpMessageToRunEvents(m as Record<string, unknown>))
      .filter((evt) => evt.type === 'content')
      .map((evt) => evt.text)
      .join('')
    expect(answer).toBe('Hi! How can I help?')
  })
})
