// 1.0.6-CR — Single source of truth for the Cursor (Composer 2.5) experimental
// gate.
//
// Pure (reads only process.env), so it can be imported by both the
// Electron-heavy index.ts AND the lower-level validation modules
// (IpcValidation, ChatService, ComposerService) without an import cycle.
//
// DEFAULT OFF (opt-in). Cursor is the newest provider and its write-capable
// mode owns native edit/shell unless contained — so it stays behind an explicit
// opt-in until the full AGBench-owned write path (deny-list + MCP + approval
// ledger + run-diff) is soaked. Enable with AGBENCH_EXPERIMENTAL_CURSOR=1.
//
// Mirrors grokGate's shape so the dispatch triple-gate (IpcValidation PROVIDERS
// Set, assertProviderId, providerAdapters registry) keys off one helper.
export function experimentalCursorProviderEnabled(): boolean {
  const v = process.env.AGBENCH_EXPERIMENTAL_CURSOR
  return v === '1' || v === 'true' || v === 'yes'
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
