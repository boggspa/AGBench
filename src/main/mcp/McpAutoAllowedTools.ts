import type { AGBenchMcpToolName } from '../AgentbenchMcpTools'

/**
 * MCP tools that skip the per-call approval modal (auto-allowed).
 *
 * ⚠️ SAFETY INVARIANT — this set may contain ONLY non-mutating tools. Being a
 * member makes a tool SKIP the host-side approval gate
 * (`requestAgenticServiceApproval`), so any mutating tool added here would
 * execute even under the `read_only` preset. Writes / shell / patch tools MUST
 * stay out — they remain gated and are denied under read_only. The invariant is
 * enforced by `McpAutoAllowedTools.test.ts`; do not weaken it.
 *
 * Historically this held only status / focus tools (state the user already
 * sees, or focus changes). 1.0.71 adds the four workspace READ tools so every
 * read-only participant — notably Claude, whose SDK plan-mode otherwise made
 * every file read hit the approval modal — gets the same friction-free read
 * surface Gemini already had. Those reads are genuinely read-only (`fs` reads +
 * ripgrep invoked as an argv array, no shell) and are workspace-scope-guarded
 * (symlink/traversal-proof) in workspace chats. NOTE: in *global-scope* chats
 * the workspace path guard is bypassed by design, so auto-allowing reads there
 * means individual reads are no longer prompted — acceptable (reads only;
 * writes / shell / network stay gated), but worth knowing if global-scope
 * per-read prompting is ever wanted back.
 */
export const MCP_AUTO_ALLOWED_TOOLS = new Set<AGBenchMcpToolName>([
  'approval_status',
  'provider_auth_status',
  'browser_console',
  'creative_app_status',
  'creative_app_capabilities',
  // attached_window_status carries no pixel data and no window enumeration —
  // only the title/bundle the user already sees in the renderer pill.
  // Capture stays gated; status is a read of state the user already shared.
  'attached_window_status',
  // appwatch_status is the same data class as attached_window_status: no
  // pixel data, only stream-up/down + counts the renderer pill already
  // shows. Start / stop / latest_frame stay gated.
  'appwatch_status',
  // Phase L — Editor / IDE transport tools. Opening a file in the
  // user's editor of choice is a focus-change, not a state mutation.
  // No destructive surface beyond the agent's choice of editor (which
  // we constrain via the EditorAdapters bundle allowlist).
  'open_in_ide',
  'open_in_ide_at_position',
  'reveal_in_finder',
  'ide_app_status',
  'ide_app_capabilities',
  'list_running_ides',
  'ensemble_yield',
  'list_ensemble_participants',
  'schedule_wakeup',
  'cancel_wakeup',
  // QMOD (1.0.3): asking the user a question is the inverse of the
  // user prompting the agent — it's a focus-shift, not a state mutation.
  // The renderer modal IS the approval surface, so a second confirm
  // step would be silly. Universally auto-allowed.
  'ask_user_question',
  // 1.0.71 — workspace READ tools (see header). Read-only + host-gate-safe:
  // writes/shell are NOT here, so they still hit the gate and are denied under
  // read_only. This is what gives read-only Claude/Kimi parity with Gemini's
  // read surface instead of a modal on every read.
  'read_file',
  'list_directory',
  'workspace_search',
  'workspace_symbols'
])
