import type { AppSettings } from '../store/types'

export interface SettingsUpdateContext {
  rawPatch: unknown
  sanitizedPatch: Partial<AppSettings>
  previousSettings: AppSettings
  nextSettings: AppSettings
}

export type SettingsUpdateSideEffect = (context: SettingsUpdateContext) => void

export interface SettingsServiceDeps {
  getSettings: () => AppSettings
  updateSettings: (partial: Partial<AppSettings>) => void
  sanitizeSettingsPatch: (partial: unknown) => Partial<AppSettings>
  sideEffects?: SettingsUpdateSideEffect[]
}

/**
 * SettingsService — Phase B7 extraction.
 *
 * Keeps the IPC surface behaviour-preserving while moving settings
 * write policy out of `index.ts`. The service owns the order of
 * operations:
 *   1. sanitize the incoming patch
 *   2. persist it through the injected store
 *   3. run explicit side effects such as update-service reconfiguration
 *
 * Side effects are injected so tests can pin behaviour and future
 * settings-triggered systems can register without growing another IPC
 * closure.
 */
export class SettingsService {
  private readonly sideEffects: SettingsUpdateSideEffect[]

  constructor(private deps: SettingsServiceDeps) {
    this.sideEffects = deps.sideEffects ?? []
  }

  getSettings(): AppSettings {
    return this.deps.getSettings()
  }

  updateSettings(rawPatch: unknown): void {
    const previousSettings = this.deps.getSettings()
    const sanitizedPatch = this.deps.sanitizeSettingsPatch(rawPatch)
    this.deps.updateSettings(sanitizedPatch)
    const nextSettings = this.deps.getSettings()
    const context: SettingsUpdateContext = {
      rawPatch,
      sanitizedPatch,
      previousSettings,
      nextSettings
    }
    for (const sideEffect of this.sideEffects) {
      sideEffect(context)
    }
  }
}
