import { ipcMain } from 'electron'
import type { FaviconService } from '../services/FaviconService'

/**
 * Outbound shell / URL bridges that let transcript + markdown UI reach
 * outside the renderer sandbox: `shell:open-link`, `shell:reveal-in-finder`,
 * `favicon:getForUrl`. Second slice carved out of the ~21k-line main-process
 * IPC god-module in index.ts; lifted verbatim, behavior unchanged.
 *
 * Unlike the PTY slice these handlers own no module-local state — they are
 * thin delegators — so all three collaborators are injected via
 * {@link ShellHandlerDeps} and stay defined in index.ts:
 *   - `openSafeShellTarget` re-validates the href scheme as a security gate
 *     and has a second caller in index.ts, so it must not move.
 *   - `getFaviconService` returns a lazily-constructed singleton; injecting
 *     the getter (rather than the service) preserves that lazy behavior.
 *
 * `ipcMain` is the same Electron singleton that `installIpcValidation(ipcMain)`
 * patches in index.ts before any registration runs, so every channel below
 * still flows through `validateIpcArgs`. `IpcValidation.test.ts` statically
 * scans `src/main/ipc/*.ts` in addition to index.ts, so these channels' arg
 * schemas stay enforced at build time.
 */
export interface ShellHandlerDeps {
  openSafeShellTarget: (hrefRaw: unknown) => Promise<{ ok: boolean; error?: string }>
  revealPathInFinder: (pathRaw: unknown) => Promise<{ ok: boolean; error?: string }>
  getFaviconService: () => FaviconService
}

export function registerShellHandlers(deps: ShellHandlerDeps): void {
  const { openSafeShellTarget, revealPathInFinder, getFaviconService } = deps

  // Phase K1: safe open-link bridge for transcript markdown clicks.
  // The renderer classifies the href before calling us; main still
  // re-validates the scheme as a security gate because the renderer
  // could be compromised by a future markdown XSS. Whitelist:
  //   - http / https / mailto -> shell.openExternal
  //   - x-apple.systempreferences -> shell.openExternal for local permission setup
  //   - file:// or scheme-less absolute/relative path -> shell.openPath
  //   - everything else (javascript:, data:, ssh:, custom) -> no-op
  ipcMain.handle(
    'shell:open-link',
    async (_event, hrefRaw: unknown): Promise<{ ok: boolean; error?: string }> => {
      return openSafeShellTarget(hrefRaw)
    }
  )
  ipcMain.handle(
    'shell:reveal-in-finder',
    async (_event, pathRaw: unknown): Promise<{ ok: boolean; error?: string }> => {
      return revealPathInFinder(pathRaw)
    }
  )
  ipcMain.handle('favicon:getForUrl', async (_event, hrefRaw: unknown) => {
    return getFaviconService().getForUrl(String(hrefRaw || ''))
  })
}
