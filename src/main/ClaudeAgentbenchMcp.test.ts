import { describe, expect, it } from 'vitest'
import {
  CLAUDE_AGENTBENCH_TOOL_NAMES,
  CLAUDE_AGENTBENCH_SERVER_NAME,
  buildClaudeAgentbenchAllowedToolNames,
  buildClaudeAgentbenchMcpConfigJson,
  buildClaudeAgentbenchMcpServers,
  extendClaudeCliArgsWithAgentbenchMcp
} from './ClaudeAgentbenchMcp'

// Phase I3 (Claude initiator): the Claude SDK + CLI fallback gain the
// same AGBench MCP server that Gemini/Codex already use. Pin the
// exact `mcpServers` shape (SDK path) and CLI argv extension so a
// regression in the broker / parent-provider routing trips immediately.
describe('buildClaudeAgentbenchMcpServers', () => {
  const fixture = {
    enabled: true,
    bridgeBinaryPath: '/Applications/AgentBench.app/Contents/MacOS/AgentBench',
    bridgeArgs: [
      '--agentbench-gemini-mcp-bridge',
      '--socket',
      '/tmp/agentbench.sock',
      '--token',
      'deadbeef'
    ]
  }

  it('returns null when disabled so the caller can omit the SDK option entirely', () => {
    expect(buildClaudeAgentbenchMcpServers({ ...fixture, enabled: false })).toBeNull()
  })

  it('emits a single AGBench stdio entry with the parentProvider env stamp', () => {
    const servers = buildClaudeAgentbenchMcpServers(fixture)
    expect(servers).toEqual({
      AGBench: {
        type: 'stdio',
        command: '/Applications/AgentBench.app/Contents/MacOS/AgentBench',
        args: [
          '--agentbench-gemini-mcp-bridge',
          '--socket',
          '/tmp/agentbench.sock',
          '--token',
          'deadbeef'
        ],
        env: { AGENTBENCH_PARENT_PROVIDER: 'claude' },
        // QMOD/1.0.3: alwaysLoad disables Claude SDK's tool-search
        // deferral so MCP tools are visible turn-1 without a ToolSearch
        // round-trip. See ClaudeAgentbenchMcp.ts doc for the why.
        alwaysLoad: true
      }
    })
  })

  it('adds run and chat route stamps when provided', () => {
    const servers = buildClaudeAgentbenchMcpServers({
      ...fixture,
      appRunId: 'run-1',
      appChatId: 'chat-1'
    })
    expect(servers?.AGBench.env).toEqual({
      AGENTBENCH_PARENT_PROVIDER: 'claude',
      AGENTBENCH_RUN_ID: 'run-1',
      AGENTBENCH_CHAT_ID: 'chat-1'
    })
  })

  it('uses the AGBench server name (matches Gemini/Codex bridge registrations)', () => {
    const servers = buildClaudeAgentbenchMcpServers(fixture)!
    expect(Object.keys(servers)).toEqual([CLAUDE_AGENTBENCH_SERVER_NAME])
    expect(CLAUDE_AGENTBENCH_SERVER_NAME).toBe('AGBench')
  })

  it('copies bridgeArgs by value so caller mutations cannot drift the SDK config', () => {
    const args = [...fixture.bridgeArgs]
    const servers = buildClaudeAgentbenchMcpServers({ ...fixture, bridgeArgs: args })!
    args.push('--mutated-after-build')
    expect(servers.AGBench.args).not.toContain('--mutated-after-build')
  })
})

describe('buildClaudeAgentbenchMcpConfigJson', () => {
  it('mirrors the SDK shape under a top-level mcpServers key (CLI path)', () => {
    const config = buildClaudeAgentbenchMcpConfigJson({
      enabled: true,
      bridgeBinaryPath: '/opt/agentbench/bin/AgentBench',
      bridgeArgs: [
        '--agentbench-gemini-mcp-bridge',
        '--socket',
        '/run/agentbench.sock',
        '--token',
        'cafebabe'
      ]
    })
    expect(config).toEqual({
      mcpServers: {
        AGBench: {
          type: 'stdio',
          command: '/opt/agentbench/bin/AgentBench',
          args: [
            '--agentbench-gemini-mcp-bridge',
            '--socket',
            '/run/agentbench.sock',
            '--token',
            'cafebabe'
          ],
          env: { AGENTBENCH_PARENT_PROVIDER: 'claude' },
          alwaysLoad: true
        }
      }
    })
  })

  it('returns null when disabled so the caller can skip the temp-file write', () => {
    expect(
      buildClaudeAgentbenchMcpConfigJson({ enabled: false, bridgeBinaryPath: '/x', bridgeArgs: [] })
    ).toBeNull()
  })
})

describe('buildClaudeAgentbenchAllowedToolNames', () => {
  it('emits both mcp__AGBench__<tool> and bare <tool> names for every AGBench MCP tool', () => {
    const names = buildClaudeAgentbenchAllowedToolNames()
    for (const tool of CLAUDE_AGENTBENCH_TOOL_NAMES) {
      expect(names).toContain(`mcp__AGBench__${tool}`)
      expect(names).toContain(tool)
    }
    // Each tool is emitted in both namespaced and bare form.
    expect(names).toHaveLength(CLAUDE_AGENTBENCH_TOOL_NAMES.length * 2)
  })

  it('lists the namespaced form before the bare form (Claude CLI namespacing comes first)', () => {
    const names = buildClaudeAgentbenchAllowedToolNames()
    const firstBareIndex = names.findIndex((name) => !name.startsWith('mcp__'))
    const lastNamespacedIndex = names
      .map((name, index) => (name.startsWith('mcp__') ? index : -1))
      .filter((index) => index >= 0)
      .pop()!
    expect(firstBareIndex).toBeGreaterThan(lastNamespacedIndex)
  })

  it('always includes delegate_to_subthread (the headline Phase I tool)', () => {
    expect(buildClaudeAgentbenchAllowedToolNames()).toContain('mcp__AGBench__delegate_to_subthread')
    expect(buildClaudeAgentbenchAllowedToolNames()).toContain('delegate_to_subthread')
  })
})

describe('extendClaudeCliArgsWithAgentbenchMcp', () => {
  const baseArgs = ['-p', 'hello', '--output-format', 'stream-json']
  const fixture = {
    enabled: true,
    bridgeBinaryPath: '/Applications/AgentBench.app/Contents/MacOS/AgentBench',
    bridgeArgs: [
      '--agentbench-gemini-mcp-bridge',
      '--socket',
      '/tmp/agentbench.sock',
      '--token',
      'deadbeef'
    ],
    configFilePath: '/tmp/agbench-claude-mcp-run-123.json'
  }

  it('returns a copy of base args unchanged when disabled', () => {
    const out = extendClaudeCliArgsWithAgentbenchMcp(baseArgs, { ...fixture, enabled: false })
    expect(out).toEqual(baseArgs)
    expect(out).not.toBe(baseArgs)
    expect(out).not.toContain('--mcp-config')
    expect(out).not.toContain('--allowedTools')
  })

  it('appends --mcp-config <path> and --allowedTools <comma-joined-names> after the base args', () => {
    const out = extendClaudeCliArgsWithAgentbenchMcp(baseArgs, fixture)
    // The base args stay in order at the front.
    expect(out.slice(0, baseArgs.length)).toEqual(baseArgs)
    // --mcp-config followed by the temp file path.
    const mcpIndex = out.indexOf('--mcp-config')
    expect(mcpIndex).toBeGreaterThan(-1)
    expect(out[mcpIndex + 1]).toBe('/tmp/agbench-claude-mcp-run-123.json')
    // --allowedTools followed by the comma-joined list.
    const allowedIndex = out.indexOf('--allowedTools')
    expect(allowedIndex).toBeGreaterThan(-1)
    const allowedValue = out[allowedIndex + 1]
    expect(allowedValue.split(',')).toEqual(buildClaudeAgentbenchAllowedToolNames())
  })

  it('does not mutate the supplied base args array (pure function contract)', () => {
    const args = [...baseArgs]
    extendClaudeCliArgsWithAgentbenchMcp(args, fixture)
    expect(args).toEqual(baseArgs)
  })
})
