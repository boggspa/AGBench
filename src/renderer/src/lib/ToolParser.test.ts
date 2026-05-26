import { describe, it, expect } from 'vitest'
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
  unwrapMcpEnvelope,
  prettyPrintJson
} from './ToolParser'

describe('ToolParser', () => {
  describe('extractToolName', () => {
    it('extracts tool_name', () => {
      expect(extractToolName({ tool_name: 'read_file' })).toBe('read_file')
    })
    it('extracts toolName', () => {
      expect(extractToolName({ toolName: 'writeFile' })).toBe('writeFile')
    })
    it('extracts name', () => {
      expect(extractToolName({ name: 'search' })).toBe('search')
    })
    it('extracts function.name', () => {
      expect(extractToolName({ function: { name: 'replace' } })).toBe('replace')
    })
    it('falls back to unknown', () => {
      expect(extractToolName({})).toBe('unknown')
      expect(extractToolName(null)).toBe('unknown')
    })
  })

  describe('extractToolId', () => {
    it('extracts tool_id', () => {
      expect(extractToolId({ tool_id: 'abc' })).toBe('abc')
    })
    it('extracts toolId', () => {
      expect(extractToolId({ toolId: 'def' })).toBe('def')
    })
    it('extracts id', () => {
      expect(extractToolId({ id: 'ghi' })).toBe('ghi')
    })
    it('extracts call_id', () => {
      expect(extractToolId({ call_id: 'jkl' })).toBe('jkl')
    })
    it('generates fallback with timestamp', () => {
      expect(extractToolId({})).toMatch(/^unknown-\d+/)
    })
  })

  describe('extractParameters', () => {
    it('extracts parameters', () => {
      expect(extractParameters({ parameters: { a: 1 } })).toEqual({ a: 1 })
    })
    it('extracts params', () => {
      expect(extractParameters({ params: { b: 2 } })).toEqual({ b: 2 })
    })
    it('extracts args', () => {
      expect(extractParameters({ args: { c: 3 } })).toEqual({ c: 3 })
    })
    it('extracts input', () => {
      expect(extractParameters({ input: { d: 4 } })).toEqual({ d: 4 })
    })
    it('extracts payload', () => {
      expect(extractParameters({ payload: { e: 5 } })).toEqual({ e: 5 })
    })
    it('returns empty object for missing params', () => {
      expect(extractParameters({})).toEqual({})
    })
  })

  describe('extractResultOutput', () => {
    it('extracts output string', () => {
      expect(extractResultOutput({ output: 'hello' })).toBe('hello')
    })
    it('extracts result string', () => {
      expect(extractResultOutput({ result: 'world' })).toBe('world')
    })
    it('extracts content string', () => {
      expect(extractResultOutput({ content: 'foo' })).toBe('foo')
    })
    it('extracts summary string', () => {
      expect(extractResultOutput({ summary: 'visible update' })).toBe('visible update')
    })
    it('extracts result.output', () => {
      expect(extractResultOutput({ result: { output: 'bar' } })).toBe('bar')
    })
    it('stringifies result object', () => {
      expect(extractResultOutput({ result: { x: 1 } })).toBe('{"x":1}')
    })
    it('returns empty string for missing output', () => {
      expect(extractResultOutput({})).toBe('')
    })
  })

  describe('extractStatus', () => {
    it('returns error when error present', () => {
      expect(extractStatus({ error: 'fail' })).toBe('error')
    })
    it('returns error when status is error', () => {
      expect(extractStatus({ status: 'error' })).toBe('error')
    })
    it('returns warning when status is warning', () => {
      expect(extractStatus({ status: 'warning' })).toBe('warning')
    })
    it('returns success by default', () => {
      expect(extractStatus({})).toBe('success')
    })
  })

  describe('getToolCategory', () => {
    it('maps update_topic to task', () => {
      expect(getToolCategory('update_topic')).toBe('task')
    })
    it('maps invoke_agent and summary to task', () => {
      expect(getToolCategory('invoke_agent')).toBe('task')
      expect(getToolCategory('summary')).toBe('task')
    })
    it('maps Kimi thinking to task', () => {
      expect(getToolCategory('kimi_thinking')).toBe('task')
      expect(getToolDisplayName('kimi_thinking', {})).toBe('Kimi thinking')
    })
    it('maps read_file to read', () => {
      expect(getToolCategory('read_file')).toBe('read')
    })
    it('maps list_directory to read', () => {
      expect(getToolCategory('list_directory')).toBe('read')
    })
    it('maps replace to write', () => {
      expect(getToolCategory('replace')).toBe('write')
    })
    it('maps write_file to write', () => {
      expect(getToolCategory('write_file')).toBe('write')
    })
    it('maps write-like provider variants to write', () => {
      expect(getToolCategory('apply_patch')).toBe('write')
      expect(getToolCategory('Edit')).toBe('write')
      expect(getToolCategory('MultiEdit')).toBe('write')
      expect(getToolCategory('str_replace')).toBe('write')
      expect(getToolCategory('AGBench__write_file')).toBe('write')
    })
    it('maps create_file to write', () => {
      expect(getToolCategory('create_file')).toBe('write')
    })
    it('maps grep_search to search', () => {
      expect(getToolCategory('grep_search')).toBe('search')
    })
    it('maps run_shell_command to shell', () => {
      expect(getToolCategory('run_shell_command')).toBe('shell')
    })
    it('maps unknown to unknown', () => {
      expect(getToolCategory('magic')).toBe('unknown')
    })
    // 1.0.4-AA — Kimi + some MCP wrappers strip underscores
    // from tool names. These no-separator variants used to fall
    // through to 'unknown' and render as "Used readfile" / no icon.
    it('maps no-separator readfile to read', () => {
      expect(getToolCategory('readfile')).toBe('read')
      expect(getToolCategory('ReadFile')).toBe('read')
    })
    it('maps no-separator listdirectory + list_dir variants to read', () => {
      expect(getToolCategory('listdirectory')).toBe('read')
      expect(getToolCategory('list_dir')).toBe('read')
      expect(getToolCategory('listdir')).toBe('read')
    })
    it('maps no-separator writefile + variants to write', () => {
      expect(getToolCategory('writefile')).toBe('write')
      expect(getToolCategory('editfile')).toBe('write')
      expect(getToolCategory('createfile')).toBe('write')
      expect(getToolCategory('deletefile')).toBe('write')
      expect(getToolCategory('applypatch')).toBe('write')
      expect(getToolCategory('strreplace')).toBe('write')
    })
    it('maps exit_plan_mode + exitplanmode variants to task', () => {
      expect(getToolCategory('exit_plan_mode')).toBe('task')
      expect(getToolCategory('exitplanmode')).toBe('task')
      expect(getToolCategory('ExitPlanMode')).toBe('task')
    })
    it('maps ask_user_question + askuserquestion to task', () => {
      expect(getToolCategory('ask_user_question')).toBe('task')
      expect(getToolCategory('askuserquestion')).toBe('task')
    })
  })

  describe('isWriteLikeToolName', () => {
    it('recognizes unqualified and MCP-qualified write tools', () => {
      expect(isWriteLikeToolName('apply_patch')).toBe(true)
      expect(isWriteLikeToolName('mcp__AGBench__replace')).toBe(true)
      expect(isWriteLikeToolName('AGBench__write_file')).toBe(true)
      expect(isWriteLikeToolName('run_shell_command')).toBe(false)
    })
  })

  describe('getToolDisplayName', () => {
    it('shows task title', () => {
      expect(getToolDisplayName('update_topic', { title: 'Planning' })).toBe(
        'Topic update: Planning'
      )
    })
    it('humanises ensemble yield tools through MCP namespace variants', () => {
      expect(getToolDisplayName('mcp_AGBench_ensemble_yield', { target: 'Reviewer' })).toBe(
        'Yielding to Reviewer'
      )
      expect(getToolDisplayName('mcp__AGBench__ensemble_yield', {})).toBe('Yielding')
    })
    it('shows delegated task title', () => {
      expect(getToolDisplayName('invoke_agent', { title: 'Metal harness' })).toBe('Metal harness')
    })
    it('shows Read file with path', () => {
      expect(getToolDisplayName('read_file', { file_path: 'README.md' })).toBe('Read README.md')
    })
    it('shows Edited file for replace', () => {
      expect(getToolDisplayName('replace', { file_path: 'README.md' })).toBe('Edited README.md')
    })
    it('shows Created file for create_file', () => {
      expect(getToolDisplayName('create_file', { file_path: 'test.swift' })).toBe(
        'Created test.swift'
      )
    })
    it('shows Wrote file for write_file', () => {
      expect(getToolDisplayName('write_file', { file_path: 'out.txt' })).toBe('Wrote out.txt')
    })
    // 1.0.4-AA — the new no-separator variants need to surface
    // the same friendly verb + path label as their snake_case
    // canonicals.
    it('shows Read for no-separator readfile', () => {
      expect(getToolDisplayName('readfile', { file_path: 'lib.ts' })).toBe('Read lib.ts')
    })
    it('shows Listed for no-separator listdirectory + list_dir', () => {
      expect(getToolDisplayName('listdirectory', { path: 'src' })).toBe('Listed src')
      expect(getToolDisplayName('list_dir', { path: 'src' })).toBe('Listed src')
    })
    it('shows Wrote for no-separator writefile', () => {
      expect(getToolDisplayName('writefile', { file_path: 'out.txt' })).toBe('Wrote out.txt')
    })
    it('shows Edited for no-separator editfile + applypatch + strreplace', () => {
      expect(getToolDisplayName('editfile', { file_path: 'a.ts' })).toBe('Edited a.ts')
      expect(getToolDisplayName('applypatch', { file_path: 'a.ts' })).toBe('Edited a.ts')
      expect(getToolDisplayName('strreplace', { file_path: 'a.ts' })).toBe('Edited a.ts')
    })
    it('shows Created for no-separator createfile', () => {
      expect(getToolDisplayName('createfile', { file_path: 'new.ts' })).toBe('Created new.ts')
    })
    it('shows Deleted for no-separator deletefile', () => {
      expect(getToolDisplayName('deletefile', { file_path: 'old.ts' })).toBe('Deleted old.ts')
    })
    it('shows Exited plan mode for exit_plan_mode + exitplanmode', () => {
      expect(getToolDisplayName('exit_plan_mode', {})).toBe('Exited plan mode')
      expect(getToolDisplayName('exitplanmode', {})).toBe('Exited plan mode')
      expect(getToolDisplayName('ExitPlanMode', {})).toBe('Exited plan mode')
    })
    it('shows Asked user for ask_user_question variants', () => {
      expect(getToolDisplayName('ask_user_question', {})).toBe('Asked user')
      expect(getToolDisplayName('askuserquestion', {})).toBe('Asked user')
    })
    it('shows Searched project', () => {
      expect(getToolDisplayName('grep_search', {})).toBe('Searched project')
    })
    it('shows Shell command', () => {
      expect(getToolDisplayName('run_shell_command', {})).toBe('Shell command')
    })
    it('shows creative tool names instead of raw identifiers', () => {
      expect(getToolDisplayName('creative_app_status', {})).toBe('Creative app status')
      expect(getToolDisplayName('AGBench__creative_app_capabilities', {})).toBe(
        'Creative app capabilities'
      )
      expect(
        getToolDisplayName('mcp__AGBench__creative_project_snapshot', { path: 'edit.fcpxml' })
      ).toBe('Creative project snapshot edit.fcpxml')
      expect(getToolDisplayName('creative_timeline_validate', { path: 'edit.fcpxml' })).toBe(
        'Validate timeline edit.fcpxml'
      )
      expect(getToolDisplayName('creative_timeline_ir', { path: 'edit.fcpxml' })).toBe(
        'Timeline IR edit.fcpxml'
      )
      expect(
        getToolDisplayName('creative_timeline_diff', {
          beforePath: 'original.fcpxml',
          afterPath: 'draft.fcpxml'
        })
      ).toBe('Timeline diff original.fcpxml -> draft.fcpxml')
    })
    it('humanises snake_case tool names through the title-case fallback', () => {
      expect(getToolDisplayName('magic_tool', {})).toBe('Used Magic Tool')
    })
    it('shows Used unknown when no name', () => {
      expect(getToolDisplayName('', {})).toBe('Used unknown')
    })
    it('uses the ToolDisplayNames dictionary for delegate_to_subthread', () => {
      expect(getToolDisplayName('delegate_to_subthread', {})).toBe('Delegated to sub-thread')
    })
    it('uses the dictionary through provider namespace prefixes', () => {
      expect(getToolDisplayName('mcp__AGBench__delegate_to_subthread', {})).toBe(
        'Delegated to sub-thread'
      )
      expect(getToolDisplayName('agbench__attached_window_capture', {})).toBe(
        'Captured attached window'
      )
    })
    it('uses the dictionary for editor / IDE transport tools', () => {
      expect(getToolDisplayName('reveal_in_finder', {})).toBe('Revealed in Finder')
      expect(getToolDisplayName('open_in_ide_at_position', {})).toBe('Opened in IDE at position')
    })
    it('uses the dictionary for AppWatch and browser monitoring tools', () => {
      expect(getToolDisplayName('appwatch_latest_frame', {})).toBe('Latest AppWatch frame')
      expect(getToolDisplayName('appwatch_frames', {})).toBe('AppWatch frames')
      expect(getToolDisplayName('browser_navigate', {})).toBe('Navigated browser')
      expect(getToolDisplayName('mcp__AGBench__browser_snapshot', {})).toBe('Browser snapshot')
    })
    it('uses the dictionary for handoff and collaboration fallbacks', () => {
      expect(getToolDisplayName('get_handoff_cards', {})).toBe('Handoff cards')
      expect(getToolDisplayName('collabToolCall', {})).toBe('Collaboration tool call')
    })
  })

  describe('estimateLineChanges', () => {
    it('estimates from old_string/new_string', () => {
      const result = estimateLineChanges({ old_string: 'a\nb', new_string: 'c\nd\ne' })
      expect(result.additions).toBe(3)
      expect(result.deletions).toBe(2)
    })
    it('returns empty object for missing params', () => {
      expect(estimateLineChanges({})).toEqual({})
    })
  })

  describe('createToolActivity', () => {
    it('creates a running activity with correct fields', () => {
      const activity = createToolActivity({
        type: 'tool_use',
        tool_name: 'read_file',
        tool_id: 't1',
        parameters: { file_path: 'README.md' }
      })
      expect(activity.id).toBe('t1')
      expect(activity.toolName).toBe('read_file')
      expect(activity.displayName).toBe('Read README.md')
      expect(activity.category).toBe('read')
      expect(activity.status).toBe('running')
      expect(activity.parameters).toEqual({ file_path: 'README.md' })
      expect(activity.filePath).toBe('README.md')
      expect(activity.rawUseEvent).toBeDefined()
    })
  })

  describe('pairToolResult', () => {
    it('pairs result with use and updates status', () => {
      const use = createToolActivity({
        type: 'tool_use',
        tool_name: 'read_file',
        tool_id: 't1',
        parameters: { file_path: 'README.md' }
      })
      use.startedAt = new Date(Date.now() - 100).toISOString()
      const result = pairToolResult(use, {
        type: 'tool_result',
        tool_id: 't1',
        output: 'file content here'
      })
      expect(result.status).toBe('success')
      expect(result.resultSummary).toBe('file content here')
      expect(result.endedAt).toBeDefined()
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })
    it('truncates long output', () => {
      const use = createToolActivity({ type: 'tool_use', tool_name: 'x', tool_id: 't1' })
      const longOutput = 'a'.repeat(600)
      const result = pairToolResult(use, { output: longOutput })
      expect(result.resultSummary).toMatch(/\.\.\.$/)
      expect(result.resultSummary!.length).toBeLessThanOrEqual(503)
    })
  })

  describe('diff telemetry', () => {
    it('extracts exact stats from Codex changes first', () => {
      const summary = deriveToolDiffSummary('edit_file', {
        changes: [
          { path: 'src/App.tsx', kind: 'modify', additions: 12, deletions: 3 },
          { path: 'src/main.css', kind: 'modify', added: 4, deleted: 1 }
        ],
        patchPreview: 'not a unified diff'
      })

      expect(summary?.source).toBe('codex_changes')
      expect(summary?.confidence).toBe('exact')
      expect(summary?.additions).toBe(16)
      expect(summary?.deletions).toBe(4)
      expect(summary?.files).toHaveLength(2)
    })

    it('parses unified diffs when changes do not carry stats', () => {
      const summary = parseUnifiedDiffSummary(
        [
          'diff --git a/a.ts b/a.ts',
          '--- a/a.ts',
          '+++ b/a.ts',
          '@@ -1,2 +1,3 @@',
          ' line',
          '-old',
          '+new',
          '+next'
        ].join('\n')
      )

      expect(summary?.source).toBe('patch_preview')
      expect(summary?.additions).toBe(2)
      expect(summary?.deletions).toBe(1)
      expect(summary?.files?.[0].path).toBe('a.ts')
    })

    it('uses the parameter path when patch-like output has hunks but no file header', () => {
      const summary = deriveToolDiffSummary('edit_file', {
        path: 'Sources/Game.swift',
        patchPreview: ['@@ -1,2 +1,3 @@', ' context', '-old', '+new', '+next'].join('\n')
      })

      expect(summary?.additions).toBe(2)
      expect(summary?.deletions).toBe(1)
      expect(summary?.files?.[0].path).toBe('Sources/Game.swift')
    })

    it('falls back to estimated replace/content stats and tolerates old activities', () => {
      expect(
        deriveToolDiffSummary('replace', {
          path: 'a.ts',
          old_string: 'a\nb',
          new_string: 'a\nb\nc'
        })?.confidence
      ).toBe('estimated')
      expect(
        deriveToolDiffSummary('run_shell_command', { command: 'sed -i s/a/b/g a.ts' })
      ).toBeUndefined()
    })
  })

  describe('unwrapMcpEnvelope', () => {
    it('returns the empty / non-string input untouched (no-op)', () => {
      expect(unwrapMcpEnvelope('')).toBe('')
      expect(unwrapMcpEnvelope(null)).toBe('')
      expect(unwrapMcpEnvelope(undefined)).toBe('')
    })

    it('passes through plain (non-JSON) strings', () => {
      expect(unwrapMcpEnvelope('Exit code: 0\nstdout: hello')).toBe('Exit code: 0\nstdout: hello')
      expect(unwrapMcpEnvelope('  not JSON either  ')).toBe('  not JSON either  ')
    })

    it('unwraps a single-text MCP envelope', () => {
      const envelope =
        '{"content":[{"type":"text","text":"Exit code: 0\\nstdout:\\ntotal 22552\\n"}]}'
      expect(unwrapMcpEnvelope(envelope)).toBe('Exit code: 0\nstdout:\ntotal 22552\n')
    })

    it('concatenates multiple text parts in order', () => {
      const envelope = JSON.stringify({
        content: [
          { type: 'text', text: 'first chunk\n' },
          { type: 'text', text: 'second chunk' }
        ]
      })
      expect(unwrapMcpEnvelope(envelope)).toBe('first chunk\nsecond chunk')
    })

    it('skips non-text parts (image / resource_link) but keeps text', () => {
      const envelope = JSON.stringify({
        content: [
          { type: 'text', text: 'hello\n' },
          { type: 'image', data: '<base64>', mimeType: 'image/png' },
          { type: 'text', text: 'world' }
        ]
      })
      expect(unwrapMcpEnvelope(envelope)).toBe('hello\nworld')
    })

    it('passes through valid JSON that is not an MCP envelope', () => {
      const json = '{"status":"ok","count":42}'
      expect(unwrapMcpEnvelope(json)).toBe(json)
    })

    it('passes through malformed JSON without throwing', () => {
      const broken = '{"content":[{"type":"text"'
      expect(unwrapMcpEnvelope(broken)).toBe(broken)
    })

    it('passes through arrays at top level (not envelope-shaped)', () => {
      const arr = '[{"type":"text","text":"loose"}]'
      expect(unwrapMcpEnvelope(arr)).toBe(arr)
    })
  })

  describe('prettyPrintJson', () => {
    it('returns empty / non-string input untouched', () => {
      expect(prettyPrintJson('')).toBe('')
      expect(prettyPrintJson(null)).toBe('')
      expect(prettyPrintJson(undefined)).toBe('')
    })

    it('passes through plain non-JSON strings', () => {
      expect(prettyPrintJson('hello world')).toBe('hello world')
      expect(prettyPrintJson('Exit code: 0')).toBe('Exit code: 0')
    })

    it('pretty-prints one-liner JSON objects with 2-space indent', () => {
      const out = prettyPrintJson('{"a":1,"b":[2,3]}')
      expect(out).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}')
    })

    it('leaves already-pretty JSON untouched', () => {
      const pretty = '{\n  "a": 1\n}'
      expect(prettyPrintJson(pretty)).toBe(pretty)
    })

    it('passes through malformed JSON gracefully', () => {
      expect(prettyPrintJson('{"a":')).toBe('{"a":')
    })
  })

  describe('extractResultOutput — Phase L5 MCP envelope integration', () => {
    it('unwraps an MCP envelope passed as evt.result (object form)', () => {
      const out = extractResultOutput({
        result: { content: [{ type: 'text', text: 'unwrapped from result' }] }
      })
      expect(out).toBe('unwrapped from result')
    })

    it('unwraps an MCP envelope passed as evt.output (object form)', () => {
      const out = extractResultOutput({
        output: { content: [{ type: 'text', text: 'unwrapped from output' }] }
      })
      expect(out).toBe('unwrapped from output')
    })

    it('unwraps when the whole event IS the envelope', () => {
      const out = extractResultOutput({
        content: [{ type: 'text', text: 'whole event is the envelope' }]
      })
      expect(out).toBe('whole event is the envelope')
    })

    it('unwraps an MCP envelope passed as a stringified evt.output', () => {
      const out = extractResultOutput({
        output: '{"content":[{"type":"text","text":"stringified envelope"}]}'
      })
      expect(out).toBe('stringified envelope')
    })

    it('passes plain string output through unchanged (no false-positive unwrap)', () => {
      expect(extractResultOutput({ output: 'plain stdout' })).toBe('plain stdout')
    })
  })

  describe('isToolUseEvent / isToolResultEvent', () => {
    it('detects tool_use', () => {
      expect(isToolUseEvent({ type: 'tool_use' })).toBe(true)
      expect(isToolUseEvent({ type: 'tool_call' })).toBe(true)
      expect(isToolUseEvent({ type: 'other' })).toBe(false)
    })
    it('detects tool_result', () => {
      expect(isToolResultEvent({ type: 'tool_result' })).toBe(true)
      expect(isToolResultEvent({ type: 'tool_output' })).toBe(true)
      expect(isToolResultEvent({ type: 'other' })).toBe(false)
    })
  })
})
