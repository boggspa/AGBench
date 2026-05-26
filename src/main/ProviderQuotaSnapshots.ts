import type { ProviderId } from './store/types'

export interface NormalizedProviderUsageWindow {
  id: string
  label: string
  runs: number
  totalTokens: number
  limitLabel: string
  resetAt?: string
  trackingOnly: boolean
  usedPercent: number
  remainingPercent?: number
  windowKind?: string
  limitWindowSeconds?: number
  resetAfterSeconds?: number
  sourceModelId?: string
}

export interface NormalizedProviderUsageSnapshot {
  provider: ProviderId
  source: string | null
  configured: boolean
  fetchedAt?: string
  windows?: NormalizedProviderUsageWindow[]
  balances?: Array<{
    label: string
    amount: number
    unit: string
    subtitle?: string
    resetAt?: string
  }>
  stale?: boolean
  error?: string
  planType?: string | null
  subscriptionType?: string
  accountId?: string | null
  importedAt?: string
  encryptionAvailable?: boolean
}

export interface CodexUsageCredentialLike {
  accountId?: string | null
  importedAt?: string
}

export interface ClaudeOAuthCredentialLike {
  subscriptionType?: string
}

export function redactAccountId(accountId?: string | null): string | null {
  const raw = String(accountId || '').trim()
  if (!raw) return null
  return raw.length <= 10 ? raw : `${raw.slice(0, 6)}...${raw.slice(-4)}`
}

export function hasProviderUsageSnapshotContent(snapshot: unknown): boolean {
  const record = usageRecord(snapshot)
  return (
    (Array.isArray(record?.windows) && record.windows.length > 0) ||
    (Array.isArray(record?.balances) && record.balances.length > 0)
  )
}

function usageRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null
}

function numericUsageValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function parseIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function normalizeCodexUsageWindow(
  id: string,
  label: string,
  windowKind: string,
  window: any
): NormalizedProviderUsageWindow {
  const usedPercent = clampPercent(Number(window?.used_percent ?? window?.usedPercent ?? 0))
  const remainingPercent = clampPercent(100 - usedPercent)
  const resetAtSeconds = Number(window?.reset_at ?? window?.resetAt ?? 0)
  const resetAfterSeconds = Number(window?.reset_after_seconds ?? window?.resetAfterSeconds ?? 0)
  const limitWindowSeconds = Number(window?.limit_window_seconds ?? window?.limitWindowSeconds ?? 0)
  return {
    id,
    label,
    windowKind,
    runs: 0,
    totalTokens: 0,
    limitLabel: `${Math.round(remainingPercent)}% remaining`,
    resetAt: resetAtSeconds > 0 ? new Date(resetAtSeconds * 1000).toISOString() : undefined,
    trackingOnly: false,
    usedPercent,
    remainingPercent,
    limitWindowSeconds: Number.isFinite(limitWindowSeconds) ? limitWindowSeconds : undefined,
    resetAfterSeconds: Number.isFinite(resetAfterSeconds) ? resetAfterSeconds : undefined
  }
}

function codexUsageWindowIdentity(windowEntry: any): string {
  const label = String(windowEntry?.label || '')
    .trim()
    .toLowerCase()
  const windowKind = String(windowEntry?.windowKind || '')
    .trim()
    .toLowerCase()
  if (label === 'session' || label === '5h') return 'aggregate-session'
  if (label === 'weekly') return 'aggregate-weekly'
  return `${windowKind}:${label}`
}

function dedupeCodexUsageWindows(
  windows: NormalizedProviderUsageWindow[]
): NormalizedProviderUsageWindow[] {
  const seen = new Set<string>()
  return windows.filter((windowEntry) => {
    const key = [
      codexUsageWindowIdentity(windowEntry),
      windowEntry.resetAt || '',
      Math.round(Number(windowEntry.remainingPercent || 0))
    ].join(':')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function codexUsageWindowValue(rateLimit: any, kind: 'primary' | 'secondary') {
  if (!rateLimit || typeof rateLimit !== 'object') return null
  if (kind === 'primary') {
    return (
      rateLimit.primary_window ||
      rateLimit.primaryWindow ||
      rateLimit.primary ||
      rateLimit.five_hour_window ||
      rateLimit.fiveHourWindow ||
      null
    )
  }
  return (
    rateLimit.secondary_window ||
    rateLimit.secondaryWindow ||
    rateLimit.secondary ||
    rateLimit.weekly_window ||
    rateLimit.weeklyWindow ||
    null
  )
}

function codexUsageFraction(windowEntry: NormalizedProviderUsageWindow): number {
  return clampPercent(Number(windowEntry.usedPercent || 0)) / 100
}

function codexResetMs(windowEntry: NormalizedProviderUsageWindow): number | null {
  if (!windowEntry.resetAt) return null
  const ms = new Date(windowEntry.resetAt).getTime()
  return Number.isNaN(ms) ? null : ms
}

function staleAggregateResetShiftThreshold(windowEntry: NormalizedProviderUsageWindow): number {
  const durationMs = Math.max(0, Number(windowEntry.limitWindowSeconds || 0) * 1000)
  if (durationMs <= 0) return 30 * 60 * 1000
  return Math.min(Math.max(durationMs * 0.05, 30 * 60 * 1000), 12 * 60 * 60 * 1000)
}

function isStaleCodexAggregateWindow(
  aggregateWindow: NormalizedProviderUsageWindow,
  additionalWindows: NormalizedProviderUsageWindow[]
): boolean {
  const aggregateTotal = Number(aggregateWindow.limitWindowSeconds || 0)
  const aggregateReset = codexResetMs(aggregateWindow)
  if (
    aggregateTotal <= 0 ||
    aggregateReset === null ||
    codexUsageFraction(aggregateWindow) < 0.98
  ) {
    return false
  }

  const threshold = staleAggregateResetShiftThreshold(aggregateWindow)
  return additionalWindows.some((additionalWindow) => {
    const additionalTotal = Number(additionalWindow.limitWindowSeconds || 0)
    const additionalReset = codexResetMs(additionalWindow)
    return (
      additionalWindow.windowKind === aggregateWindow.windowKind &&
      additionalTotal > 0 &&
      additionalReset !== null &&
      Math.abs(additionalTotal - aggregateTotal) <= Math.max(1, aggregateTotal * 0.05) &&
      codexUsageFraction(additionalWindow) <= 0.2 &&
      additionalReset - aggregateReset >= threshold
    )
  })
}

function reconciledCodexWindows(
  aggregateWindows: NormalizedProviderUsageWindow[],
  additionalWindows: NormalizedProviderUsageWindow[]
): NormalizedProviderUsageWindow[] {
  return [
    ...aggregateWindows.filter(
      (windowEntry) => !isStaleCodexAggregateWindow(windowEntry, additionalWindows)
    ),
    ...additionalWindows
  ]
}

export function normalizeCodexUsagePayload(
  payload: any,
  credential: CodexUsageCredentialLike = {}
): NormalizedProviderUsageSnapshot {
  const aggregateWindows: NormalizedProviderUsageWindow[] = []
  const additionalWindows: NormalizedProviderUsageWindow[] = []
  const rateLimit =
    payload?.rate_limit || payload?.rateLimit || payload?.rate_limits || payload?.rateLimits || {}
  const primaryWindow = codexUsageWindowValue(rateLimit, 'primary')
  const secondaryWindow = codexUsageWindowValue(rateLimit, 'secondary')
  if (primaryWindow) {
    aggregateWindows.push(
      normalizeCodexUsageWindow('primary-5h', 'Session', 'session', primaryWindow)
    )
  }
  if (secondaryWindow) {
    aggregateWindows.push(
      normalizeCodexUsageWindow('secondary-weekly', 'Weekly', 'weekly', secondaryWindow)
    )
  }
  const additional = Array.isArray(payload?.additional_rate_limits)
    ? payload.additional_rate_limits
    : Array.isArray(payload?.additionalRateLimits)
      ? payload.additionalRateLimits
      : []
  additional.forEach((limit: any, index: number) => {
    const rawName =
      String(
        limit?.limit_name ||
          limit?.limitName ||
          limit?.metered_feature ||
          limit?.meteredFeature ||
          'Additional Codex'
      ).trim() || 'Additional Codex'
    const nested = limit?.rate_limit || limit?.rateLimit || {}
    const nestedPrimary = codexUsageWindowValue(nested, 'primary')
    const nestedSecondary = codexUsageWindowValue(nested, 'secondary')
    if (nestedPrimary) {
      additionalWindows.push(
        normalizeCodexUsageWindow(
          `additional-${index}-5h`,
          `${rawName} 5h`,
          'session',
          nestedPrimary
        )
      )
    }
    if (nestedSecondary) {
      additionalWindows.push(
        normalizeCodexUsageWindow(
          `additional-${index}-weekly`,
          `${rawName} Weekly`,
          'weekly',
          nestedSecondary
        )
      )
    }
  })
  const creditBalance = payload?.credits?.balance
  return {
    provider: 'codex',
    configured: true,
    source: 'chatgpt-wham',
    accountId: redactAccountId(credential.accountId),
    importedAt: credential.importedAt,
    fetchedAt: new Date().toISOString(),
    planType: payload?.plan_type || payload?.planType || null,
    windows: dedupeCodexUsageWindows(reconciledCodexWindows(aggregateWindows, additionalWindows)),
    balances:
      creditBalance === undefined || creditBalance === null
        ? []
        : [
            {
              label: 'Credits Remaining',
              amount: Number(creditBalance),
              unit: 'credits'
            }
          ]
  }
}

function kimiDurationLabel(window: unknown): string {
  const record = usageRecord(window)
  const duration = numericUsageValue(record?.duration)
  const unit = String(record?.timeUnit || record?.time_unit || '').toUpperCase()
  if (!duration || !unit) return 'Rolling'
  const rounded = Math.round(duration)
  if (unit.includes('MINUTE')) {
    return rounded % 60 === 0 ? `${Math.round(rounded / 60)}H` : `${rounded}M`
  }
  if (unit.includes('HOUR')) return `${rounded}H`
  if (unit.includes('DAY')) return rounded === 7 ? 'Weekly' : `${rounded}D`
  return 'Rolling'
}

function kimiQuotaWindow(
  id: string,
  label: string,
  detail: unknown
): NormalizedProviderUsageWindow | null {
  const record = usageRecord(detail)
  const limit = numericUsageValue(record?.limit)
  const remaining = numericUsageValue(record?.remaining)
  if (limit === undefined && remaining === undefined) return null
  const used =
    limit !== undefined && remaining !== undefined
      ? Math.max(0, Math.min(limit, limit - remaining))
      : 0
  const usedPercent = limit && limit > 0 ? clampPercent((used / limit) * 100) : 0
  const remainingPercent =
    limit && limit > 0 && remaining !== undefined
      ? clampPercent((remaining / limit) * 100)
      : clampPercent(100 - usedPercent)
  const limitLabel =
    limit && remaining !== undefined
      ? `${Math.round(remaining).toLocaleString()} / ${Math.round(limit).toLocaleString()} remaining`
      : remaining !== undefined
        ? `${Math.round(remaining).toLocaleString()} remaining`
        : `${Math.round(remainingPercent)}% remaining`
  return {
    id,
    label,
    runs: 0,
    totalTokens: 0,
    limitLabel,
    resetAt: parseIsoDate(
      record?.resetTime ?? record?.reset_time ?? record?.resetAt ?? record?.reset_at
    ),
    trackingOnly: false,
    usedPercent,
    remainingPercent
  }
}

export function normalizeKimiUsageSnapshot(payload: unknown): NormalizedProviderUsageSnapshot {
  const record = usageRecord(payload)
  const windows: NormalizedProviderUsageWindow[] = []
  const balances: NormalizedProviderUsageSnapshot['balances'] = []
  const rawLimits = record?.limits
  const limits: unknown[] = Array.isArray(rawLimits) ? rawLimits : []
  limits.forEach((limit, index) => {
    const limitRecord = usageRecord(limit)
    const detail = usageRecord(limitRecord?.detail) ?? limitRecord
    const windowEntry = kimiQuotaWindow(
      `kimi-limit-${index}`,
      kimiDurationLabel(limitRecord?.window),
      detail
    )
    if (windowEntry) windows.push(windowEntry)
  })
  const usage = usageRecord(record?.usage)
  if (usage) {
    const weekly = kimiQuotaWindow('kimi-weekly', 'Weekly', usage)
    if (weekly) windows.push(weekly)
  }
  const totalQuota = usageRecord(record?.totalQuota ?? record?.total_quota)
  const totalRemaining = numericUsageValue(totalQuota?.remaining)
  if (totalRemaining !== undefined) {
    const totalLimit = numericUsageValue(totalQuota?.limit)
    balances.push({
      label: 'Total Quota',
      amount: totalRemaining,
      unit: 'quota',
      subtitle:
        totalLimit !== undefined
          ? `${Math.round(totalLimit).toLocaleString()} total membership quota`
          : undefined
    })
  }
  return {
    provider: 'kimi',
    source: 'kimi-live-usage',
    configured: true,
    fetchedAt: new Date().toISOString(),
    windows,
    balances
  }
}

function claudeUsageWindow(
  id: string,
  label: string,
  payload: any
): NormalizedProviderUsageWindow | null {
  if (!payload || typeof payload !== 'object') return null
  const utilization = numericUsageValue(payload.utilization)
  if (utilization === undefined) return null
  const usedPercent = clampPercent(utilization)
  const remainingPercent = clampPercent(100 - usedPercent)
  return {
    id,
    label,
    runs: 0,
    totalTokens: 0,
    limitLabel: `${Math.round(remainingPercent)}% remaining`,
    resetAt: parseIsoDate(payload.resetAt ?? payload.reset_at),
    trackingOnly: false,
    usedPercent,
    remainingPercent
  }
}

export function normalizeClaudeUsageSnapshot(
  payload: any,
  credential: ClaudeOAuthCredentialLike = {}
): NormalizedProviderUsageSnapshot {
  const windows: NormalizedProviderUsageWindow[] = []
  const balances: NormalizedProviderUsageSnapshot['balances'] = []
  const fiveHour = claudeUsageWindow(
    'claude-5h',
    'Session',
    payload?.fiveHour ?? payload?.five_hour
  )
  if (fiveHour) windows.push(fiveHour)
  const sevenDay = claudeUsageWindow(
    'claude-weekly',
    'Weekly',
    payload?.sevenDay ?? payload?.seven_day
  )
  if (sevenDay) windows.push(sevenDay)
  const sevenDaySonnet = payload?.sevenDaySonnet ?? payload?.seven_day_sonnet
  const sonnetWindow = claudeUsageWindow('claude-weekly-sonnet', 'Sonnet', sevenDaySonnet)
  if (sonnetWindow) windows.push(sonnetWindow)
  const sevenDayOpus = payload?.sevenDayOpus ?? payload?.seven_day_opus
  const opusWindow = claudeUsageWindow('claude-weekly-opus', 'Opus', sevenDayOpus)
  if (opusWindow) windows.push(opusWindow)
  const extraUsage = payload?.extraUsage ?? payload?.extra_usage
  if (Boolean(extraUsage?.isEnabled ?? extraUsage?.is_enabled)) {
    const unit = String(extraUsage?.currency || 'credits')
    const usedCredits = numericUsageValue(extraUsage?.usedCredits ?? extraUsage?.used_credits)
    const monthlyLimit = numericUsageValue(extraUsage?.monthlyLimit ?? extraUsage?.monthly_limit)
    if (usedCredits !== undefined && monthlyLimit !== undefined) {
      balances.push({
        label: 'Extra Usage',
        amount: Math.max(0, monthlyLimit - usedCredits),
        unit,
        subtitle: `${usedCredits.toLocaleString()} of ${monthlyLimit.toLocaleString()} ${unit} used this month`
      })
    } else if (usedCredits !== undefined) {
      balances.push({
        label: 'Extra Usage',
        amount: usedCredits,
        unit,
        subtitle: 'Additional usage this month'
      })
    }
  }
  return {
    provider: 'claude',
    source: 'claude-oauth-usage',
    configured: true,
    subscriptionType: credential.subscriptionType,
    fetchedAt: new Date().toISOString(),
    windows,
    balances
  }
}
