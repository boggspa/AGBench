export type BridgeDaemonEnvOverride = 'force-on' | 'force-off' | null

export interface BridgeDaemonResolution {
  shouldRun: boolean
  settingEnabled: boolean
  envOverride: BridgeDaemonEnvOverride
  source: 'environment' | 'settings'
}

export function resolveDaemonShouldRun(
  settingEnabled: boolean | undefined,
  envValue: string | undefined
): BridgeDaemonResolution {
  const normalizedEnv = typeof envValue === 'string' ? envValue.trim().toLowerCase() : ''
  const resolvedSetting = settingEnabled !== false

  if (normalizedEnv === '1' || normalizedEnv === 'true') {
    return {
      shouldRun: true,
      settingEnabled: resolvedSetting,
      envOverride: 'force-on',
      source: 'environment'
    }
  }

  if (normalizedEnv === '0' || normalizedEnv === 'false') {
    return {
      shouldRun: false,
      settingEnabled: resolvedSetting,
      envOverride: 'force-off',
      source: 'environment'
    }
  }

  return {
    shouldRun: resolvedSetting,
    settingEnabled: resolvedSetting,
    envOverride: null,
    source: 'settings'
  }
}
