import { describe, it, expect, vi } from 'vitest';
import { GeminiStreamAdapter } from './GeminiAdapter';

describe('GeminiStreamAdapter', () => {
  it('parses complete JSONL lines correctly', () => {
    const onEvent = vi.fn();
    const adapter = new GeminiStreamAdapter(onEvent);

    adapter.appendChunk('{"type":"init","session_id":"123","model":"gemini"}\n');
    
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run_started',
      session_id: '123',
      model: 'gemini'
    }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'raw_event',
      data: { type: 'init', session_id: '123', model: 'gemini' }
    }));
  });

  it('buffers and parses chunks split across multiple calls', () => {
    const onEvent = vi.fn();
    const adapter = new GeminiStreamAdapter(onEvent);

    adapter.appendChunk('{"type":"me');
    expect(onEvent).not.toHaveBeenCalled();

    adapter.appendChunk('ssage","role":"user"');
    expect(onEvent).not.toHaveBeenCalled();

    adapter.appendChunk(',"content":"Hi"}\n');
    
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'user_message',
      content: 'Hi'
    }));
  });

  it('accumulates assistant deltas correctly based on delta field or token type', () => {
    const onEvent = vi.fn();
    const adapter = new GeminiStreamAdapter(onEvent);

    adapter.appendChunk('{"type":"message","role":"assistant","content":"Hel","delta":true}\n');
    adapter.appendChunk('{"type":"token","content":"lo"}\n');
    
    expect(onEvent).toHaveBeenCalledWith({ type: 'assistant_message_delta', content: 'Hel' });
    expect(onEvent).toHaveBeenCalledWith({ type: 'assistant_message_delta', content: 'lo' });
  });

  it('falls back to malformed_json if it is not valid JSON', () => {
    const onEvent = vi.fn();
    const adapter = new GeminiStreamAdapter(onEvent);

    adapter.appendChunk('This is just raw text from stderr or something\n');
    
    expect(onEvent).toHaveBeenCalledWith({
      type: 'malformed_json',
      text: 'This is just raw text from stderr or something'
    });
  });

  it('recognizes tool_call as tool_use and extracts tool name', () => {
    const onEvent = vi.fn();
    const adapter = new GeminiStreamAdapter(onEvent);

    adapter.appendChunk('{"type":"tool_call","tool":"readFile"}\n');
    
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_event',
      name: 'readFile',
      data: { type: 'tool_call', tool: 'readFile' },
      isUse: true,
      isResult: false
    }));
  });

  it('extracts tool_name for tool_use events', () => {
    const onEvent = vi.fn();
    const adapter = new GeminiStreamAdapter(onEvent);

    adapter.appendChunk('{"type":"tool_use","tool_name":"read_file","tool_id":"123","parameters":{"file_path":"README.md"}}\n');
    
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_event',
      name: 'read_file',
      isUse: true,
      isResult: false
    }));
  });

  it('extracts tool_name for tool_result events', () => {
    const onEvent = vi.fn();
    const adapter = new GeminiStreamAdapter(onEvent);

    adapter.appendChunk('{"type":"tool_result","tool_name":"read_file","tool_id":"123","output":"Hello"}\n');
    
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_event',
      name: 'read_file',
      isUse: false,
      isResult: true
    }));
  });

  it('falls back to event type if no tool_name is present', () => {
    const onEvent = vi.fn();
    const adapter = new GeminiStreamAdapter(onEvent);

    adapter.appendChunk('{"type":"custom_event","value":42}\n');
    
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_event',
      name: 'custom_event',
      isUse: false,
      isResult: false
    }));
  });

  it('normalizes update_topic events into visible task progress', () => {
    const onEvent = vi.fn();
    const adapter = new GeminiStreamAdapter(onEvent);

    adapter.appendChunk('{"type":"update_topic","title":"Metal Triangles Harness","summary":"Setting up the SwiftPM harness."}\n');

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_event',
      name: 'update_topic',
      isUse: true
    }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_event',
      name: 'update_topic',
      isResult: true,
      data: expect.objectContaining({ output: 'Setting up the SwiftPM harness.' })
    }));
  });

  it('normalizes invoke_agent progress without hidden thinking fields', () => {
    const onEvent = vi.fn();
    const adapter = new GeminiStreamAdapter(onEvent);

    adapter.appendChunk('{"type":"invoke_agent","payload":{"title":"Metal Triangles Harness","summary":"I am initializing a new Swift package.","thought":"private scratchpad"}}\n');

    const toolUse = onEvent.mock.calls.find(([event]) => event.type === 'tool_event' && event.isUse)?.[0];
    expect(toolUse).toMatchObject({
      type: 'tool_event',
      name: 'invoke_agent',
      data: {
        parameters: expect.objectContaining({
          title: 'Metal Triangles Harness',
          summary: 'I am initializing a new Swift package.'
        })
      }
    });
    expect(JSON.stringify(toolUse)).not.toContain('private scratchpad');
  });

  it('normalizes top-level visible summary events', () => {
    const onEvent = vi.fn();
    const adapter = new GeminiStreamAdapter(onEvent);

    adapter.appendChunk('{"summary":"No shell tools are available in this environment."}\n');

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_event',
      name: 'summary',
      isResult: true
    }));
  });
});
