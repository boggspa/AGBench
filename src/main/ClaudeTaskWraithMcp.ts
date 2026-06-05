// Phase I3 (Claude initiator): wire the taskwraith MCP bridge into the
// Claude run paths so a Claude agent can call delegate_to_subthread on
// other providers. Gemini and Codex already register the bridge — this
// module mirrors that wiring for Claude's two run modes:
//
//  - SDK path: the Anthropic Agent SDK accepts an `mcpServers` map on
//    the `query({...})` Options object. Each entry is a McpStdioServerConfig
//    of `{ type, command, args, env }`. The bridge subprocess inherits
//    TASKWRAITH_PARENT_PROVIDER plus any per-run route stamps from the
//    `env` block, then stamps every broker request with provider/run/chat
//    metadata when available.
//  - CLI path: Claude Code 2.1.x exposes `--mcp-config <configs...>`
//    which accepts JSON file paths whose `mcpServers` map matches the
//    SDK shape. We write the file under `os.tmpdir()` (or app temp) per
//    run and pass `--mcp-config <path>` + `--allowedTools <names>` so
//    the agent sees the tools pre-approved.
//
// Kept free of Electron / fs / IPC imports so it can be unit-tested
// directly against fixed inputs.

import { TASKWRAITH_MCP_TOOLS } from './TaskWraithMcpTools'

/**
 * TaskWraith MCP tool name list. Re-exported under the Claude-specific name
 * for tests and call sites that validate Claude's `allowedTools` wiring.
 */
export const CLAUDE_TASKWRAITH_TOOL_NAMES = TASKWRAITH_MCP_TOOLS

/**
 * Server name used as the key in `mcpServers` and as the prefix for
 * MCP-namespaced tool names in `--allowedTools`. Claude Code's CLI
 * namespacing convention is `mcp__<server>__<tool>` — we emit BOTH the
 * namespaced form and the bare tool names so the agent sees them
 * pre-approved regardless of which form the SDK / CLI exposes.
 */
// MCP server registration name passed to `@anthropic-ai/claude-agent-sdk`
// (`options.mcpServers = { TaskWraith: { ... } }`) and to the Claude CLI
// via `--mcp-config`. Tools appear in the Claude agent's tool list as
// `mcp__TaskWraith__delegate_to_subthread`. Mixed-case matches the
// product display name; the SDK accepts any string as a server key.
export const CLAUDE_TASKWRAITH_SERVER_NAME = 'TaskWraith'

export interface ClaudeTaskWraithMcpInput {
  enabled: boolean
  /** Absolute path of the TaskWraith binary that hosts the MCP bridge. */
  bridgeBinaryPath: string
  /** argv passed to the bridge subprocess (already includes flag literals). */
  bridgeArgs: string[]
  /** Optional TaskWraith route stamps for per-run MCP subprocesses. */
  appRunId?: string
  appChatId?: string
}

/**
 * SDK Options.mcpServers entry shape. Matches McpStdioServerConfig
 * from `@anthropic-ai/claude-agent-sdk` (sdk.d.ts) — `type: 'stdio'`,
 * `command`, `args`, `env`. Kept as a structural type so we don't have
 * to import the SDK's types in tests.
 *
 * `alwaysLoad: true` (1.0.3) disables tool-search deferral for this
 * server. Without it, the Claude SDK puts MCP tools BEHIND a
 * `ToolSearch` round-trip on first invocation: the agent has to call
 * `ToolSearch` → discover `ensemble_yield` / `ask_user_question` /
 * etc. → then call the actual tool, doubling the round-trips per
 * delegation. Tester reported "Claude kept giving up" partly because
 * the deferred call ate the 30s plan-mode budget. Always-load all
 * TaskWraith tools at startup so the first turn already has them.
 *
 * Trade-off: the SDK blocks startup until the bridge connects (capped
 * at 5s). For TaskWraith's stdio bridge that's a 50-200ms hit — fully
 * worth it to remove the per-tool friction.
 */
export interface ClaudeMcpStdioServerEntry {
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
  alwaysLoad?: boolean
}

export interface ClaudeTaskWraithMcpServers {
  [serverName: string]: ClaudeMcpStdioServerEntry
}

/**
 * Build the `mcpServers` map passed to `query({ options: { mcpServers } })`
 * (SDK path) or written into the `--mcp-config` JSON file (CLI path).
 * Returns null when disabled so the caller can omit the option entirely.
 *
 * The env stamp lives on the MCP server entry's `env` block: the bridge
 * subprocess inherits provider plus run/chat metadata and the broker uses
 * it to route approvals + audit events to the exact Claude run when
 * available.
 *
 * `alwaysLoad: true` is set so Claude's tool-search deferral doesn't
 * make the first delegation pay a ToolSearch round-trip. See the
 * `ClaudeMcpStdioServerEntry` doc comment for the why.
 */
export function buildClaudeTaskWraithMcpServers(
  input: ClaudeTaskWraithMcpInput
): ClaudeTaskWraithMcpServers | null {
  if (!input.enabled) return null
  return {
    [CLAUDE_TASKWRAITH_SERVER_NAME]: {
      type: 'stdio',
      command: input.bridgeBinaryPath,
      args: [...input.bridgeArgs],
      env: buildClaudeTaskWraithMcpEnv(input),
      alwaysLoad: true
    }
  }
}

function buildClaudeTaskWraithMcpEnv(input: ClaudeTaskWraithMcpInput): Record<string, string> {
  return {
    TASKWRAITH_PARENT_PROVIDER: 'claude',
    ...(input.appRunId ? { TASKWRAITH_RUN_ID: input.appRunId } : {}),
    ...(input.appChatId ? { TASKWRAITH_CHAT_ID: input.appChatId } : {})
  }
}

/**
 * The list of tool names to feed `--allowedTools` (CLI path) or
 * `allowedTools` (SDK path) so Claude sees the taskwraith MCP tools
 * as pre-approved. Emits both the bare names and the
 * `mcp__<server>__<tool>` namespaced form — Claude Code's CLI surfaces
 * MCP tools under the `mcp__<server>__<tool>` convention (see
 * `claude --help` / docs) but the bare names are accepted too.
 */
export function buildClaudeTaskWraithAllowedToolNames(): string[] {
  const names: string[] = []
  for (const tool of CLAUDE_TASKWRAITH_TOOL_NAMES) {
    names.push(`mcp__${CLAUDE_TASKWRAITH_SERVER_NAME}__${tool}`)
  }
  for (const tool of CLAUDE_TASKWRAITH_TOOL_NAMES) {
    names.push(tool)
  }
  return names
}

/**
 * Build the JSON document written to disk for the CLI fallback's
 * `--mcp-config <path>` argument. Same `mcpServers` shape as the SDK
 * path. Returns null when disabled so the caller can skip file-write.
 */
export function buildClaudeTaskWraithMcpConfigJson(
  input: ClaudeTaskWraithMcpInput
): { mcpServers: ClaudeTaskWraithMcpServers } | null {
  const mcpServers = buildClaudeTaskWraithMcpServers(input)
  if (!mcpServers) return null
  return { mcpServers }
}

export interface ClaudeTaskWraithCliArgsInput extends ClaudeTaskWraithMcpInput {
  /** Absolute path of the temp JSON file passed to `--mcp-config`. */
  configFilePath: string
}

/**
 * Append `--mcp-config <path>` + `--allowedTools <...names>` to the
 * existing Claude CLI argv. Returns the existing args unchanged when
 * disabled so the toggle gates the entire feature cleanly.
 *
 * The temp file is written separately by the caller — this helper is
 * pure for test determinism.
 */
export function extendClaudeCliArgsWithTaskWraithMcp(
  baseArgs: string[],
  input: ClaudeTaskWraithCliArgsInput
): string[] {
  if (!input.enabled) return [...baseArgs]
  const extended = [...baseArgs, '--mcp-config', input.configFilePath]
  const allowed = buildClaudeTaskWraithAllowedToolNames()
  if (allowed.length > 0) {
    extended.push('--allowedTools', allowed.join(','))
  }
  return extended
}
