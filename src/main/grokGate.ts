// 1.0.6-G — Single source of truth for the internal Grok experimental gate.
//
// Pure (reads only process.env), so it can be imported by both the
// Electron-heavy index.ts AND the lower-level validation modules
// (IpcValidation, ChatService, ComposerService) without an import cycle.
//
// 1.0.6 — Grok is now a FIRST-CLASS provider (the experimental gate has been
// lifted): it is accepted at every trust boundary and appears in the normal
// provider surfaces by default. An emergency kill-switch remains — set
// TASKWRAITH_DISABLE_GROK=1 (or TASKWRAITH_EXPERIMENTAL_GROK=0) to force it off,
// e.g. for a regression triage. NOTE: native tool execution (Read/shell/edit
// mediated through the approval ledger) is still pending G5, and session
// persistence is pending G6, so Grok runs read-only-ish until those land.
export function experimentalGrokProviderEnabled(): boolean {
  if (isOptOut(process.env.TASKWRAITH_DISABLE_GROK)) return false
  // Legacy var, now interpreted as an explicit opt-OUT only (=0/false/no).
  const legacy = process.env.TASKWRAITH_EXPERIMENTAL_GROK
  if (legacy === '0' || legacy === 'false' || legacy === 'no') return false
  return true
}

function isOptOut(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}

/**
 * 1.0.6-G4 — Sub-gate routing Grok runs through the ACP transport
 * (`grok agent stdio`, bidirectional JSON-RPC) instead of the headless
 * streaming-json path (G3). Default OFF: Grok uses the proven headless path
 * until ACP is soaked. Only meaningful when the provider gate is also on.
 */
export function grokAcpEnabled(): boolean {
  const value = process.env.TASKWRAITH_GROK_ACP
  return value === '1' || value === 'true' || value === 'yes'
}

/**
 * 1.0.72-G5b — Sub-gate that advertises TaskWraith's read-only MCP tools (the
 * non-mutating safe subset: read/list/search + ask_user_question + ensemble
 * coordination) to a READ-ONLY Grok seat over ACP, via a scoped bridge
 * (mcpServers entry launched with --safe-subset).
 *
 * Default OFF — a deliberate seatbelt. The live trace proved Grok auto-runs MCP
 * tools with NO session/request_permission, so the bridge's advertise list +
 * tools/call reject are the ENTIRE safety boundary; this stays gated until that
 * boundary is runtime-verified in a live Grok run. Only meaningful when the
 * provider gate, grokAcpEnabled(), AND settings.geminiMcpBridgeEnabled are on,
 * and only ever attached to a read-only (plan / non-write) seat.
 */
export function grokReadOnlyMcpAdvertiseEnabled(): boolean {
  const value = process.env.TASKWRAITH_GROK_READONLY_MCP
  return value === '1' || value === 'true' || value === 'yes'
}
