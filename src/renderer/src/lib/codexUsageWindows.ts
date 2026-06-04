import type { UsageRecord } from '../../../main/store/types'
import type { UsageWindowAggregate } from './usageAggregateTypes'

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

const getCodexFiveHourLimit = (model: string): { max?: number; label: string } => {
  const normalized = model.toLowerCase()
  if (normalized.includes('spark')) return { label: 'separate dynamic limit' }
  if (normalized.includes('5.3') && normalized.includes('codex'))
    return { max: 3000, label: '30-3000 msgs / 5h' }
  if (normalized.includes('5.4-mini') || normalized.includes('mini'))
    return { max: 7000, label: '60-7000 msgs / 5h' }
  if (normalized.includes('5.4')) return { max: 2000, label: '20-2000 msgs / 5h' }
  if (normalized.includes('5.5')) return { max: 1600, label: '15-1600 msgs / 5h' }
  return { label: 'plan-dependent / 5h' }
}

const labelCodexRateLimitBucket = (snapshot: any, model: string): string => {
  const duration = Number(snapshot?.primary?.windowDurationMins || 0)
  const rawName = String(snapshot?.limitName || snapshot?.limitId || '').trim()
  const isSpark = /spark/i.test(rawName) || model.toLowerCase().includes('spark')

  if (duration >= 295 && duration <= 305) return isSpark ? 'Spark 5h' : '5h'
  if (duration >= 10020 && duration <= 10140) return isSpark ? 'Spark weekly' : 'Weekly'
  if (duration > 0 && duration < 120) return rawName || `${duration}m`
  return rawName || 'Codex quota'
}

const isCodexSparkQuotaLabel = (label: string): boolean => /spark|gpt-5\.3-codex-spark/i.test(label)

const codexQuotaIdentityLabel = (label: string): string => {
  const normalized = label.toLowerCase().replace(/\s+/g, ' ').trim()
  if (normalized === 'session' || normalized === '5h' || normalized === '5 h') return '5h'
  if (normalized === 'weekly' || normalized === '7-day') return 'weekly'
  return normalized
}

const codexQuotaDisplayLabel = (label: string): string => {
  const normalized = label.toLowerCase().replace(/\s+/g, ' ').trim()
  if (normalized === 'session' || normalized === '5h' || normalized === '5 h') return '5h'
  if (normalized === 'weekly' || normalized === '7-day') return 'Weekly'
  return label
}

const codexQuotaDisplayOrder = (label: string): number => {
  const identity = codexQuotaIdentityLabel(label)
  if (identity === '5h') return 0
  if (identity === 'weekly') return 1
  const weekly = identity.includes('weekly') || identity.includes('7-day')
  const spark = isCodexSparkQuotaLabel(label)
  if (spark && !weekly) return 2
  if (spark && weekly) return 3
  return weekly ? 5 : 4
}

const dedupeCodexQuotaWindows = (windows: UsageWindowAggregate[]): UsageWindowAggregate[] => {
  const seen = new Set<string>()
  return windows.filter((windowEntry) => {
    const key = [
      codexQuotaIdentityLabel(windowEntry.label),
      windowEntry.resetAt || '',
      Math.round(Number(windowEntry.usedPercent || 0))
    ].join(':')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const buildRateLimitWindow = (
  id: string,
  label: string,
  snapshot: any
): UsageWindowAggregate | null => {
  const primary = snapshot?.primary
  if (!primary) return null
  const usedPercent = Math.max(0, Math.min(100, Number(primary.usedPercent || 0)))
  const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent))
  return {
    id,
    label,
    runs: 0,
    totalTokens: 0,
    limitLabel: `${Math.round(remainingPercent)}% remaining`,
    resetAt: primary.resetsAt ? new Date(primary.resetsAt * 1000).toISOString() : undefined,
    trackingOnly: true,
    // Honest names: usedPercent = USED, remainingPercent = REMAINING.
    // (Earlier this code stored `remainingPercent` in `usedPercent`
    // because the bar visualised "available capacity"; the L6
    // follow-up flips the bar to fill with USAGE and updates the
    // naming to match.)
    usedPercent,
    remainingPercent
  }
}

const buildCodexUsageWindows = (
  records: UsageRecord[],
  model: string,
  now: number,
  codexStatus?: any,
  showAuthoritativeWindows = true
): UsageWindowAggregate[] => {
  const authoritativeWindows = Array.isArray(codexStatus?.codexUsage?.windows)
    ? codexStatus.codexUsage.windows
    : []
  if (authoritativeWindows.length > 0) {
    if (!showAuthoritativeWindows) {
      return []
    }
    return dedupeCodexQuotaWindows(
      authoritativeWindows.map((windowEntry: any, index: number) => {
        const label = codexQuotaDisplayLabel(String(windowEntry.label || 'Codex quota'))
        const remainingPercent = Math.max(
          0,
          Math.min(
            100,
            Number(windowEntry.remainingPercent ?? 100 - Number(windowEntry.usedPercent || 0))
          )
        )
        const usedPercent = Math.max(0, Math.min(100, 100 - remainingPercent))
        return {
          id: `codex-account-${windowEntry.id || index}`,
          label,
          runs: 0,
          totalTokens: 0,
          limitLabel: windowEntry.limitLabel || `${Math.round(remainingPercent)}% remaining`,
          resetAt: windowEntry.resetAt,
          trackingOnly: false,
          // Honest names: usedPercent = USED, remainingPercent = REMAINING.
          usedPercent,
          remainingPercent
        }
      })
    ).sort((a, b) => {
      return codexQuotaDisplayOrder(a.label) - codexQuotaDisplayOrder(b.label)
    })
  }

  const rateLimitBuckets = [
    ...(codexStatus?.rateLimits ? [codexStatus.rateLimits] : []),
    ...(codexStatus?.rateLimitsByLimitId && typeof codexStatus.rateLimitsByLimitId === 'object'
      ? Object.values(codexStatus.rateLimitsByLimitId)
      : [])
  ]
  const realRateLimitWindows = dedupeCodexQuotaWindows(
    rateLimitBuckets
      .flatMap((bucket: any, index: number) => {
        const id = bucket?.limitId || bucket?.limitName || index
        const windows: Array<UsageWindowAggregate | null> = [
          buildRateLimitWindow(
            `account-${id}-primary`,
            labelCodexRateLimitBucket(bucket, model),
            bucket
          )
        ]
        if (bucket?.secondary) {
          const secondaryBucket = { ...bucket, primary: bucket.secondary }
          windows.push(
            buildRateLimitWindow(
              `account-${id}-secondary`,
              labelCodexRateLimitBucket(secondaryBucket, model),
              secondaryBucket
            )
          )
        }
        return windows
      })
      .filter(Boolean)
      .map((windowEntry: any) => ({
        ...windowEntry,
        label: codexQuotaDisplayLabel(windowEntry.label)
      }))
      .filter(Boolean) as UsageWindowAggregate[]
  )

  if (realRateLimitWindows.length > 0) {
    return realRateLimitWindows.sort((a, b) => {
      return codexQuotaDisplayOrder(a.label) - codexQuotaDisplayOrder(b.label)
    })
  }

  const fiveHourLimit = getCodexFiveHourLimit(model)
  const fiveHourRecords = records.filter(
    (record) => now - record.timestamp <= FIVE_HOURS_MS && record.usageKind !== 'reset_hint'
  )
  const weeklyRecords = records.filter(
    (record) => now - record.timestamp <= WEEK_MS && record.usageKind !== 'reset_hint'
  )
  const fiveHourReset =
    fiveHourRecords.length > 0
      ? new Date(
          Math.min(...fiveHourRecords.map((record) => record.timestamp + FIVE_HOURS_MS))
        ).toISOString()
      : undefined
  const weeklyReset =
    weeklyRecords.length > 0
      ? new Date(
          Math.min(...weeklyRecords.map((record) => record.timestamp + WEEK_MS))
        ).toISOString()
      : undefined

  return [
    ...realRateLimitWindows,
    {
      id: '5h',
      label: model.toLowerCase().includes('spark') ? 'Spark 5h' : '5h',
      runs: fiveHourRecords.length,
      totalTokens: fiveHourRecords.reduce((total, record) => total + (record.totalTokens || 0), 0),
      runLimitMax: fiveHourLimit.max,
      limitLabel: fiveHourLimit.label,
      resetAt: fiveHourReset,
      trackingOnly: !fiveHourLimit.max
    },
    {
      id: 'weekly',
      label: model.toLowerCase().includes('spark') ? 'Spark weekly' : 'Weekly',
      runs: weeklyRecords.length,
      totalTokens: weeklyRecords.reduce((total, record) => total + (record.totalTokens || 0), 0),
      limitLabel: model.toLowerCase().includes('spark')
        ? 'separate dynamic weekly cap'
        : 'weekly cap may apply',
      resetAt: weeklyReset,
      trackingOnly: true
    }
  ]
}

export {
  FIVE_HOURS_MS,
  WEEK_MS,
  getCodexFiveHourLimit,
  labelCodexRateLimitBucket,
  isCodexSparkQuotaLabel,
  codexQuotaIdentityLabel,
  codexQuotaDisplayLabel,
  codexQuotaDisplayOrder,
  dedupeCodexQuotaWindows,
  buildRateLimitWindow,
  buildCodexUsageWindows
}
