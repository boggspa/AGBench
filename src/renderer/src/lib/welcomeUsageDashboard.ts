import type { ChatRecord, ProviderId, UsageRecord } from '../../../main/store/types'

export type WelcomeUsageTab = 'overview' | 'models'
/**
 * Time-window discriminator for the welcome dashboard. `24h` was added in
 * Welcome L3 alongside the range-toggle UI; `all` is the historical
 * fallback (lifetime aggregate).
 */
export type WelcomeUsageRange = 'all' | '30d' | '7d' | '24h'

export const HEATMAP_DAY_COUNT = 30
export const HEATMAP_HOUR_COUNT = 24

export interface WelcomeUsageDayCell {
  dayKey: string
  label: string
  value: number
  level: number
  isToday: boolean
}

export interface WelcomeUsageHourCell {
  /** Local-time day, formatted as YYYY-MM-DD. */
  dayKey: string
  /** Hour-of-day, 0-23 (local time). */
  hour: number
  /** Display label like "Mar 14 03:00". */
  label: string
  /** Sum of tokens for this hour bucket. */
  totalTokens: number
  /** Per-provider token totals for this hour bucket. */
  providerTotals: Record<ProviderId, number>
  /** Intensity 0..4 (0 = empty, 4 = strongest). */
  level: number
  /** True when this cell corresponds to the current local hour. */
  isCurrentHour: boolean
}

export interface WelcomeUsageModelDatum {
  id: string
  provider: ProviderId
  model: string
  label: string
  runs: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  percent: number
  dailyTotals: Map<string, number>
}

export interface WelcomeUsageDashboardData {
  /**
   * True when the SELECTED RANGE has activity. Drives empty-state
   * copy inside the dashboard ("No activity in the last 24 hours").
   */
  hasActivity: boolean
  /**
   * True when the user has ANY lifetime activity at all. Drives the
   * outer "should the welcome dashboard render?" decision in the
   * renderer — the toggle stays visible even when the current
   * range happens to be empty, so the user can switch ranges from
   * the empty state.
   */
  lifetimeHasActivity: boolean
  sessions: number
  messages: number
  totalTokens: number
  activeDays: number
  currentStreak: number
  longestStreak: number
  peakHour: string
  favoriteModel: string
  providerCount: number
  comparisonText: string
  heatmap: WelcomeUsageDayCell[]
  /**
   * Hourly grid covering the most recent {@link HEATMAP_DAY_COUNT} days × 24
   * hours, ordered chronologically (oldest first, by day then hour). Used by
   * the dense activity grid in the welcome dashboard.
   */
  hourlyHeatmap: WelcomeUsageHourCell[]
  chartDays: Array<{ dayKey: string; label: string; total: number }>
  modelBreakdown: WelcomeUsageModelDatum[]
  maxChartTotal: number
}

const startOfLocalDay = (timestamp: number): number => {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const startOfLocalHour = (timestamp: number): number => {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).getTime()
}

const dayKeyFromTimestamp = (timestamp: number): string => {
  const date = new Date(startOfLocalDay(timestamp))
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const emptyProviderTotals = (): Record<ProviderId, number> => ({
  gemini: 0,
  codex: 0,
  claude: 0,
  kimi: 0
})

const formatHourLabel = (dayKey: string, hour: number): string => {
  const [year, month, day] = dayKey.split('-').map(Number)
  const date = new Date(year, (month || 1) - 1, day || 1, hour)
  const dayLabel = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const hourLabel = date.toLocaleTimeString([], { hour: 'numeric' })
  return `${dayLabel} ${hourLabel}`
}

const formatUsageDateLabel = (dayKey: string): string => {
  const [year, month, day] = dayKey.split('-').map(Number)
  const date = new Date(year, (month || 1) - 1, day || 1)
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export const formatCompactUsageNumber = (value: number): string => {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0)
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(safe >= 10_000_000 ? 0 : 1)}M`
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(safe >= 100_000 ? 0 : 1)}k`
  return String(Math.round(safe))
}

const formatPeakHour = (hour: number): string => {
  if (!Number.isFinite(hour) || hour < 0) return 'n/a'
  const normalized = ((Math.round(hour) % 24) + 24) % 24
  const suffix = normalized >= 12 ? 'PM' : 'AM'
  const display = normalized % 12 || 12
  return `${display} ${suffix}`
}

const inferProviderFromModelName = (model: string): ProviderId => {
  const normalized = model.toLowerCase()
  if (
    normalized.includes('claude') ||
    normalized.includes('opus') ||
    normalized.includes('sonnet') ||
    normalized.includes('haiku')
  )
    return 'claude'
  if (normalized.includes('kimi') || normalized.includes('moonshot') || normalized.includes('k2'))
    return 'kimi'
  if (
    normalized.includes('codex') ||
    normalized.includes('gpt') ||
    normalized.includes('o3') ||
    normalized.includes('o4') ||
    normalized.includes('o5')
  )
    return 'codex'
  return 'gemini'
}

const getWelcomeUsageRangeCutoff = (range: WelcomeUsageRange, now: number): number => {
  if (range === '24h') return now - 24 * 60 * 60 * 1000
  if (range === '7d') return now - 7 * 24 * 60 * 60 * 1000
  if (range === '30d') return now - 30 * 24 * 60 * 60 * 1000
  return 0
}

const getWelcomeUsageHeatmapDayCount = (range: WelcomeUsageRange): number => {
  if (range === '24h') return 2
  if (range === '7d') return 7
  if (range === '30d') return 30
  return 84
}

/**
 * Number of bars in the Models-tab chart. Welcome L3 widens this from the
 * historical fixed 6-day default so the bars normalise against the
 * caller-selected range — empty windows now mean genuine inactivity in the
 * chosen period instead of "your spike was outside the visible 6 days".
 * 24h falls back to 2 columns (yesterday + today) because a single bar
 * looks broken; for finer-grain 24h work, Welcome L6 will add hour-of-day
 * bucketing as a separate render path.
 */
const getWelcomeUsageChartDayCount = (range: WelcomeUsageRange): number => {
  if (range === '24h') return 2
  if (range === '7d') return 7
  if (range === '30d') return 30
  return 30
}

export const buildWelcomeUsageDashboardData = (
  records: UsageRecord[],
  chats: ChatRecord[],
  range: WelcomeUsageRange,
  now = Date.now()
): WelcomeUsageDashboardData => {
  const cutoff = getWelcomeUsageRangeCutoff(range, now)
  const runRecords = records
    .filter((record) => record.usageKind !== 'reset_hint')
    .filter((record) => record.timestamp >= cutoff)
  const messageEvents = chats.flatMap((chat) =>
    (chat.messages || [])
      .map((message) => {
        const timestamp = new Date(message.timestamp || '').getTime()
        return {
          chatId: chat.appChatId,
          timestamp
        }
      })
      .filter((event) => Number.isFinite(event.timestamp) && event.timestamp >= cutoff)
  )

  // Welcome L5 — streaks stay all-time. Current/longest-streak are
  // lifetime metrics; computing them off the range-filtered day set
  // would collapse the user's actual streak (e.g. 24h window → max
  // longest-streak is 1 day, no matter the actual usage history).
  // Build a separate "lifetime" active-day set from the unfiltered
  // records + chats so the streak computation always sees the full
  // calendar of activity even when the rest of the dashboard is
  // showing 24h / 7d / 30d.
  const lifetimeActiveDayKeys = new Set<string>()
  for (const record of records) {
    if (record.usageKind === 'reset_hint') continue
    lifetimeActiveDayKeys.add(dayKeyFromTimestamp(record.timestamp))
  }
  for (const chat of chats) {
    for (const message of chat.messages || []) {
      const ts = new Date(message.timestamp || '').getTime()
      if (Number.isFinite(ts)) lifetimeActiveDayKeys.add(dayKeyFromTimestamp(ts))
    }
  }

  const activeDayKeys = new Set<string>()
  const sessionIds = new Set<string>()
  const providerIds = new Set<ProviderId>()
  const hourlyTotals = new Array(24).fill(0) as number[]
  const dailyTotals = new Map<string, number>()
  const modelMap = new Map<string, WelcomeUsageModelDatum>()
  /**
   * Hourly buckets keyed by the local-time hour start (ms epoch). We bucket
   * usage records here so the dense 30×24 welcome heatmap can render
   * provider-coloured intensity without re-scanning records in the component.
   */
  const hourBuckets = new Map<
    number,
    { totalTokens: number; providerTotals: Record<ProviderId, number> }
  >()

  for (const event of messageEvents) {
    activeDayKeys.add(dayKeyFromTimestamp(event.timestamp))
    sessionIds.add(event.chatId)
  }

  for (const record of runRecords) {
    const provider = record.provider || inferProviderFromModelName(record.model || '')
    const model = record.model || 'unknown'
    const totalTokens = Math.max(
      0,
      Number(record.totalTokens || record.inputTokens + record.outputTokens || 0)
    )
    const inputTokens = Math.max(0, Number(record.inputTokens || 0))
    const outputTokens = Math.max(0, Number(record.outputTokens || 0))
    const dayKey = dayKeyFromTimestamp(record.timestamp)
    const hour = new Date(record.timestamp).getHours()
    const modelId = `${provider}:${model}`

    activeDayKeys.add(dayKey)
    sessionIds.add(record.chatId)
    providerIds.add(provider)
    hourlyTotals[hour] += totalTokens || 1
    dailyTotals.set(dayKey, (dailyTotals.get(dayKey) || 0) + totalTokens)

    const hourStart = startOfLocalHour(record.timestamp)
    const bucket = hourBuckets.get(hourStart) || {
      totalTokens: 0,
      providerTotals: emptyProviderTotals()
    }
    // Use raw token count when present; otherwise count the run as a single
    // unit so the cell still shows activity even for usage records that lack
    // explicit token totals (mirrors the existing hourlyTotals heuristic).
    const cellWeight = totalTokens || 1
    bucket.totalTokens += cellWeight
    bucket.providerTotals[provider] += cellWeight
    hourBuckets.set(hourStart, bucket)

    const existing = modelMap.get(modelId) || {
      id: modelId,
      provider,
      model,
      label: model,
      runs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      percent: 0,
      dailyTotals: new Map<string, number>()
    }
    existing.runs += 1
    existing.inputTokens += inputTokens
    existing.outputTokens += outputTokens
    existing.totalTokens += totalTokens
    existing.dailyTotals.set(dayKey, (existing.dailyTotals.get(dayKey) || 0) + totalTokens)
    modelMap.set(modelId, existing)
  }

  const totalTokens = runRecords.reduce(
    (sum, record) =>
      sum +
      Math.max(0, Number(record.totalTokens || record.inputTokens + record.outputTokens || 0)),
    0
  )
  // Welcome L4 — model breakdown is range-scoped, not lifetime.
  // `modelMap` is built from `runRecords` which is already filtered by
  // the `range` cutoff (line above this comment block in the source).
  // Both the numerator (model.totalTokens) and the denominator
  // (totalTokens) come from the same filtered set, so `percent`
  // describes the model's share of activity inside the selected
  // window. When the window has no activity, the breakdown is `[]`
  // rather than a list of 0%-models — see the L4 unit tests.
  const modelBreakdown = Array.from(modelMap.values())
    .sort((a, b) => b.totalTokens - a.totalTokens || b.runs - a.runs)
    .map((model) => ({
      ...model,
      percent: totalTokens > 0 ? (model.totalTokens / totalTokens) * 100 : 0
    }))

  const todayStart = startOfLocalDay(now)
  // Welcome L5 — streaks read from the LIFETIME day set so 24h / 7d /
  // 30d views still show the user's real all-time current + longest
  // streak. (`activeDayKeys` above is range-filtered and drives the
  // sessions/messages/active-days/peak-hour stats below.)
  const lifetimeDayStarts = Array.from(lifetimeActiveDayKeys)
    .map((key) => new Date(`${key}T00:00:00`).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  const lifetimeStartSet = new Set(lifetimeDayStarts)
  const countStreakEndingAt = (start: number): number => {
    let count = 0
    for (let cursor = start; lifetimeStartSet.has(cursor); cursor -= 24 * 60 * 60 * 1000) {
      count += 1
    }
    return count
  }
  const currentStreak =
    countStreakEndingAt(todayStart) || countStreakEndingAt(todayStart - 24 * 60 * 60 * 1000)
  let longestStreak = 0
  let runningStreak = 0
  let previousDay = -1
  for (const day of lifetimeDayStarts) {
    runningStreak =
      previousDay > 0 && day - previousDay === 24 * 60 * 60 * 1000 ? runningStreak + 1 : 1
    longestStreak = Math.max(longestStreak, runningStreak)
    previousDay = day
  }

  const peakHour = hourlyTotals.reduce(
    (best, value, hour) => (value > hourlyTotals[best] ? hour : best),
    0
  )
  const heatmapDayCount = getWelcomeUsageHeatmapDayCount(range)
  const heatmapStart = todayStart - (heatmapDayCount - 1) * 24 * 60 * 60 * 1000
  const maxDayValue = Math.max(1, ...Array.from(dailyTotals.values()))
  const heatmap = Array.from({ length: heatmapDayCount }, (_, index) => {
    const timestamp = heatmapStart + index * 24 * 60 * 60 * 1000
    const dayKey = dayKeyFromTimestamp(timestamp)
    const value = dailyTotals.get(dayKey) || 0
    return {
      dayKey,
      label: formatUsageDateLabel(dayKey),
      value,
      level: value <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((value / maxDayValue) * 4))),
      isToday: timestamp === todayStart
    }
  })

  // Build the dense 30-day × 24-hour grid. The grid is anchored on the current
  // local hour so the most recent activity occupies the last cell. The grid is
  // returned in chronological order (oldest first), giving the renderer a
  // flat list it can slot into a fixed-size CSS grid.
  const nowHourStart = startOfLocalHour(now)
  const oneHour = 60 * 60 * 1000
  const hourlyHeatmapTotalCells = HEATMAP_DAY_COUNT * HEATMAP_HOUR_COUNT
  const hourlyHeatmapStart = nowHourStart - (hourlyHeatmapTotalCells - 1) * oneHour
  let maxHourlyValue = 0
  for (let index = 0; index < hourlyHeatmapTotalCells; index += 1) {
    const cellStart = hourlyHeatmapStart + index * oneHour
    const bucket = hourBuckets.get(cellStart)
    if (bucket && bucket.totalTokens > maxHourlyValue) maxHourlyValue = bucket.totalTokens
  }
  const hourlyHeatmap: WelcomeUsageHourCell[] = Array.from(
    { length: hourlyHeatmapTotalCells },
    (_, index) => {
      const cellStart = hourlyHeatmapStart + index * oneHour
      const cellDate = new Date(cellStart)
      const dayKey = dayKeyFromTimestamp(cellStart)
      const hour = cellDate.getHours()
      const bucket = hourBuckets.get(cellStart)
      const total = bucket?.totalTokens || 0
      const providerTotals = bucket ? { ...bucket.providerTotals } : emptyProviderTotals()
      const level =
        total <= 0
          ? 0
          : maxHourlyValue > 0
            ? Math.max(1, Math.min(4, Math.ceil((total / maxHourlyValue) * 4)))
            : 1
      return {
        dayKey,
        hour,
        label: formatHourLabel(dayKey, hour),
        totalTokens: total,
        providerTotals,
        level,
        isCurrentHour: cellStart === nowHourStart
      }
    }
  )

  // Welcome L3: chart day count now follows the selected range so bars
  // normalise against the active window (not a hardcoded 6 days). For
  // ranges with explicit cutoffs (24h / 7d / 30d) we anchor the chart on
  // today and walk backwards, filling empty days as zero. `all` keeps the
  // historical "active-days-only" behaviour but widens the cap to 30 so
  // a busy week doesn't get cropped to 6 columns.
  const chartDayCount = getWelcomeUsageChartDayCount(range)
  const consecutiveChartDays = Array.from({ length: chartDayCount }, (_, index) =>
    dayKeyFromTimestamp(todayStart - (chartDayCount - 1 - index) * 24 * 60 * 60 * 1000)
  )
  const activeChartDays = Array.from(dailyTotals.keys()).sort().slice(-chartDayCount)
  const chartDayKeys =
    range === 'all'
      ? activeChartDays.length >= Math.min(2, chartDayCount)
        ? activeChartDays
        : consecutiveChartDays
      : consecutiveChartDays
  const chartDays = chartDayKeys.map((dayKey) => ({
    dayKey,
    label: formatUsageDateLabel(dayKey),
    total: dailyTotals.get(dayKey) || 0
  }))
  const maxChartTotal = Math.max(1, ...chartDays.map((day) => day.total))
  const favoriteModel = modelBreakdown[0]?.label || 'n/a'
  const hasActivity = runRecords.length > 0 || messageEvents.length > 0
  // Welcome L6 — lifetime "has any activity ever" flag. Used by the
  // renderer to decide whether to mount the dashboard at all. Without
  // this, a 24h range that happens to be empty would unmount the
  // dashboard wholesale and the user would lose access to the toggle
  // even though their lifetime history is rich.
  const lifetimeHasActivity =
    records.some((record) => record.usageKind !== 'reset_hint') ||
    chats.some((chat) => (chat.messages || []).length > 0)

  return {
    hasActivity,
    lifetimeHasActivity,
    sessions: sessionIds.size,
    messages: messageEvents.length || runRecords.length * 2,
    totalTokens,
    activeDays: activeDayKeys.size,
    currentStreak,
    longestStreak,
    peakHour: runRecords.length > 0 ? formatPeakHour(peakHour) : 'n/a',
    favoriteModel,
    providerCount: providerIds.size,
    comparisonText: hasActivity
      ? `You've tracked ${formatCompactUsageNumber(totalTokens)} tokens across ${providerIds.size || 1} provider${(providerIds.size || 1) === 1 ? '' : 's'}.`
      : 'Start a provider run to seed workspace activity stats.',
    heatmap,
    hourlyHeatmap,
    chartDays,
    modelBreakdown,
    maxChartTotal
  }
}

/**
 * Mix provider colours weighted by token share. Returns a CSS colour string
 * suitable for use as a chip background. Empty input returns an empty string,
 * letting the caller fall back to the default empty-cell background.
 */
export const mixProviderColors = (
  providerTotals: Record<ProviderId, number>,
  providerColors: Record<ProviderId, string>
): string => {
  const entries = (Object.keys(providerTotals) as ProviderId[])
    .map((provider) => ({ provider, weight: providerTotals[provider] }))
    .filter(({ weight }) => weight > 0)
  if (entries.length === 0) return ''
  const totalWeight = entries.reduce((sum, item) => sum + item.weight, 0)
  if (totalWeight <= 0) return ''
  if (entries.length === 1) {
    return providerColors[entries[0].provider]
  }
  // color-mix only takes two colours at a time so we fold left, mixing each
  // additional colour by its share of the *remaining* weight. This gives a
  // weighted average without depending on a runtime RGB parser.
  let accumulatedWeight = entries[0].weight
  let blend = `${providerColors[entries[0].provider]}`
  for (let i = 1; i < entries.length; i += 1) {
    const next = entries[i]
    const nextWeight = next.weight
    const blendWeight = accumulatedWeight
    accumulatedWeight += nextWeight
    const blendPercent = Math.round((blendWeight / accumulatedWeight) * 100)
    const nextPercent = 100 - blendPercent
    blend = `color-mix(in srgb, ${blend} ${blendPercent}%, ${providerColors[next.provider]} ${nextPercent}%)`
  }
  return blend
}
