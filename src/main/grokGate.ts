// 1.0.6-G — Single source of truth for the internal Grok experimental gate.
//
// Pure (reads only process.env), so it can be imported by both the
// Electron-heavy index.ts AND the lower-level validation modules
// (IpcValidation, ChatService, ComposerService) without an import cycle.
//
// 1.0.6 — Grok is now a FIRST-CLASS provider (the experimental gate has been
// lifted): it is accepted at every trust boundary and appears in the normal
// provider surfaces by default. An emergency kill-switch remains — set
// AGBENCH_DISABLE_GROK=1 (or AGBENCH_EXPERIMENTAL_GROK=0) to force it off,
// e.g. for a regression triage. NOTE: native tool execution (Read/shell/edit
// mediated through the approval ledger) is still pending G5, and session
// persistence is pending G6, so Grok runs read-only-ish until those land.
export function experimentalGrokProviderEnabled(): boolean {
  if (isOptOut(process.env.AGBENCH_DISABLE_GROK)) return false
  // Legacy var, now interpreted as an explicit opt-OUT only (=0/false/no).
  const legacy = process.env.AGBENCH_EXPERIMENTAL_GROK
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
  const value = process.env.AGBENCH_GROK_ACP
  return value === '1' || value === 'true' || value === 'yes'
}
