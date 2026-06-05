import { describe, expect, it } from 'vitest'
import {
  GEMINI_MCP_BRIDGE_ARG as ARG_CONST,
  GEMINI_MCP_BRIDGE_ARG_SUFFIX as SUFFIX_CONST,
  GEMINI_MCP_BRIDGE_ENV as ENV_CONST
} from '../geminiMcpConstants'
import {
  GEMINI_MCP_BRIDGE_ARG as ARG_RUNTIME,
  GEMINI_MCP_BRIDGE_ARG_SUFFIX as SUFFIX_RUNTIME,
  GEMINI_MCP_BRIDGE_ENV as ENV_RUNTIME
} from './McpBridgeRuntime'

/*
 * The bridge-child gate (index.ts) decides "am I a self-test child or the real
 * app?" from TWO independent signals: the argv flag GEMINI_MCP_BRIDGE_ARG and the
 * env var GEMINI_MCP_BRIDGE_ENV (set on every app-spawned self-test). Each signal
 * is declared in BOTH geminiMcpConstants.ts (read by the gate) and
 * McpBridgeRuntime.ts (read by the spawner). If the two declarations ever drift,
 * the spawner would tag children with one value while the gate checks another —
 * silently reintroducing the exponential self-spawn these signals exist to
 * prevent (a self-test child booting the full app, which self-spawns more). These
 * assertions fail loudly on any such drift.
 */
describe('Gemini MCP bridge child-detection signals stay in sync', () => {
  it('keeps the argv flag identical across the constants module and the runtime', () => {
    expect(ARG_RUNTIME).toBe(ARG_CONST)
    expect(ARG_CONST).toBe('--taskwraith-gemini-mcp-bridge')
  })

  it('keeps the env-var name identical between the spawner and the gate', () => {
    expect(ENV_RUNTIME).toBe(ENV_CONST)
    expect(ENV_CONST).toBe('TASKWRAITH_GEMINI_MCP_BRIDGE')
  })

  it('keeps the current arg covered by the rename-proof suffix match', () => {
    // index.ts detects a bridge child via arg.endsWith(SUFFIX), so a STALE
    // pre-rebrand registration (an old --*-gemini-mcp-bridge flag) still routes
    // to bridge-mode instead of booting the full app. The CURRENT flag must end
    // with the suffix or the gate would miss our own spawns.
    expect(SUFFIX_CONST).toBe('-gemini-mcp-bridge')
    expect(SUFFIX_RUNTIME).toBe(SUFFIX_CONST)
    expect(ARG_CONST.endsWith(SUFFIX_CONST)).toBe(true)
    expect(ARG_RUNTIME.endsWith(SUFFIX_CONST)).toBe(true)
  })
})
