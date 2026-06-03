/**
 * Tool-class taxonomy — the single source of truth that buckets every agent
 * tool into one of four classes for permission-posture display:
 *
 *   - workspace_read   non-mutating file / code reads (read_file, grep, …)
 *   - workspace_write  mutating tools (write_file, apply_patch, run_shell, …)
 *   - orchestration    non-mutating control / status / focus (status reads,
 *                      ensemble yield, scheduling, open-in-IDE focus changes)
 *   - ui_elicitation   asking the user (ask_user_question)
 *
 * Why a dedicated module (1.0.72): the read-only / plan posture UI needs to
 * show *which classes* a posture permits (panel feedback). The non-write class
 * lists are derived from the existing canonical sets — READ_ONLY_TOOL_PRESET
 * (PermissionEnvelope) and MCP_AUTO_ALLOWED_TOOLS (McpAutoAllowedTools) — and a
 * cross-check test asserts every member of those non-mutating sets classifies
 * as non-write, so this taxonomy can't silently drift from the safety invariant.
 *
 * classifyTool defaults the UNKNOWN tool to workspace_write — the safe default
 * (an unrecognised tool is treated as mutating, never surfaced as "safe").
 */

export type ToolClass = 'workspace_read' | 'workspace_write' | 'orchestration' | 'ui_elicitation'

/** Display order: the allowed-under-read-only classes first, writes last. */
export const TOOL_CLASS_ORDER: readonly ToolClass[] = [
  'workspace_read',
  'orchestration',
  'ui_elicitation',
  'workspace_write'
]

export const TOOL_CLASS_LABELS: Record<ToolClass, string> = {
  workspace_read: 'Workspace reads',
  workspace_write: 'Workspace writes',
  orchestration: 'Orchestration',
  ui_elicitation: 'User prompts'
}

const WORKSPACE_READ_TOOLS = new Set<string>([
  'read_file',
  'list_directory',
  'grep',
  'glob',
  'workspace_search',
  'workspace_symbols'
])

const UI_ELICITATION_TOOLS = new Set<string>(['ask_user_question'])

const ORCHESTRATION_TOOLS = new Set<string>([
  'approval_status',
  'provider_auth_status',
  'provider_usage_status',
  'browser_console',
  'creative_app_status',
  'creative_app_capabilities',
  'attached_window_status',
  'appwatch_status',
  'open_in_ide',
  'open_in_ide_at_position',
  'reveal_in_finder',
  'ide_app_status',
  'ide_app_capabilities',
  'list_running_ides',
  'ensemble_yield',
  'list_ensemble_participants',
  'schedule_wakeup',
  'cancel_wakeup'
])

/** Bucket a single tool name. Unknown → workspace_write (safe default). */
export function classifyTool(name: string): ToolClass {
  if (UI_ELICITATION_TOOLS.has(name)) return 'ui_elicitation'
  if (WORKSPACE_READ_TOOLS.has(name)) return 'workspace_read'
  if (ORCHESTRATION_TOOLS.has(name)) return 'orchestration'
  return 'workspace_write'
}

/**
 * Group a list of tool names by class. Every class key is present (empty array
 * when none) so callers can render a stable layout; per-class order follows the
 * input order.
 */
export function groupToolsByClass(names: readonly string[]): Record<ToolClass, string[]> {
  const out: Record<ToolClass, string[]> = {
    workspace_read: [],
    orchestration: [],
    ui_elicitation: [],
    workspace_write: []
  }
  for (const name of names) out[classifyTool(name)].push(name)
  return out
}
