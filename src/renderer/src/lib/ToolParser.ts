import { ToolActivity, ToolActivityStatus } from '../../../main/store/types';

export function extractToolName(event: any): string {
  if (!event || typeof event !== 'object') return 'unknown';
  return (
    event.tool_name ||
    event.toolName ||
    event.name ||
    event.function?.name ||
    event.tool ||
    'unknown'
  );
}

export function extractToolId(event: any): string {
  if (!event || typeof event !== 'object') return `unknown-${Date.now()}`;
  return (
    event.tool_id ||
    event.toolId ||
    event.id ||
    event.call_id ||
    event.tool_call_id ||
    `unknown-${Date.now()}`
  );
}

export function extractParameters(event: any): Record<string, unknown> {
  if (!event || typeof event !== 'object') return {};
  return (
    event.parameters ||
    event.params ||
    event.payload ||
    event.args ||
    event.input ||
    event.arguments ||
    {}
  );
}

export function extractResultOutput(resultEvent: any): string {
  if (!resultEvent || typeof resultEvent !== 'object') return '';
  const evt = resultEvent;
  if (typeof evt.output === 'string') return evt.output;
  if (typeof evt.result === 'string') return evt.result;
  if (typeof evt.content === 'string') return evt.content;
  if (typeof evt.summary === 'string') return evt.summary;
  if (typeof evt.message === 'string') return evt.message;
  if (typeof evt.text === 'string') return evt.text;
  if (evt.result && typeof evt.result === 'object') {
    if (typeof evt.result.output === 'string') return evt.result.output;
    if (typeof evt.result.summary === 'string') return evt.result.summary;
    if (typeof evt.result.message === 'string') return evt.result.message;
    return JSON.stringify(evt.result);
  }
  if (evt.output && typeof evt.output === 'object') {
    return JSON.stringify(evt.output);
  }
  return '';
}

export function extractStatus(resultEvent: any): ToolActivityStatus {
  if (!resultEvent || typeof resultEvent !== 'object') return 'success';
  if (resultEvent.error || resultEvent.status === 'error') return 'error';
  if (resultEvent.status === 'warning') return 'warning';
  return 'success';
}

export type ToolCategory = 'task' | 'read' | 'write' | 'search' | 'shell' | 'unknown';

export function getToolCategory(toolName: string): ToolCategory {
  const name = (toolName || '').toLowerCase();
  if (['update_topic', 'invoke_agent', 'summary', 'intent', 'progress', 'tool_progress', 'codex_reasoning', 'codex_plan'].includes(name)) return 'task';
  if (name === 'read_file' || name === 'list_directory') return 'read';
  if (['replace', 'write_file', 'create_file', 'edit_file'].includes(name)) return 'write';
  if (['grep_search', 'glob', 'search', 'grep', 'rg', 'google_web_search', 'web_search'].includes(name)) return 'search';
  if (name === 'run_shell_command' || name === 'shell') return 'shell';
  return 'unknown';
}

export function getToolDisplayName(toolName: string, parameters?: Record<string, unknown>): string {
  const category = getToolCategory(toolName);
  const params = parameters || {};
  const filePath = (params.file_path as string) || (params.path as string) || '';

  switch (category) {
    case 'task':
      if (toolName.toLowerCase() === 'codex_reasoning') return (params.title as string) || 'Thinking note';
      if (toolName.toLowerCase() === 'codex_plan') return 'Plan update';
      if (toolName.toLowerCase() === 'invoke_agent') return (params.title as string) || 'Delegated task';
      if (toolName.toLowerCase() === 'summary') return (params.title as string) || 'Summary';
      if (toolName.toLowerCase() === 'intent') return (params.title as string) || 'Intent';
      return (params.title as string) || 'Task update';
    case 'read':
      if (toolName.toLowerCase() === 'list_directory') return filePath ? `Listed ${filePath}` : 'Listed directory';
      return filePath ? `Read ${filePath}` : 'Read file';
    case 'write': {
      if (toolName.toLowerCase() === 'replace') {
        return filePath ? `Edited ${filePath}` : 'Edited file';
      }
      if (toolName.toLowerCase() === 'create_file') {
        return filePath ? `Created ${filePath}` : 'Created file';
      }
      return filePath ? `Wrote ${filePath}` : 'Wrote file';
    }
    case 'search': {
      const query = (params.query as string) || (params.search_query as string) || (params.pattern as string) || '';
      if (toolName.toLowerCase().includes('web_search')) {
        return query ? `Searched web for ${query}` : 'Searched web';
      }
      const searchPath = (params.path as string) || (params.dir as string) || '';
      return query ? `Searched for ${query}` : searchPath ? `Searched ${searchPath}` : 'Searched project';
    }
    case 'shell':
      return 'Shell command';
    default:
      return toolName && toolName !== 'unknown' ? `Used ${toolName}` : 'Used unknown';
  }
}

export function estimateLineChanges(parameters?: Record<string, unknown>): { additions?: number; deletions?: number } {
  if (!parameters) return {};
  const oldString = parameters.old_string as string | undefined;
  const newString = parameters.new_string as string | undefined;
  if (typeof oldString === 'string' && typeof newString === 'string') {
    const oldLines = oldString.split('\n').length;
    const newLines = newString.split('\n').length;
    return { additions: newLines, deletions: oldLines };
  }
  const content = parameters.content as string | undefined;
  if (typeof content === 'string') {
    return { additions: content.split('\n').length, deletions: 0 };
  }
  return {};
}

export function createToolActivity(toolUseEvent: any): ToolActivity {
  const toolName = extractToolName(toolUseEvent);
  const parameters = extractParameters(toolUseEvent);
  const category = getToolCategory(toolName);
  const displayName = getToolDisplayName(toolName, parameters);
  const filePath = (parameters.file_path as string) || (parameters.path as string) || undefined;

  return {
    id: extractToolId(toolUseEvent),
    toolName,
    displayName,
    category,
    status: 'running',
    startedAt: new Date().toISOString(),
    parameters,
    filePath,
    rawUseEvent: toolUseEvent,
    // Legacy fields
    operationCategory: category as any,
    affectedFilePath: filePath,
  };
}

export function pairToolResult(activity: ToolActivity, toolResultEvent: any): ToolActivity {
  const resultOutput = extractResultOutput(toolResultEvent);
  const status = extractStatus(toolResultEvent);
  const endedAt = new Date().toISOString();
  const durationMs =
    activity.startedAt
      ? new Date(endedAt).getTime() - new Date(activity.startedAt).getTime()
      : undefined;

  return {
    ...activity,
    status,
    endedAt,
    durationMs,
    resultSummary: resultOutput.substring(0, 500) + (resultOutput.length > 500 ? '...' : ''),
    outputPreview: resultOutput.substring(0, 500) + (resultOutput.length > 500 ? '...' : ''),
    rawResultEvent: toolResultEvent,
    // Legacy
    outputSummary: resultOutput.substring(0, 500) + (resultOutput.length > 500 ? '...' : ''),
  };
}

export function isToolUseEvent(event: any): boolean {
  if (!event || typeof event !== 'object') return false;
  return event.type === 'tool_use' || event.type === 'tool_call';
}

export function isToolResultEvent(event: any): boolean {
  if (!event || typeof event !== 'object') return false;
  return event.type === 'tool_result' || event.type === 'tool_output' || event.type === 'tool_response';
}
