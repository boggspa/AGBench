export const AGENTBENCH_MCP_TOOLS = [
  'run_shell_command',
  'write_file',
  'replace',
  'read_file',
  'list_directory',
  'workspace_search',
  'apply_patch',
  'git_status',
  'git_diff',
  'git_stage',
  'git_commit',
  'run_task',
  'test_result_summary',
  'list_subthreads',
  'read_subthread_result',
  'cancel_subthread',
  'workspace_symbols',
  'browser_open',
  'browser_click',
  'browser_screenshot',
  'browser_console',
  'attached_window_capture',
  'attached_window_status',
  'approval_status',
  'provider_auth_status',
  'run_timeline',
  'raw_provider_events',
  'open_workspace_file',
  'creative_app_status',
  'creative_app_capabilities',
  'creative_project_snapshot',
  'creative_timeline_validate',
  'creative_timeline_ir',
  'creative_timeline_diff',
  // Phase K3 — write IR to .fcpxml + dispatch to FCP via NSWorkspace
  // (with user approval modal). Mutates state, hence the gate.
  'creative_timeline_import',
  // Phase K4 — dispatch a named AppleScript class against FCP or
  // Logic, with session-class approval cache. Source is constructed
  // from a curated library; raw-source path exists but never caches.
  'creative_applescript_dispatch',
  'create_handoff_card',
  'switch_auth_profile',
  'agent_delegation_role',
  'delegate_to_subthread'
] as const

export type AGBenchMcpToolName = (typeof AGENTBENCH_MCP_TOOLS)[number]

export const AGENTBENCH_MCP_TOOL_LIST = AGENTBENCH_MCP_TOOLS.join(', ')
