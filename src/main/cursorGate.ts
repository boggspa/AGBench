// 1.0.6-CR — Single source of truth for the Cursor (Composer 2.5) provider gate.
//
// Pure (reads only process.env), so it can be imported by both the
// Electron-heavy index.ts AND the lower-level validation modules
// (IpcValidation, ChatService, ComposerService) without an import cycle.
//
// FIRST-CLASS (gate lifted): Cursor is accepted at every trust boundary and
// appears in the normal provider surfaces by default — this is an internal
// dev-team build, so there's no exposure risk in hiding it. An emergency
// kill-switch remains: set TASKWRAITH_DISABLE_CURSOR=1 (or
// TASKWRAITH_EXPERIMENTAL_CURSOR=0) to force it off for triage. Mirrors grokGate.
//
// NOTE: provider visibility is independent of write SAFETY. The load-bearing
// containment lives in CursorCliArgs (never bare `-p`: read-only uses
// `--mode plan`; write mode is contained by a workspace-local deny-list) — see
// the CR3 spike verdict in the blueprint. runCursorProvider runs read-only
// until CR6 wires the write-mode deny-list + approval-ledger path.
//
// READ-ONLY COORDINATION GAP (1.0.72 — deliberately out-of-scope): unlike Codex /
// Claude / Kimi (and the 1.0.72-prepped Gemini), a read-only Cursor seat keeps NO
// TaskWraith MCP coordination tools (ask_user_question / ensemble_yield). This is a
// cursor-agent limitation, not TaskWraith wiring: read-only == `--mode plan`, and
// plan mode REJECTS ALL TOOLS including MCP (see CursorCliArgs / CursorMcpBridge /
// CursorWorkspaceConfig + the CR3 spike), so there is no per-run MCP channel to
// advertise a safe subset over — the web bridge below is write-mode-only for the
// same reason. Closure depends on cursor-agent shipping a plan-mode-with-allowlisted-
// MCP capability upstream (analogous to Gemini's --allowed-tools). Mirrors the
// per-provider parity note at the Gemini sandbox choke in index.ts.
export function experimentalCursorProviderEnabled(): boolean {
  if (isOptOut(process.env.TASKWRAITH_DISABLE_CURSOR)) return false
  // Legacy var, now interpreted as an explicit opt-OUT only (=0/false/no).
  const legacy = process.env.TASKWRAITH_EXPERIMENTAL_CURSOR
  if (legacy === '0' || legacy === 'false' || legacy === 'no') return false
  return true
}

function isOptOut(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}

/**
 * Opt-in raw-stream capture for Cursor (mirrors TASKWRAITH_GROK_DEBUG). When set,
 * every parsed cursor-agent stream-json object is teed to stderr ([cursor-raw])
 * + a tmp jsonl so the live wire shape can be captured from an in-app run.
 * Off by default; never affects behaviour.
 */
export function cursorDebugEnabled(): boolean {
  const v = process.env.TASKWRAITH_CURSOR_DEBUG
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * OQ#2 — toggle for the Cursor web bridge (CRUX39 "B", the proven reliable path).
 * DEFAULT ON (opt-out via TASKWRAITH_CURSOR_WEB=0). It's inert anyway unless the
 * user's global taskwraith server is registered, so that registration is the real
 * opt-in; the env var is just an explicit kill-switch.
 *
 * Background: the spike PROVED Cursor can route web research through an TaskWraith
 * `web_fetch` MCP server in headless default/write mode (plan mode rejects all
 * tools, so it's write-mode only). BUT MCP approval is PER WORKSPACE and headless
 * `--approve-mcps` proved persistently unreliable (`User rejected MCP: …,
 * isReadonly:false`). The reliable recipe (proven 4/4) is: the user registers our
 * read-only server ONCE in global `~/.cursor/mcp.json` (Tools & MCPs → Add Custom
 * MCP), then each workspace is approved via `cursor-agent mcp enable taskwraith`.
 *
 * When enabled AND that global server is registered, TaskWraith (per the maintainer's "B"
 * call) auto-approves the run's workspace itself (`mcp enable taskwraith`, idempotent
 * + cached) and adds the `Mcp(taskwraith:*)` allow rule to the run's `.cursor/cli.json`
 * — NO per-run mcp.json, NO `--approve-mcps`. That `mcp enable` is the ONLY write
 * TaskWraith makes under `~/.cursor`, and only ever approves our own server. If the
 * global server isn't registered the bridge stays inactive (no web, no ~/.cursor
 * write). See the OQ#2 verdict in the Cursor blueprint.
 */
export function cursorWebBridgeEnabled(): boolean {
  // DEFAULT ON (opt-out): inert anyway unless the user's global taskwraith server is
  // registered, so the registration is the real opt-in. TASKWRAITH_CURSOR_WEB=0
  // (or false/no) is an explicit kill-switch.
  const v = process.env.TASKWRAITH_CURSOR_WEB
  return v !== '0' && v !== 'false' && v !== 'no'
}
