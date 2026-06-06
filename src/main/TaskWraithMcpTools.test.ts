import { describe, expect, it } from 'vitest'
import { TASKWRAITH_MCP_TOOLS } from './TaskWraithMcpTools'
import { createTaskWraithMcpToolDefinitions } from './McpToolCatalog'

describe('TaskWraith MCP tool registry', () => {
  it('keeps the advertised tool catalog in lockstep with the canonical name registry', () => {
    const catalogNames = createTaskWraithMcpToolDefinitions().map((tool) => tool.name)
    expect(catalogNames).toEqual([...TASKWRAITH_MCP_TOOLS])
    expect(new Set(catalogNames).size).toBe(catalogNames.length)
  })

  it('does not expose a Session Activity Ledger write path to agents', () => {
    expect(TASKWRAITH_MCP_TOOLS).not.toContain('session_activity_append' as never)
    expect(TASKWRAITH_MCP_TOOLS).not.toContain('session_activity_write' as never)
    expect(
      TASKWRAITH_MCP_TOOLS.some((name) => /session.*activity|activity.*ledger/i.test(name))
    ).toBe(false)
  })
})
