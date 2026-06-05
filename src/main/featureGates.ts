export function ensembleWakeupsEnabled(): boolean {
  const value = process.env.TASKWRAITH_ENSEMBLE_WAKEUPS
  return value === '1' || value === 'true' || value === 'yes'
}

export function concurrentLanesEnabled(): boolean {
  const value = process.env.TASKWRAITH_CONCURRENT_LANES
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
