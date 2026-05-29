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
