export function ensembleWakeupsEnabled(): boolean {
  const value = process.env.TASKWRAITH_ENSEMBLE_WAKEUPS
  return value === '1' || value === 'true' || value === 'yes'
}

export function concurrentLanesEnabled(): boolean {
  const value = process.env.TASKWRAITH_CONCURRENT_LANES
  return value === '1' || value === 'true' || value === 'yes'
}

export function concurrentWriteLanesEnabled(): boolean {
  const value = process.env.TASKWRAITH_CONCURRENT_WRITE_LANES
  return value === '1' || value === 'true' || value === 'yes'
}

export function permissionEnvelopesEnabled(): boolean {
  const value = process.env.TASKWRAITH_PERMISSION_ENVELOPES
  return value === '1' || value === 'true' || value === 'yes'
}

export function composerContenteditableEnabled(): boolean {
  const value = process.env.TASKWRAITH_COMPOSER_CONTENTEDITABLE
  return value === '1' || value === 'true' || value === 'yes'
}

export function messagesBridgeEnabled(input?: {
  isPackaged?: boolean
  appName?: string
}): boolean {
  const disabled = process.env.TASKWRAITH_MESSAGES_BRIDGE === '0'
  if (disabled) return false
  const isPackaged = Boolean(input?.isPackaged)
  if (!isPackaged) return true
  return /\bdebug\b/i.test(input?.appName || '')
}
