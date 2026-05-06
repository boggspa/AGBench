export type NormalizedEvent =
  | { type: 'run_started'; session_id: string; model: string; timestamp: string; fallback?: boolean }
  | { type: 'user_message'; content: string; timestamp: string }
  | { type: 'assistant_message_delta'; content: string }
  | { type: 'assistant_message_complete'; content: string }
  | { type: 'tool_event'; name: string; data: any; timestamp: string; isUse: boolean; isResult: boolean }
  | { type: 'error'; message: string; timestamp: string }
  | { type: 'run_finished'; status: string; stats: any; timestamp: string }
  | { type: 'raw_event'; data: any }
  | { type: 'malformed_json'; text: string };

export class GeminiStreamAdapter {
  private buffer = '';

  constructor(private onEvent: (event: NormalizedEvent) => void) {}

  public appendChunk(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    // The last element is either an empty string (if chunk ended in \n) 
    // or an incomplete line.
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      this.parseLine(line);
    }
  }

  public end() {
    if (this.buffer.trim()) {
      this.parseLine(this.buffer);
      this.buffer = '';
    }
  }

  private parseLine(line: string) {
    try {
      const parsed = JSON.parse(line);
      this.normalizeEvent(parsed);
      this.onEvent({ type: 'raw_event', data: parsed });
    } catch (e) {
      this.onEvent({ type: 'malformed_json', text: line });
    }
  }

  private normalizeEvent(parsed: any) {
    if (!parsed || typeof parsed !== 'object') return;

    if (this.emitVisibleProgress(parsed)) {
      return;
    }

    switch (parsed.type) {
      case 'init':
        this.onEvent({
          type: 'run_started',
          session_id: parsed.session_id || 'unknown',
          model: parsed.model || 'unknown',
          timestamp: parsed.timestamp || new Date().toISOString(),
          fallback: Boolean(parsed.fallback)
        });
        break;
      case 'content':
        this.onEvent({
          type: 'assistant_message_delta',
          content: parsed.text || parsed.content || ''
        });
        break;
      case 'message':
        if (parsed.role === 'user') {
          this.onEvent({
            type: 'user_message',
            content: parsed.content || '',
            timestamp: parsed.timestamp || new Date().toISOString()
          });
        } else if (parsed.role === 'assistant') {
          if (parsed.delta) {
            this.onEvent({
              type: 'assistant_message_delta',
              content: parsed.content || ''
            });
          } else {
            this.onEvent({
              type: 'assistant_message_complete',
              content: parsed.content || ''
            });
          }
        }
        break;
      case 'result':
        this.onEvent({
          type: 'run_finished',
          status: parsed.status || 'unknown',
          stats: parsed.stats || {},
          timestamp: parsed.timestamp || new Date().toISOString()
        });
        break;
      case 'error':
        this.onEvent({
          type: 'error',
          message: parsed.message || parsed.error || 'Unknown error',
          timestamp: parsed.timestamp || new Date().toISOString()
        });
        break;
      default:
        // E.g., 'token', or tool calls
        // Note: The previous logic treated 'token' as textual output.
        // We'll treat them as tool_event or raw data. If it's literally 'token',
        // maybe it's just text chunks, but we map 'assistant_message_delta' from 'delta: true' messages.
        // If the CLI emits `{ "type": "token", "content": "..." }`, we can map it to delta:
        if (parsed.type === 'token') {
          this.onEvent({
            type: 'assistant_message_delta',
            content: parsed.content || ''
          });
        } else {
          const isUse = parsed.type === 'tool_use' || parsed.type === 'tool_call';
          const isResult = parsed.type === 'tool_result' || parsed.type === 'tool_output' || parsed.type === 'tool_response';
          const toolName =
            parsed.tool_name ||
            parsed.toolName ||
            parsed.name ||
            parsed.function?.name ||
            parsed.tool ||
            parsed.type ||
            'unknown';
          this.onEvent({
            type: 'tool_event',
            name: toolName,
            data: parsed,
            timestamp: parsed.timestamp || new Date().toISOString(),
            isUse,
            isResult
          });
        }
        break;
    }
  }

  private emitVisibleProgress(parsed: any): boolean {
    const eventName = String(parsed.type || parsed.name || parsed.tool_name || parsed.method || '').trim();
    const payload = parsed.payload || parsed.params?.payload || parsed.params || parsed;
    const normalizedName = eventName.toLowerCase();
    const hasTopLevelSummary = typeof parsed.summary === 'string' && normalizedName !== 'result';
    const progressNames = new Set(['update_topic', 'invoke_agent', 'summary', 'intent', 'progress', 'tool_progress']);
    if (!progressNames.has(normalizedName) && !hasTopLevelSummary) {
      return false;
    }

    const toolName = hasTopLevelSummary && !progressNames.has(normalizedName) ? 'summary' : normalizedName;
    const title =
      this.visibleString(payload?.title) ||
      this.visibleString(payload?.topic) ||
      this.visibleString(parsed.title) ||
      (toolName === 'invoke_agent' ? 'Delegated task' : toolName === 'intent' ? 'Intent' : toolName === 'summary' ? 'Summary' : 'Task update');
    const output =
      this.visibleString(payload?.summary) ||
      this.visibleString(parsed.summary) ||
      this.visibleString(payload?.message) ||
      this.visibleString(payload?.text) ||
      this.visibleString(payload?.content) ||
      this.visibleString(parsed.text) ||
      this.visibleString(parsed.content) ||
      this.visibleString(payload?.intent) ||
      this.visibleString(parsed.intent);
    const toolId = String(parsed.tool_id || parsed.toolId || parsed.id || `${toolName}-${Date.now()}`);
    const parameters = {
      title,
      kind: toolName,
      ...(output ? { summary: output } : {}),
      ...(payload && typeof payload === 'object' ? this.stripHiddenProgressFields(payload) : {})
    };

    this.onEvent({
      type: 'tool_event',
      name: toolName,
      data: {
        type: 'tool_use',
        tool_id: toolId,
        tool_name: toolName,
        parameters,
        provider: parsed.provider
      },
      timestamp: parsed.timestamp || new Date().toISOString(),
      isUse: true,
      isResult: false
    });

    if (output) {
      this.onEvent({
        type: 'tool_event',
        name: toolName,
        data: {
          type: 'tool_result',
          tool_id: toolId,
          tool_name: toolName,
          output,
          status: parsed.status === 'failed' || parsed.error ? 'error' : 'success',
          provider: parsed.provider
        },
        timestamp: parsed.timestamp || new Date().toISOString(),
        isUse: false,
        isResult: true
      });
    }

    return true;
  }

  private visibleString(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
  }

  private stripHiddenProgressFields(value: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, fieldValue] of Object.entries(value)) {
      if (/thought|thinking|chain|reasoning/i.test(key)) continue;
      if (typeof fieldValue === 'string' || typeof fieldValue === 'number' || typeof fieldValue === 'boolean') {
        sanitized[key] = fieldValue;
      }
    }
    return sanitized;
  }
}
