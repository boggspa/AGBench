import {
  autoUpdater,
  type UpdateCheckResult,
  type UpdateInfo,
  type ProgressInfo
} from 'electron-updater'
import type { ProductUpdateChannel } from './store/types'

/**
 * UpdateService — Phase G2 wrapper around `electron-updater`.
 *
 * Bridges the `updateChannel` user setting (debug / stable / nightly)
 * to electron-updater's channel concept, and exposes a small event
 * surface the renderer can subscribe to via IPC.
 *
 * Default OFF. The service does nothing until `enable()` is called
 * with a non-null channel. The IPC handler in `index.ts` only enables
 * it when:
 *   - The app is packaged (`app.isPackaged`)
 *   - `AGBENCH_AUTO_UPDATE` env is unset OR set to `'on'`
 *     (the negative path: `AGBENCH_AUTO_UPDATE=off` forces it
 *     disabled even in production builds — useful for staging)
 *
 * This lets dev runs (`npm run dev` → not packaged) and tests skip
 * the auto-update behavior entirely without per-environment
 * conditionals scattered everywhere.
 *
 * Channel mapping:
 *   debug   → no auto-updates (treated as disabled)
 *   stable  → `latest` channel (default electron-updater behavior)
 *   nightly → `beta` channel (electron-builder writes a beta
 *             manifest when version contains a pre-release tag)
 *
 * Failure model:
 *   - All electron-updater errors are caught and emitted as
 *     `update-error` events; nothing throws into the caller.
 *   - When disabled, every method is a no-op that returns a stub.
 */

export interface UpdateServiceEvents {
  'update-status-changed': (status: UpdateStatus) => void
  'update-available': (info: UpdateInfo) => void
  'update-not-available': () => void
  'update-error': (message: string) => void
  'update-download-progress': (progress: ProgressInfo) => void
  'update-downloaded': (info: UpdateInfo) => void
}

export type UpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateStateSnapshot {
  status: UpdateStatus
  enabled: boolean
  channel: ProductUpdateChannel
  latestVersion?: string
  downloadProgress?: ProgressInfo
  errorMessage?: string
  /** When the last manual or automatic check was attempted. ISO. */
  lastCheckedAt?: string
}

type Listener = (snapshot: UpdateStateSnapshot) => void

export class UpdateService {
  private channel: ProductUpdateChannel = 'debug'
  private status: UpdateStatus = 'disabled'
  private latestVersion: string | undefined
  private downloadProgress: ProgressInfo | undefined
  private errorMessage: string | undefined
  private lastCheckedAt: string | undefined
  private listeners = new Set<Listener>()
  private wired = false
  private log: (line: string) => void

  constructor(options: { log?: (line: string) => void } = {}) {
    this.log = options.log ?? (() => {})
  }

  /**
   * Configure the service for a given channel + enable/disable state.
   * Called on app startup (after settings load) and whenever the user
   * changes the channel in Settings. Re-calls are idempotent — the
   * underlying autoUpdater is configured once + reconfigured on
   * channel changes.
   *
   * `enabled=false` puts the service in `disabled` status. The user
   * can still inspect the snapshot but no checks will run.
   */
  configure(args: { channel: ProductUpdateChannel; enabled: boolean }): void {
    this.channel = args.channel
    if (!args.enabled || args.channel === 'debug') {
      this.status = 'disabled'
      this.publish()
      return
    }
    if (!this.wired) {
      this.wireAutoUpdater()
      this.wired = true
    }
    // electron-updater channels: 'latest' (stable), 'beta' (nightly),
    // 'alpha' (unused here). The yml manifest is written per-channel
    // by electron-builder's generateUpdatesFilesForAllChannels.
    autoUpdater.channel = args.channel === 'nightly' ? 'beta' : 'latest'
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    this.status = 'idle'
    this.publish()
  }

  /** Trigger a check immediately. Surfaces result via events. */
  async checkForUpdates(): Promise<UpdateCheckResult | null> {
    if (this.status === 'disabled') {
      return null
    }
    this.status = 'checking'
    this.lastCheckedAt = new Date().toISOString()
    this.errorMessage = undefined
    this.publish()
    try {
      const result = await autoUpdater.checkForUpdates()
      // The actual status transition (available / not-available) is
      // driven by the autoUpdater event listeners below; this method
      // returns the raw result for callers that want it.
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.handleError(message)
      return null
    }
  }

  /** Start downloading the staged update. Only valid when status is
   * `'available'`. */
  async downloadUpdate(): Promise<void> {
    if (this.status !== 'available') return
    this.status = 'downloading'
    this.publish()
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      this.handleError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Mark the downloaded update to install on quit. Doesn't quit the
   * app — the renderer should prompt the user, and the user's quit
   * action triggers the install. */
  installOnQuit(): void {
    if (this.status !== 'downloaded') return
    autoUpdater.autoInstallOnAppQuit = true
  }

  /** Immediate install + restart. The renderer should confirm with the
   * user before invoking this. */
  quitAndInstall(): void {
    if (this.status !== 'downloaded') return
    autoUpdater.quitAndInstall()
  }

  snapshot(): UpdateStateSnapshot {
    return {
      status: this.status,
      enabled: this.status !== 'disabled',
      channel: this.channel,
      latestVersion: this.latestVersion,
      downloadProgress: this.downloadProgress,
      errorMessage: this.errorMessage,
      lastCheckedAt: this.lastCheckedAt
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private wireAutoUpdater(): void {
    autoUpdater.logger = {
      info: (msg) => this.log(`[autoUpdater] info: ${msg}`),
      warn: (msg) => this.log(`[autoUpdater] warn: ${msg}`),
      error: (msg) => this.log(`[autoUpdater] error: ${msg}`),
      debug: () => undefined
    }
    autoUpdater.on('checking-for-update', () => {
      this.status = 'checking'
      this.publish()
    })
    autoUpdater.on('update-available', (info) => {
      this.status = 'available'
      this.latestVersion = info.version
      this.publish()
    })
    autoUpdater.on('update-not-available', () => {
      this.status = 'not-available'
      this.publish()
    })
    autoUpdater.on('error', (err) => {
      this.handleError(err instanceof Error ? err.message : String(err))
    })
    autoUpdater.on('download-progress', (progress) => {
      this.status = 'downloading'
      this.downloadProgress = progress
      this.publish()
    })
    autoUpdater.on('update-downloaded', (info) => {
      this.status = 'downloaded'
      this.latestVersion = info.version
      this.downloadProgress = undefined
      this.publish()
    })
  }

  private handleError(message: string): void {
    this.status = 'error'
    this.errorMessage = message
    this.log(`[UpdateService] error: ${message}`)
    this.publish()
  }

  private publish(): void {
    const snap = this.snapshot()
    for (const listener of this.listeners) {
      try {
        listener(snap)
      } catch (err) {
        // Don't let a single bad listener break the rest.
        this.log(
          `[UpdateService] listener threw: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }
}
