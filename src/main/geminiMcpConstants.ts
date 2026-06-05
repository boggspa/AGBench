import { TASKWRAITH_MCP_TOOLS } from './TaskWraithMcpTools'
import { READ_ONLY_MCP_ADVERTISE_TOOLS } from './mcp/McpAutoAllowedTools'
export const GEMINI_MCP_SERVER_NAME = 'TaskWraith'
export const GEMINI_MCP_BRIDGE_ARG = '--taskwraith-gemini-mcp-bridge'
// Second, independent "this process is a bridge child" signal, set as an env var
// on every app-spawned self-test (McpBridgeRuntime). The bridge-mode gate
// (index.ts) treats EITHER this env var OR GEMINI_MCP_BRIDGE_ARG as decisive, so
// a single lost/mangled argv flag can never let a self-test child boot the full
// app and recursively self-spawn past the per-process cap. Mirrored in
// McpBridgeRuntime.ts — keep the literal identical across both files.
export const GEMINI_MCP_BRIDGE_ENV = 'TASKWRAITH_GEMINI_MCP_BRIDGE'

export const GEMINI_MCP_ALLOWED_TOOL_NAMES = [
  ...TASKWRAITH_MCP_TOOLS,
  ...TASKWRAITH_MCP_TOOLS.map((tool) => `${GEMINI_MCP_SERVER_NAME}__${tool}`)
]

// 1.0.72 — read-only safe subset for the flagged read-only MCP advertise path
// (TASKWRAITH_GEMINI_READONLY_MCP). Derived from READ_ONLY_MCP_ADVERTISE_TOOLS
// (= TASKWRAITH_MCP_TOOLS ∩ MCP_AUTO_ALLOWED_TOOLS, floor-tested non-mutating),
// in bare + TaskWraith__-prefixed forms — the mutating floor is never present.
export const GEMINI_MCP_READ_ONLY_TOOL_NAMES = [
  ...READ_ONLY_MCP_ADVERTISE_TOOLS,
  ...READ_ONLY_MCP_ADVERTISE_TOOLS.map((tool) => `${GEMINI_MCP_SERVER_NAME}__${tool}`)
]
