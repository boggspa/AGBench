export function ensembleWakeupsEnabled(): boolean {
  const value = process.env.TASKWRAITH_ENSEMBLE_WAKEUPS
  return value === '1' || value === 'true' || value === 'yes'
}

import { buildRuntimeFeatureGateSnapshot } from '../shared/runtimeFeatureGates'

export function concurrentLanesEnabled(): boolean {
  return buildRuntimeFeatureGateSnapshot(process.env).concurrentLanes
}

export function concurrentWriteLanesEnabled(): boolean {
  return buildRuntimeFeatureGateSnapshot(process.env).concurrentWriteLanes
}

export function composerContenteditableEnabled(): boolean {
  const value = process.env.TASKWRAITH_COMPOSER_CONTENTEDITABLE
  return value === '1' || value === 'true' || value === 'yes'
}

export function channelGatewayEnabled(input?: {
  isPackaged?: boolean
  appName?: string
}): boolean {
  const disabled = process.env.TASKWRAITH_MESSAGES_BRIDGE === '0'
  if (disabled) return false
  const isPackaged = Boolean(input?.isPackaged)
  if (!isPackaged) return true
  return /\bdebug\b/i.test(input?.appName || '')
}

export const messagesBridgeEnabled = channelGatewayEnabled
