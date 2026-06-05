import { describe, expect, it } from 'vitest'
import { TASKWRAITH_MCP_TOOLS } from './TaskWraithMcpTools'

describe('TaskWraith MCP tool registry', () => {
  it('does not expose a Session Activity Ledger write path to agents', () => {
    expect(TASKWRAITH_MCP_TOOLS).not.toContain('session_activity_append' as never)
    expect(TASKWRAITH_MCP_TOOLS).not.toContain('session_activity_write' as never)
    expect(
      TASKWRAITH_MCP_TOOLS.some((name) => /session.*activity|activity.*ledger/i.test(name))
    ).toBe(false)
  })
})
