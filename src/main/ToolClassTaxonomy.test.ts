import { describe, expect, it } from 'vitest'
import {
  classifyTool,
  groupToolsByClass,
  TOOL_CLASS_LABELS,
  TOOL_CLASS_ORDER
} from './ToolClassTaxonomy'
import { READ_ONLY_TOOL_PRESET } from './PermissionEnvelope'
import { MCP_AUTO_ALLOWED_TOOLS } from './mcp/McpAutoAllowedTools'

describe('classifyTool', () => {
  it('classifies each non-write class', () => {
    expect(classifyTool('read_file')).toBe('workspace_read')
    expect(classifyTool('grep')).toBe('workspace_read')
    expect(classifyTool('ask_user_question')).toBe('ui_elicitation')
    expect(classifyTool('ensemble_yield')).toBe('orchestration')
    expect(classifyTool('provider_usage_status')).toBe('orchestration')
  })

  it('defaults unknown / mutating tools to workspace_write', () => {
    expect(classifyTool('write_file')).toBe('workspace_write')
    expect(classifyTool('apply_patch')).toBe('workspace_write')
    expect(classifyTool('run_shell_command')).toBe('workspace_write')
    expect(classifyTool('something_brand_new')).toBe('workspace_write')
  })
})

describe('tool-class safety invariant', () => {
  it('classifies every read-only preset tool as non-write', () => {
    for (const tool of READ_ONLY_TOOL_PRESET) {
      expect(classifyTool(tool)).not.toBe('workspace_write')
    }
  })

  it('classifies every auto-allowed (gate-skipping) tool as non-write', () => {
    for (const tool of MCP_AUTO_ALLOWED_TOOLS) {
      expect(classifyTool(tool)).not.toBe('workspace_write')
    }
  })
})

describe('groupToolsByClass', () => {
  it('groups names into every class key', () => {
    const grouped = groupToolsByClass([
      'read_file',
      'ask_user_question',
      'ensemble_yield',
      'write_file'
    ])
    expect(grouped.workspace_read).toEqual(['read_file'])
    expect(grouped.ui_elicitation).toEqual(['ask_user_question'])
    expect(grouped.orchestration).toEqual(['ensemble_yield'])
    expect(grouped.workspace_write).toEqual(['write_file'])
  })

  it('keeps labels + order in sync (every class has a label)', () => {
    expect(Object.keys(TOOL_CLASS_LABELS).sort()).toEqual([...TOOL_CLASS_ORDER].sort())
  })
})
