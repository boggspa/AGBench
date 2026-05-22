import { describe, expect, it } from 'vitest'
import { buildCodexAgentbenchMcpArgs, type CodexMcpAgentbenchConfig } from './CodexAppServerClient'

// Phase I2: the Codex CLI gets the AGBench MCP server registered
// at spawn time via `-c mcp_servers.AGBench.*` config overrides.
// Pin the exact `-c` arg list (order + TOML escaping) so we don't
// regress the Codex → AGBench MCP bridge wiring on accident.
describe('buildCodexAgentbenchMcpArgs', () => {
  function makeConfig(overrides: Partial<CodexMcpAgentbenchConfig> = {}): CodexMcpAgentbenchConfig {
    return {
      enabled: true,
      bridgeBinaryPath: '/Applications/AgentBench.app/Contents/MacOS/AgentBench',
      bridgeArgs: [
        '--agentbench-gemini-mcp-bridge',
        '--socket',
        '/tmp/agentbench.sock',
        '--token',
        'deadbeef'
      ],
      parentProvider: 'codex',
      ...overrides
    }
  }

  it('returns empty arg list when MCP integration is disabled', () => {
    // Disabled: Codex spawns without any -c overrides, so its agents
    // can't reach the AGBench MCP server (matches the existing
    // user-controlled `geminiMcpBridgeEnabled` toggle behaviour).
    expect(buildCodexAgentbenchMcpArgs({ ...makeConfig(), enabled: false })).toEqual([])
  })

  it('emits three -c flag pairs in command/args/env order when enabled', () => {
    const args = buildCodexAgentbenchMcpArgs(makeConfig())
    expect(args).toHaveLength(6)
    expect(args[0]).toBe('-c')
    expect(args[1]).toBe(
      'mcp_servers.AGBench.command="/Applications/AgentBench.app/Contents/MacOS/AgentBench"'
    )
    expect(args[2]).toBe('-c')
    expect(args[3]).toBe(
      'mcp_servers.AGBench.args=["--agentbench-gemini-mcp-bridge", "--socket", "/tmp/agentbench.sock", "--token", "deadbeef"]'
    )
    expect(args[4]).toBe('-c')
    expect(args[5]).toBe('mcp_servers.AGBench.env={ AGENTBENCH_PARENT_PROVIDER = "codex" }')
  })

  it('TOML-escapes embedded backslashes and double quotes', () => {
    // Windows-style bridge path with backslashes. We don't expect to
    // ship Windows builds yet but the escape codepath should be
    // resilient if process.execPath ever returns one. Quotes must be
    // backslash-escaped or the TOML basic-string parser blows up.
    const args = buildCodexAgentbenchMcpArgs(
      makeConfig({
        bridgeBinaryPath: 'C:\\AgentBench\\bench"executable"',
        bridgeArgs: ['weird\\path', 'has "quote"']
      })
    )
    expect(args[1]).toBe('mcp_servers.AGBench.command="C:\\\\AgentBench\\\\bench\\"executable\\""')
    expect(args[3]).toBe('mcp_servers.AGBench.args=["weird\\\\path", "has \\"quote\\""]')
  })

  it('preserves the parentProvider stamp in the env override', () => {
    // Currently only 'codex' is supported (Gemini uses a different
    // spawn mechanism and stamps env directly). Pin the contract so
    // if a future provider rides on CodexAppServerClient it has to
    // update the test too.
    const args = buildCodexAgentbenchMcpArgs(makeConfig())
    expect(args[5]).toContain('AGENTBENCH_PARENT_PROVIDER = "codex"')
  })
})
