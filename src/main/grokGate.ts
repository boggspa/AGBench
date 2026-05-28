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
