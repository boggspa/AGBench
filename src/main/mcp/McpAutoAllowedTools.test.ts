import { describe, expect, it } from 'vitest'
import { MCP_AUTO_ALLOWED_TOOLS } from './McpAutoAllowedTools'

describe('MCP_AUTO_ALLOWED_TOOLS', () => {
  it('auto-allows the four workspace read tools (1.0.71 read parity)', () => {
    for (const tool of [
      'read_file',
      'list_directory',
      'workspace_search',
      'workspace_symbols'
    ] as const) {
      expect(MCP_AUTO_ALLOWED_TOOLS.has(tool)).toBe(true)
    }
  })

  it('SAFETY INVARIANT: never auto-allows a mutating / shell / patch tool', () => {
    // Membership SKIPS the host approval gate, so any of these in the set would
    // execute even under the read_only preset. They must always stay gated.
    for (const tool of [
      'write_file',
      'replace',
      'apply_patch',
      'run_shell_command',
      'git_stage',
      'git_commit',
      'run_task'
    ] as const) {
      expect(MCP_AUTO_ALLOWED_TOOLS.has(tool)).toBe(false)
    }
  })
})
