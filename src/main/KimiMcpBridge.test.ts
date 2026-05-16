import { describe, expect, it } from 'vitest'
import {
  KIMI_AGENTBENCH_SERVER_NAME,
  KIMI_AGENTBENCH_TOOL_NAMES,
  buildKimiMcpBridgeAddArgs,
  redactKimiMcpBridgeAddArgs
} from './KimiMcpBridge'

// Phase I4 (Kimi initiator): the Kimi CLI gains the same agentbench
// MCP server that Gemini / Codex / Claude already have. Pin the exact
// argv shape passed to `kimi mcp add` so a regression in the broker /
// parent-provider routing trips immediately.
//
// Kimi CLI 1.43.0 syntax (verified via `kimi mcp add --help`):
//
//   kimi mcp add <name> --transport stdio --env KEY=VALUE -- <command> <args>
//
// The `--` separator is the key difference vs. Gemini/Codex: it tells
// Kimi to stop flag-parsing so the bridge's --socket / --token args
// survive intact to the subprocess.
describe('buildKimiMcpBridgeAddArgs', () => {
  const fixture = {
    bridgeBinaryPath: '/Applications/AgentBench.app/Contents/MacOS/AgentBench',
    bridgeArgs: ['--agentbench-gemini-mcp-bridge', '--socket', '/tmp/agentbench.sock', '--token', 'deadbeef']
  }

  it('emits the canonical kimi mcp add argv with --env env-stamp and -- separator', () => {
    const args = buildKimiMcpBridgeAddArgs(fixture)
    expect(args).toEqual([
      'mcp',
      'add',
      'agentbench',
      '--transport',
      'stdio',
      '--env',
      'AGENTBENCH_PARENT_PROVIDER=kimi',
      '--',
      '/Applications/AgentBench.app/Contents/MacOS/AgentBench',
      '--agentbench-gemini-mcp-bridge',
      '--socket',
      '/tmp/agentbench.sock',
      '--token',
      'deadbeef'
    ])
  })

  it("uses 'agentbench' as the server name (matches Gemini / Codex / Claude registrations)", () => {
    const args = buildKimiMcpBridgeAddArgs(fixture)
    // Name is the third positional after `mcp add`.
    expect(args[0]).toBe('mcp')
    expect(args[1]).toBe('add')
    expect(args[2]).toBe(KIMI_AGENTBENCH_SERVER_NAME)
    expect(KIMI_AGENTBENCH_SERVER_NAME).toBe('agentbench')
  })

  it("declares stdio transport explicitly via `--transport stdio`", () => {
    const args = buildKimiMcpBridgeAddArgs(fixture)
    const transportIndex = args.indexOf('--transport')
    expect(transportIndex).toBeGreaterThan(-1)
    expect(args[transportIndex + 1]).toBe('stdio')
  })

  it('stamps AGENTBENCH_PARENT_PROVIDER=kimi via the --env flag so the bridge inherits the routing key', () => {
    const args = buildKimiMcpBridgeAddArgs(fixture)
    const envIndex = args.indexOf('--env')
    expect(envIndex).toBeGreaterThan(-1)
    expect(args[envIndex + 1]).toBe('AGENTBENCH_PARENT_PROVIDER=kimi')
  })

  it('places the `--` separator BEFORE the bridge command (so Kimi stops flag-parsing)', () => {
    const args = buildKimiMcpBridgeAddArgs(fixture)
    const sepIndex = args.indexOf('--')
    expect(sepIndex).toBeGreaterThan(-1)
    expect(args[sepIndex + 1]).toBe(fixture.bridgeBinaryPath)
    // All bridgeArgs come after the binary path.
    for (const bridgeArg of fixture.bridgeArgs) {
      const argIndex = args.indexOf(bridgeArg)
      expect(argIndex).toBeGreaterThan(sepIndex)
    }
  })

  it('preserves bridgeArgs order verbatim after the binary path', () => {
    const args = buildKimiMcpBridgeAddArgs(fixture)
    const binaryIndex = args.indexOf(fixture.bridgeBinaryPath)
    expect(args.slice(binaryIndex + 1)).toEqual(fixture.bridgeArgs)
  })

  it('always includes delegate_to_subthread in the AGBench MCP tool list (headline Phase I tool)', () => {
    expect(KIMI_AGENTBENCH_TOOL_NAMES).toContain('delegate_to_subthread')
  })

  it('handles bridges with no extra args (degenerate but valid input shape)', () => {
    const args = buildKimiMcpBridgeAddArgs({
      bridgeBinaryPath: '/usr/local/bin/agentbench',
      bridgeArgs: []
    })
    const sepIndex = args.indexOf('--')
    expect(args[sepIndex + 1]).toBe('/usr/local/bin/agentbench')
    expect(args).toHaveLength(sepIndex + 2)
  })

  it('does not mutate the supplied bridgeArgs array (pure function contract)', () => {
    const bridgeArgs = [...fixture.bridgeArgs]
    buildKimiMcpBridgeAddArgs({ ...fixture, bridgeArgs })
    expect(bridgeArgs).toEqual(fixture.bridgeArgs)
  })
})

describe('redactKimiMcpBridgeAddArgs', () => {
  it('redacts the argument immediately following --token so logs do not leak the broker secret', () => {
    const args = buildKimiMcpBridgeAddArgs({
      bridgeBinaryPath: '/opt/agentbench/bin/AgentBench',
      bridgeArgs: ['--agentbench-gemini-mcp-bridge', '--socket', '/run/agentbench.sock', '--token', 'cafebabe-secret-token']
    })
    const redacted = redactKimiMcpBridgeAddArgs(args)
    expect(redacted).not.toContain('cafebabe-secret-token')
    const tokenIndex = redacted.indexOf('--token')
    expect(redacted[tokenIndex + 1]).toBe('[redacted-token]')
  })

  it('does not redact any other argument', () => {
    const args = buildKimiMcpBridgeAddArgs({
      bridgeBinaryPath: '/opt/agentbench/bin/AgentBench',
      bridgeArgs: ['--agentbench-gemini-mcp-bridge', '--socket', '/run/agentbench.sock', '--token', 'cafebabe']
    })
    const redacted = redactKimiMcpBridgeAddArgs(args)
    expect(redacted).toContain('/opt/agentbench/bin/AgentBench')
    expect(redacted).toContain('--socket')
    expect(redacted).toContain('/run/agentbench.sock')
    expect(redacted).toContain('AGENTBENCH_PARENT_PROVIDER=kimi')
  })
})
