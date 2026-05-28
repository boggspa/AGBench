// 1.0.6-G — Single source of truth for the internal Grok experimental gate.
//
// Pure (reads only process.env), so it can be imported by both the
// Electron-heavy index.ts AND the lower-level validation modules
// (IpcValidation, ChatService, ComposerService) without an import cycle.
//
// Default OFF: with AGBENCH_EXPERIMENTAL_GROK unset, 'grok' is a valid
// ProviderId at the type level but is rejected at every trust boundary (the
// IPC PROVIDERS accept-set, assertProviderId, the provider-adapter registry)
// and appears in no user-visible list — so the gate-off state is structurally
// inert. Set the flag to enable the gated, read-only Grok runtime (G3).
export function experimentalGrokProviderEnabled(): boolean {
  const value = process.env.AGBENCH_EXPERIMENTAL_GROK
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
