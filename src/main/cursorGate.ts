// 1.0.6-CR — Single source of truth for the Cursor (Composer 2.5) provider gate.
//
// Pure (reads only process.env), so it can be imported by both the
// Electron-heavy index.ts AND the lower-level validation modules
// (IpcValidation, ChatService, ComposerService) without an import cycle.
//
// FIRST-CLASS (gate lifted): Cursor is accepted at every trust boundary and
// appears in the normal provider surfaces by default — this is an internal
// dev-team build, so there's no exposure risk in hiding it. An emergency
// kill-switch remains: set AGBENCH_DISABLE_CURSOR=1 (or
// AGBENCH_EXPERIMENTAL_CURSOR=0) to force it off for triage. Mirrors grokGate.
//
// NOTE: provider visibility is independent of write SAFETY. The load-bearing
// containment lives in CursorCliArgs (never bare `-p`: read-only uses
// `--mode plan`; write mode is contained by a workspace-local deny-list) — see
// the CR3 spike verdict in the blueprint. runCursorProvider runs read-only
// until CR6 wires the write-mode deny-list + approval-ledger path.
export function experimentalCursorProviderEnabled(): boolean {
  if (isOptOut(process.env.AGBENCH_DISABLE_CURSOR)) return false
  // Legacy var, now interpreted as an explicit opt-OUT only (=0/false/no).
  const legacy = process.env.AGBENCH_EXPERIMENTAL_CURSOR
  if (legacy === '0' || legacy === 'false' || legacy === 'no') return false
  return true
}

function isOptOut(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}

/**
 * Opt-in raw-stream capture for Cursor (mirrors AGBENCH_GROK_DEBUG). When set,
 * every parsed cursor-agent stream-json object is teed to stderr ([cursor-raw])
 * + a tmp jsonl so the live wire shape can be captured from an in-app run.
 * Off by default; never affects behaviour.
 */
export function cursorDebugEnabled(): boolean {
  const v = process.env.AGBENCH_CURSOR_DEBUG
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * OQ#2 — opt-in toggle for the Cursor web bridge: a per-run, workspace-local
 * `.cursor/mcp.json` registering the AGBench `web_fetch` MCP server (run via
 * electron-as-node) + an `Mcp(agbench:*)` allow rule + `--approve-mcps`, all
 * applied alongside the write-mode deny-list and restored after the run.
 *
 * DEFAULT OFF (set AGBENCH_CURSOR_WEB=1 to enable). The live spike PROVED Cursor
 * CAN route web research through this bridge in headless default/write mode (and
 * that plan mode rejects all tools, so it's write-mode only). BUT headless
 * auto-approval via `--approve-mcps` proved UNRELIABLE under load: tool calls are
 * frequently rejected with `User rejected MCP: …, isReadonly:false`, unaffected
 * by an MCP `readOnlyHint` annotation or a fresh server name. The reliable path,
 * `cursor-agent mcp enable <id>`, mutates global `~/.cursor` — a hard boundary we
 * never cross. So the bridge is opt-in/best-effort: when Cursor's auto-approval
 * cooperates it works end-to-end; when it doesn't, the agent degrades gracefully
 * (no edits/shell — those stay deny-listed; it just can't fetch that turn). See
 * the OQ#2 verdict in the Cursor blueprint.
 */
export function cursorWebBridgeEnabled(): boolean {
  const v = process.env.AGBENCH_CURSOR_WEB
  return v === '1' || v === 'true' || v === 'yes'
}
