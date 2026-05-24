import { describe, it, expect, vi } from 'vitest'
import { GeminiStreamAdapter } from './GeminiAdapter'

describe('GeminiStreamAdapter', () => {
  it('parses complete JSONL lines correctly', () => {
    const onEvent = vi.fn()
    const adapter = new GeminiStreamAdapter(onEvent)

    adapter.appendChunk('{"type":"init","session_id":"123","model":"gemini"}\n')

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run_started',
        session_id: '123',
        model: 'gemini'
      })
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'raw_event',
        data: { type: 'init', session_id: '123', model: 'gemini' }
      })
    )
  })

  it('buffers and parses chunks split across multiple calls', () => {
    const onEvent = vi.fn()
    const adapter = new GeminiStreamAdapter(onEvent)

    adapter.appendChunk('{"type":"me')
    expect(onEvent).not.toHaveBeenCalled()

    adapter.appendChunk('ssage","role":"user"')
    expect(onEvent).not.toHaveBeenCalled()

    adapter.appendChunk(',"content":"Hi"}\n')

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'user_message',
        content: 'Hi'
      })
    )
  })

  it('accumulates assistant deltas correctly based on delta field or token type', () => {
    const onEvent = vi.fn()
    const adapter = new GeminiStreamAdapter(onEvent)

    adapter.appendChunk('{"type":"message","role":"assistant","content":"Hel","delta":true}\n')
    adapter.appendChunk('{"type":"token","content":"lo"}\n')

    expect(onEvent).toHaveBeenCalledWith({ type: 'assistant_message_delta', content: 'Hel' })
    expect(onEvent).toHaveBeenCalledWith({ type: 'assistant_message_delta', content: 'lo' })
  })

  it('falls back to malformed_json if it is not valid JSON', () => {
    const onEvent = vi.fn()
    const adapter = new GeminiStreamAdapter(onEvent)

    adapter.appendChunk('This is just raw text from stderr or something\n')

    expect(onEvent).toHaveBeenCalledWith({
      type: 'malformed_json',
      text: 'This is just raw text from stderr or something'
    })
  })

  it('recognizes tool_call as tool_use and extracts tool name', () => {
    const onEvent = vi.fn()
    const adapter = new GeminiStreamAdapter(onEvent)

    adapter.appendChunk('{"type":"tool_call","tool":"readFile"}\n')

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_event',
        name: 'readFile',
        data: { type: 'tool_call', tool: 'readFile' },
        isUse: true,
        isResult: false
      })
    )
  })

  it('extracts tool_name for tool_use events', () => {
    const onEvent = vi.fn()
    const adapter = new GeminiStreamAdapter(onEvent)

    adapter.appendChunk(
      '{"type":"tool_use","tool_name":"read_file","tool_id":"123","parameters":{"file_path":"README.md"}}\n'
    )

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_event',
        name: 'read_file',
        isUse: true,
        isResult: false
      })
    )
  })

  it('extracts tool_name for tool_result events', () => {
    const onEvent = vi.fn()
    const adapter = new GeminiStreamAdapter(onEvent)

    adapter.appendChunk(
      '{"type":"tool_result","tool_name":"read_file","tool_id":"123","output":"Hello"}\n'
    )

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_event',
        name: 'read_file',
        isUse: false,
        isResult: true
      })
    )
  })

  it('falls back to event type if no tool_name is present', () => {
    const onEvent = vi.fn()
    const adapter = new GeminiStreamAdapter(onEvent)

    adapter.appendChunk('{"type":"custom_event","value":42}\n')

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_event',
        name: 'custom_event',
        isUse: false,
        isResult: false
      })
    )
  })

  it('normalizes update_topic events into visible task progress', () => {
    const onEvent = vi.fn()
    const adapter = new GeminiStreamAdapter(onEvent)

    adapter.appendChunk(
      '{"type":"update_topic","title":"Metal Triangles Harness","summary":"Setting up the SwiftPM harness."}\n'
    )

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_event',
        name: 'update_topic',
        isUse: true
      })
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_event',
        name: 'update_topic',
        isResult: true,
        data: expect.objectContaining({ output: 'Setting up the SwiftPM harness.' })
      })
    )
  })

  it('normalizes invoke_agent progress without hidden thinking fields', () => {
    const onEvent = vi.fn()
    const adapter = new GeminiStreamAdapter(onEvent)

    adapter.appendChunk(
      '{"type":"invoke_agent","payload":{"title":"Metal Triangles Harness","summary":"I am initializing a new Swift package.","thought":"private scratchpad"}}\n'
    )

    const toolUse = onEvent.mock.calls.find(
      ([event]) => event.type === 'tool_event' && event.isUse
    )?.[0]
    expect(toolUse).toMatchObject({
      type: 'tool_event',
      name: 'invoke_agent',
      data: {
        parameters: expect.objectContaining({
          title: 'Metal Triangles Harness',
          summary: 'I am initializing a new Swift package.'
        })
      }
    })
    expect(JSON.stringify(toolUse)).not.toContain('private scratchpad')
  })

  it('normalizes top-level visible summary events', () => {
    const onEvent = vi.fn()
    const adapter = new GeminiStreamAdapter(onEvent)

    adapter.appendChunk('{"summary":"No shell tools are available in this environment."}\n')

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_event',
        name: 'summary',
        isResult: true
      })
    )
  })

  it('normalizes Kimi SubagentEvent records as visible delegated tool activity', () => {
    const onEvent = vi.fn()
    const adapter = new GeminiStreamAdapter(onEvent)

    adapter.appendChunk(
      '{"method":"event","params":{"type":"SubagentEvent","agent_id":"agent-42","parent_tool_call_id":"tool-1","subagent_type":"explore"}}\n'
    )

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_event',
        name: 'SubagentEvent',
        isUse: true,
        data: expect.objectContaining({
          type: 'tool_use',
          tool_name: 'SubagentEvent',
          tool_id: 'agent-42'
        })
      })
    )
  })

  // Phase K1 — Codex `content` events carry an `itemId` per logical
  // assistant message item and a `complete: true` sentinel at the end of
  // each item. We propagate the id but skip emitting an event for the
  // zero-text completion sentinel so the renderer doesn't clobber the
  // live message with empty content.
  it('propagates itemId on Codex content deltas', () => {
    const onEvent = vi.fn()
    const adapter = new GeminiStreamAdapter(onEvent)

    adapter.appendChunk(
      '{"type":"content","text":"Hel","provider":"codex","itemId":"agent-msg-1"}\n'
    )

    expect(onEvent).toHaveBeenCalledWith({
      type: 'assistant_message_delta',
      content: 'Hel',
      itemId: 'agent-msg-1'
    })
  })

  it('skips emitting an event for empty Codex completion sentinels', () => {
    const onEvent = vi.fn()
    const adapter = new GeminiStreamAdapter(onEvent)

    adapter.appendChunk(
      '{"type":"content","text":"","provider":"codex","itemId":"agent-msg-1","complete":true}\n'
    )

    // Adapter should still emit the raw event for audit but NOT an
    // assistant_message_delta with empty content (which would clobber
    // the live message).
    const eventTypes = onEvent.mock.calls.map((args) => args[0]?.type)
    expect(eventTypes).toContain('raw_event')
    expect(eventTypes).not.toContain('assistant_message_delta')
    expect(eventTypes).not.toContain('assistant_message_complete')
  })

  it('still emits a delta when complete=true arrives with non-empty text (defensive)', () => {
    // Defensive: if main ever bundles the final tail + complete=true on
    // the same line instead of two events, the renderer should still
    // see the text as a delta and not silently drop it.
    const onEvent = vi.fn()
    const adapter = new GeminiStreamAdapter(onEvent)

    adapter.appendChunk(
      '{"type":"content","text":"tail","provider":"codex","itemId":"agent-msg-2","complete":true}\n'
    )

    expect(onEvent).toHaveBeenCalledWith({
      type: 'assistant_message_delta',
      content: 'tail',
      itemId: 'agent-msg-2'
    })
  })

  it('keeps representative provider streaming fixtures intact', () => {
    const fixtures = [
      {
        provider: 'codex',
        jsonl: [
          { type: 'init', session_id: 'codex-session', model: 'codex', provider: 'codex' },
          { type: 'content', text: 'Codex ', provider: 'codex', itemId: 'item-1' },
          { type: 'content', text: 'stream', provider: 'codex', itemId: 'item-1' },
          {
            type: 'tool_use',
            tool_name: 'read_file',
            tool_id: 'tool-1',
            parameters: { path: 'README.md' },
            provider: 'codex'
          },
          {
            type: 'tool_result',
            tool_name: 'read_file',
            tool_id: 'tool-1',
            output: 'ok',
            provider: 'codex'
          },
          { type: 'content', text: '', provider: 'codex', itemId: 'item-1', complete: true },
          { type: 'result', status: 'success', providerThreadId: 'codex-session' }
        ],
        text: 'Codex stream',
        tool: 'read_file'
      },
      {
        provider: 'claude',
        jsonl: [
          { type: 'init', session_id: 'claude-session', model: 'claude', provider: 'claude' },
          { type: 'message', role: 'assistant', content: 'Claude ', delta: true },
          { type: 'token', content: 'stream' },
          {
            type: 'tool_use',
            tool_name: 'run_shell_command',
            tool_id: 'tool-2',
            parameters: { command: 'pwd' },
            provider: 'claude'
          },
          {
            type: 'tool_result',
            tool_name: 'run_shell_command',
            tool_id: 'tool-2',
            output: '/tmp',
            provider: 'claude'
          },
          { type: 'result', status: 'success', providerThreadId: 'claude-session' }
        ],
        text: 'Claude stream',
        tool: 'run_shell_command'
      },
      {
        provider: 'gemini',
        jsonl: [
          { type: 'init', session_id: 'gemini-session', model: 'gemini', provider: 'gemini' },
          { type: 'message', role: 'assistant', content: 'Gemini ', delta: true },
          { type: 'message', role: 'assistant', content: 'stream', delta: true },
          {
            type: 'tool_use',
            tool_name: 'list_directory',
            tool_id: 'tool-3',
            parameters: { path: '.' },
            provider: 'gemini'
          },
          {
            type: 'tool_result',
            tool_name: 'list_directory',
            tool_id: 'tool-3',
            output: 'src',
            provider: 'gemini'
          },
          { type: 'result', status: 'success', providerThreadId: 'gemini-session' }
        ],
        text: 'Gemini stream',
        tool: 'list_directory'
      },
      {
        provider: 'kimi',
        jsonl: [
          { type: 'init', session_id: 'kimi-session', model: 'kimi', provider: 'kimi' },
          { type: 'content', text: 'Kimi ', provider: 'kimi' },
          { type: 'content', text: 'stream', provider: 'kimi' },
          {
            type: 'tool_use',
            tool_name: 'kimi_thinking',
            tool_id: 'tool-4',
            parameters: { title: 'Kimi thinking' },
            provider: 'kimi'
          },
          {
            type: 'tool_result',
            tool_name: 'kimi_thinking',
            tool_id: 'tool-4',
            output: 'reasoning summary',
            provider: 'kimi'
          },
          { type: 'result', status: 'success', providerThreadId: 'kimi-session' }
        ],
        text: 'Kimi stream',
        tool: 'kimi_thinking'
      }
    ]

    for (const fixture of fixtures) {
      const onEvent = vi.fn()
      const adapter = new GeminiStreamAdapter(onEvent)
      const jsonl = fixture.jsonl.map((event) => JSON.stringify(event)).join('\n') + '\n'

      adapter.appendChunk(jsonl.slice(0, Math.floor(jsonl.length / 2)))
      adapter.appendChunk(jsonl.slice(Math.floor(jsonl.length / 2)))
      adapter.end()

      const events = onEvent.mock.calls.map(([event]) => event)
      const streamedText = events
        .filter((event) => event.type === 'assistant_message_delta')
        .map((event) => event.content)
        .join('')
      expect(streamedText).toBe(fixture.text)
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'tool_event',
          name: fixture.tool,
          isUse: true
        })
      )
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'tool_event',
          name: fixture.tool,
          isResult: true
        })
      )
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'run_finished',
          status: 'success'
        })
      )
    }
  })
})
