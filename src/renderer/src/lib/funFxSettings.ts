import type { AppSettings } from '../../../main/store/types'
import { getStoredGhostCompanionEnabled, getStoredSkyVisualFxEnabled } from './localStorageFlags'

export const isFunFxMode = (value: unknown): value is AppSettings['funFxMode'] =>
  value === 'off' || value === 'subtle' || value === 'cinematic' || value === 'epic'

export const getLegacyFunFxSettingsFromLocalStorage = (): Pick<
  AppSettings,
  'funFxEnabled' | 'funFxMode'
> => {
  const skyEnabled = getStoredSkyVisualFxEnabled()
  const ghostEnabled = getStoredGhostCompanionEnabled()
  if (!skyEnabled && !ghostEnabled) {
    return { funFxEnabled: false, funFxMode: 'off' }
  }

  if (skyEnabled && ghostEnabled) {
    return { funFxEnabled: true, funFxMode: 'cinematic' }
  }

  return { funFxEnabled: true, funFxMode: 'subtle' }
}
