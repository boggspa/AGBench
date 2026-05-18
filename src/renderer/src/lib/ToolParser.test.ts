import { describe, it, expect } from 'vitest';
import {
  extractToolName,
  extractToolId,
  extractParameters,
  extractResultOutput,
  extractStatus,
  getToolCategory,
  getToolDisplayName,
  isWriteLikeToolName,
  estimateLineChanges,
  deriveToolDiffSummary,
  parseUnifiedDiffSummary,
  createToolActivity,
  pairToolResult,
  isToolUseEvent,
  isToolResultEvent,
} from './ToolParser';

describe('ToolParser', () => {
  describe('extractToolName', () => {
    it('extracts tool_name', () => {
      expect(extractToolName({ tool_name: 'read_file' })).toBe('read_file');
    });
    it('extracts toolName', () => {
      expect(extractToolName({ toolName: 'writeFile' })).toBe('writeFile');
    });
    it('extracts name', () => {
      expect(extractToolName({ name: 'search' })).toBe('search');
    });
    it('extracts function.name', () => {
      expect(extractToolName({ function: { name: 'replace' } })).toBe('replace');
    });
    it('falls back to unknown', () => {
      expect(extractToolName({})).toBe('unknown');
      expect(extractToolName(null)).toBe('unknown');
    });
  });

  describe('extractToolId', () => {
    it('extracts tool_id', () => {
      expect(extractToolId({ tool_id: 'abc' })).toBe('abc');
    });
    it('extracts toolId', () => {
      expect(extractToolId({ toolId: 'def' })).toBe('def');
    });
    it('extracts id', () => {
      expect(extractToolId({ id: 'ghi' })).toBe('ghi');
    });
    it('extracts call_id', () => {
      expect(extractToolId({ call_id: 'jkl' })).toBe('jkl');
    });
    it('generates fallback with timestamp', () => {
      expect(extractToolId({})).toMatch(/^unknown-\d+/);
    });
  });

  describe('extractParameters', () => {
    it('extracts parameters', () => {
      expect(extractParameters({ parameters: { a: 1 } })).toEqual({ a: 1 });
    });
    it('extracts params', () => {
      expect(extractParameters({ params: { b: 2 } })).toEqual({ b: 2 });
    });
    it('extracts args', () => {
      expect(extractParameters({ args: { c: 3 } })).toEqual({ c: 3 });
    });
    it('extracts input', () => {
      expect(extractParameters({ input: { d: 4 } })).toEqual({ d: 4 });
    });
    it('extracts payload', () => {
      expect(extractParameters({ payload: { e: 5 } })).toEqual({ e: 5 });
    });
    it('returns empty object for missing params', () => {
      expect(extractParameters({})).toEqual({});
    });
  });

  describe('extractResultOutput', () => {
    it('extracts output string', () => {
      expect(extractResultOutput({ output: 'hello' })).toBe('hello');
    });
    it('extracts result string', () => {
      expect(extractResultOutput({ result: 'world' })).toBe('world');
    });
    it('extracts content string', () => {
      expect(extractResultOutput({ content: 'foo' })).toBe('foo');
    });
    it('extracts summary string', () => {
      expect(extractResultOutput({ summary: 'visible update' })).toBe('visible update');
    });
    it('extracts result.output', () => {
      expect(extractResultOutput({ result: { output: 'bar' } })).toBe('bar');
    });
    it('stringifies result object', () => {
      expect(extractResultOutput({ result: { x: 1 } })).toBe('{"x":1}');
    });
    it('returns empty string for missing output', () => {
      expect(extractResultOutput({})).toBe('');
    });
  });

  describe('extractStatus', () => {
    it('returns error when error present', () => {
      expect(extractStatus({ error: 'fail' })).toBe('error');
    });
    it('returns error when status is error', () => {
      expect(extractStatus({ status: 'error' })).toBe('error');
    });
    it('returns warning when status is warning', () => {
      expect(extractStatus({ status: 'warning' })).toBe('warning');
    });
    it('returns success by default', () => {
      expect(extractStatus({})).toBe('success');
    });
  });

  describe('getToolCategory', () => {
    it('maps update_topic to task', () => {
      expect(getToolCategory('update_topic')).toBe('task');
    });
    it('maps invoke_agent and summary to task', () => {
      expect(getToolCategory('invoke_agent')).toBe('task');
      expect(getToolCategory('summary')).toBe('task');
    });
    it('maps Kimi thinking to task', () => {
      expect(getToolCategory('kimi_thinking')).toBe('task');
      expect(getToolDisplayName('kimi_thinking', {})).toBe('Kimi thinking');
    });
    it('maps read_file to read', () => {
      expect(getToolCategory('read_file')).toBe('read');
    });
    it('maps list_directory to read', () => {
      expect(getToolCategory('list_directory')).toBe('read');
    });
    it('maps replace to write', () => {
      expect(getToolCategory('replace')).toBe('write');
    });
    it('maps write_file to write', () => {
      expect(getToolCategory('write_file')).toBe('write');
    });
    it('maps write-like provider variants to write', () => {
      expect(getToolCategory('apply_patch')).toBe('write');
      expect(getToolCategory('Edit')).toBe('write');
      expect(getToolCategory('MultiEdit')).toBe('write');
      expect(getToolCategory('str_replace')).toBe('write');
      expect(getToolCategory('agentbench__write_file')).toBe('write');
    });
    it('maps create_file to write', () => {
      expect(getToolCategory('create_file')).toBe('write');
    });
    it('maps grep_search to search', () => {
      expect(getToolCategory('grep_search')).toBe('search');
    });
    it('maps run_shell_command to shell', () => {
      expect(getToolCategory('run_shell_command')).toBe('shell');
    });
    it('maps unknown to unknown', () => {
      expect(getToolCategory('magic')).toBe('unknown');
    });
  });

  describe('isWriteLikeToolName', () => {
    it('recognizes unqualified and MCP-qualified write tools', () => {
      expect(isWriteLikeToolName('apply_patch')).toBe(true);
      expect(isWriteLikeToolName('mcp__agentbench__replace')).toBe(true);
      expect(isWriteLikeToolName('agentbench__write_file')).toBe(true);
      expect(isWriteLikeToolName('run_shell_command')).toBe(false);
    });
  });

  describe('getToolDisplayName', () => {
    it('shows task title', () => {
      expect(getToolDisplayName('update_topic', { title: 'Planning' })).toBe('Planning');
    });
    it('shows delegated task title', () => {
      expect(getToolDisplayName('invoke_agent', { title: 'Metal harness' })).toBe('Metal harness');
    });
    it('shows Read file with path', () => {
      expect(getToolDisplayName('read_file', { file_path: 'README.md' })).toBe('Read README.md');
    });
    it('shows Edited file for replace', () => {
      expect(getToolDisplayName('replace', { file_path: 'README.md' })).toBe('Edited README.md');
    });
    it('shows Created file for create_file', () => {
      expect(getToolDisplayName('create_file', { file_path: 'test.swift' })).toBe('Created test.swift');
    });
    it('shows Wrote file for write_file', () => {
      expect(getToolDisplayName('write_file', { file_path: 'out.txt' })).toBe('Wrote out.txt');
    });
    it('shows Searched project', () => {
      expect(getToolDisplayName('grep_search', {})).toBe('Searched project');
    });
    it('shows Shell command', () => {
      expect(getToolDisplayName('run_shell_command', {})).toBe('Shell command');
    });
    it('shows Used <toolName> for unknown', () => {
      expect(getToolDisplayName('magic_tool', {})).toBe('Used magic_tool');
    });
    it('shows Used unknown when no name', () => {
      expect(getToolDisplayName('', {})).toBe('Used unknown');
    });
  });

  describe('estimateLineChanges', () => {
    it('estimates from old_string/new_string', () => {
      const result = estimateLineChanges({ old_string: 'a\nb', new_string: 'c\nd\ne' });
      expect(result.additions).toBe(3);
      expect(result.deletions).toBe(2);
    });
    it('returns empty object for missing params', () => {
      expect(estimateLineChanges({})).toEqual({});
    });
  });

  describe('createToolActivity', () => {
    it('creates a running activity with correct fields', () => {
      const activity = createToolActivity({
        type: 'tool_use',
        tool_name: 'read_file',
        tool_id: 't1',
        parameters: { file_path: 'README.md' },
      });
      expect(activity.id).toBe('t1');
      expect(activity.toolName).toBe('read_file');
      expect(activity.displayName).toBe('Read README.md');
      expect(activity.category).toBe('read');
      expect(activity.status).toBe('running');
      expect(activity.parameters).toEqual({ file_path: 'README.md' });
      expect(activity.filePath).toBe('README.md');
      expect(activity.rawUseEvent).toBeDefined();
    });
  });

  describe('pairToolResult', () => {
    it('pairs result with use and updates status', () => {
      const use = createToolActivity({
        type: 'tool_use',
        tool_name: 'read_file',
        tool_id: 't1',
        parameters: { file_path: 'README.md' },
      });
      use.startedAt = new Date(Date.now() - 100).toISOString();
      const result = pairToolResult(use, {
        type: 'tool_result',
        tool_id: 't1',
        output: 'file content here',
      });
      expect(result.status).toBe('success');
      expect(result.resultSummary).toBe('file content here');
      expect(result.endedAt).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
    it('truncates long output', () => {
      const use = createToolActivity({ type: 'tool_use', tool_name: 'x', tool_id: 't1' });
      const longOutput = 'a'.repeat(600);
      const result = pairToolResult(use, { output: longOutput });
      expect(result.resultSummary).toMatch(/\.\.\.$/);
      expect(result.resultSummary!.length).toBeLessThanOrEqual(503);
    });
  });

  describe('diff telemetry', () => {
    it('extracts exact stats from Codex changes first', () => {
      const summary = deriveToolDiffSummary('edit_file', {
        changes: [
          { path: 'src/App.tsx', kind: 'modify', additions: 12, deletions: 3 },
          { path: 'src/main.css', kind: 'modify', added: 4, deleted: 1 }
        ],
        patchPreview: 'not a unified diff'
      });

      expect(summary?.source).toBe('codex_changes');
      expect(summary?.confidence).toBe('exact');
      expect(summary?.additions).toBe(16);
      expect(summary?.deletions).toBe(4);
      expect(summary?.files).toHaveLength(2);
    });

    it('parses unified diffs when changes do not carry stats', () => {
      const summary = parseUnifiedDiffSummary([
        'diff --git a/a.ts b/a.ts',
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -1,2 +1,3 @@',
        ' line',
        '-old',
        '+new',
        '+next'
      ].join('\n'));

      expect(summary?.source).toBe('patch_preview');
      expect(summary?.additions).toBe(2);
      expect(summary?.deletions).toBe(1);
      expect(summary?.files?.[0].path).toBe('a.ts');
    });

    it('uses the parameter path when patch-like output has hunks but no file header', () => {
      const summary = deriveToolDiffSummary('edit_file', {
        path: 'Sources/Game.swift',
        patchPreview: [
          '@@ -1,2 +1,3 @@',
          ' context',
          '-old',
          '+new',
          '+next'
        ].join('\n')
      });

      expect(summary?.additions).toBe(2);
      expect(summary?.deletions).toBe(1);
      expect(summary?.files?.[0].path).toBe('Sources/Game.swift');
    });

    it('falls back to estimated replace/content stats and tolerates old activities', () => {
      expect(deriveToolDiffSummary('replace', { path: 'a.ts', old_string: 'a\nb', new_string: 'a\nb\nc' })?.confidence).toBe('estimated');
      expect(deriveToolDiffSummary('run_shell_command', { command: 'sed -i s/a/b/g a.ts' })).toBeUndefined();
    });
  });

  describe('isToolUseEvent / isToolResultEvent', () => {
    it('detects tool_use', () => {
      expect(isToolUseEvent({ type: 'tool_use' })).toBe(true);
      expect(isToolUseEvent({ type: 'tool_call' })).toBe(true);
      expect(isToolUseEvent({ type: 'other' })).toBe(false);
    });
    it('detects tool_result', () => {
      expect(isToolResultEvent({ type: 'tool_result' })).toBe(true);
      expect(isToolResultEvent({ type: 'tool_output' })).toBe(true);
      expect(isToolResultEvent({ type: 'other' })).toBe(false);
    });
  });
});
