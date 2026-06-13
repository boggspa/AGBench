import { describe, it, expect } from 'vitest'
import { computeInlineStats, inlineStatsForActivity } from './ActivityInlineStats'
import type { ToolActivity } from '../../../main/store/types'

describe('ActivityInlineStats', () => {
  describe('computeInlineStats', () => {
    it('renders the inline odometer when diffSummary carries real stats', () => {
      // The canonical happy path: a finished edit reports +46 / -23 — the
      // Codex-style per-row pill the user is asking us to pin.
      const result = computeInlineStats({
        toolName: 'edit_file',
        status: 'success',
        parameters: { path: 'BridgeToolActivityViews.swift' },
        diffSummary: {
          additions: 46,
          deletions: 23,
          source: 'codex_changes',
          confidence: 'exact'
        }
      })

      expect(result.visible).toBe(true)
      expect(result.additions).toBe(46)
      expect(result.deletions).toBe(23)
      expect(result.confidence).toBe('exact')
    })

    it('renders no odometer when there is no diff summary nor inferable stats', () => {
      // Search-only or shell-only tool calls have nothing to count — the
      // helper must stay silent so we don't paint a misleading +0 -0.
      const result = computeInlineStats({
        toolName: 'run_shell_command',
        status: 'success',
        parameters: { command: 'echo hi' }
      })

      expect(result.visible).toBe(false)
    })

    it('suppresses the odometer for running activities with no concrete stats', () => {
      // Pending edits would otherwise show `+0 -0` while waiting for the
      // result event — that reads as "no change" even though we mean "still
      // running". Suppress it.
      const result = computeInlineStats({
        toolName: 'edit_file',
        status: 'running',
        parameters: { path: 'foo.ts' }
      })

      expect(result.visible).toBe(false)
    })

    it('shows estimated stats for a running edit when the parameters carry old/new strings', () => {
      // Once the tool_use event has shipped the inputs, we can estimate the
      // line delta from `old_string` / `new_string` even before the result
      // lands — surface it (estimated) rather than waiting in silence.
      const result = computeInlineStats({
        toolName: 'replace',
        status: 'running',
        parameters: {
          path: 'foo.ts',
          old_string: 'one\ntwo\nthree',
          new_string: 'alpha\nbeta'
        }
      })

      expect(result.visible).toBe(true)
      expect(result.additions).toBe(2)
      expect(result.deletions).toBe(3)
    })

    it('handles Claude MultiEdit edits[] arrays that estimateLineChanges ignores', () => {
      // MultiEdit packs many edits into one tool call — historically the
      // odometer was blank here. Sum across the array so the per-row stats
      // appear uniformly.
      const result = computeInlineStats({
        toolName: 'MultiEdit',
        status: 'success',
        parameters: {
          file_path: 'foo.ts',
          edits: [
            { old_string: 'a\nb', new_string: 'a\nb\nc' },
            { old_string: 'x', new_string: 'y\nz' }
          ]
        }
      })

      expect(result.visible).toBe(true)
      expect(result.additions).toBe(3 + 2)
      expect(result.deletions).toBe(2 + 1)
    })

    it('treats Claude Write content as +N -0 additions', () => {
      // Write is a wholesale file write — Claude does not emit old_string,
      // so we estimate additions from the content payload alone.
      const result = computeInlineStats({
        toolName: 'Write',
        status: 'success',
        parameters: {
          file_path: 'foo.ts',
          content: 'line one\nline two\nline three'
        }
      })

      expect(result.visible).toBe(true)
      expect(result.additions).toBe(3)
      expect(result.deletions).toBe(0)
    })

    it('forwards `~` estimated confidence so the row can surface the marker', () => {
      const result = computeInlineStats({
        toolName: 'replace',
        status: 'success',
        parameters: { old_string: 'a', new_string: 'b' },
        diffSummary: {
          additions: 1,
          deletions: 1,
          source: 'string_replace',
          confidence: 'estimated'
        }
      })

      expect(result.confidence).toBe('estimated')
    })

    it('suppresses all-zero diff summaries for completed edit rows', () => {
      // Some edit/write emitters report a completed file call with exact
      // 0/0 counts when they have no hunk stats. That should not paint a
      // misleading "+0 -0" odometer next to the tool title.
      const result = computeInlineStats({
        toolName: 'edit_file',
        status: 'success',
        parameters: {},
        diffSummary: {
          additions: 0,
          deletions: 0,
          source: 'codex_changes',
          confidence: 'exact'
        }
      })

      expect(result.visible).toBe(false)
      expect(result.additions).toBe(0)
      expect(result.deletions).toBe(0)
    })

    it('suppresses the odometer for a denied/errored edit even with a full diff summary', () => {
      // Read-only seat auto-denies `search_replace`; the tool_result is an
      // error. The attempted +6/−4 still rides on the activity, but a denied
      // edit changed nothing — never paint the pill.
      const result = computeInlineStats({
        toolName: 'search_replace',
        status: 'error',
        parameters: { old_string: 'a\nb\nc\nd', new_string: 'a\nB\nc\nd\ne\nf' },
        diffSummary: {
          additions: 6,
          deletions: 4,
          source: 'string_replace',
          confidence: 'estimated'
        },
        resultText: 'User rejected the execution for tool search_replace'
      })

      expect(result.visible).toBe(false)
    })
  })

  describe('inlineStatsForActivity', () => {
    it('reads diffSummary, parameters, and status off a ToolActivity record', () => {
      const activity: ToolActivity = {
        id: 't1',
        toolName: 'edit_file',
        displayName: 'Edited foo.ts',
        category: 'write',
        status: 'success',
        parameters: { path: 'foo.ts' },
        diffSummary: {
          additions: 12,
          deletions: 5,
          source: 'codex_changes',
          confidence: 'exact'
        }
      }
      const result = inlineStatsForActivity(activity)
      expect(result.visible).toBe(true)
      expect(result.additions).toBe(12)
      expect(result.deletions).toBe(5)
    })

    it('returns invisible for a running activity with no parameters yet', () => {
      const activity: ToolActivity = {
        id: 't1',
        toolName: 'Edit',
        displayName: 'Editing…',
        category: 'unknown',
        status: 'running'
      }
      expect(inlineStatsForActivity(activity).visible).toBe(false)
    })

    it('returns invisible for a denied edit activity (status error)', () => {
      const activity: ToolActivity = {
        id: 't1',
        toolName: 'search_replace',
        displayName: 'Wrote README.md',
        category: 'write',
        status: 'error',
        parameters: { file_path: 'README.md', old_string: 'a', new_string: 'a\nb' },
        diffSummary: {
          additions: 6,
          deletions: 4,
          source: 'string_replace',
          confidence: 'estimated'
        },
        resultSummary: 'User rejected the execution for tool search_replace'
      }
      expect(inlineStatsForActivity(activity).visible).toBe(false)
    })

    it('returns invisible for a successful Edit File activity with +0/-0 stats', () => {
      const activity: ToolActivity = {
        id: 't1',
        toolName: 'edit_file',
        displayName: 'Edited codex-p1-delete-me.txt',
        category: 'write',
        status: 'success',
        parameters: { path: 'codex-p1-delete-me.txt' },
        diffSummary: {
          additions: 0,
          deletions: 0,
          files: [
            {
              path: 'codex-p1-delete-me.txt',
              status: 'modified',
              additions: 0,
              deletions: 0
            }
          ],
          source: 'codex_changes',
          confidence: 'exact'
        }
      }
      expect(inlineStatsForActivity(activity).visible).toBe(false)
    })
  })
})
