import type { ChatRecord, ProviderId, UsageRecord } from '../../../main/store/types'

export type WelcomeUsageTab = 'overview' | 'models'
export type WelcomeUsageRange = 'all' | '30d' | '7d'

export interface WelcomeUsageDayCell {
  dayKey: string
  label: string
  value: number
  level: number
  isToday: boolean
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
  hasActivity: boolean
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
  chartDays: Array<{ dayKey: string; label: string; total: number }>
  modelBreakdown: WelcomeUsageModelDatum[]
  maxChartTotal: number
}

const startOfLocalDay = (timestamp: number): number => {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const dayKeyFromTimestamp = (timestamp: number): string => {
  const date = new Date(startOfLocalDay(timestamp))
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
  if (normalized.includes('claude') || normalized.includes('opus') || normalized.includes('sonnet') || normalized.includes('haiku')) return 'claude'
  if (normalized.includes('kimi') || normalized.includes('moonshot') || normalized.includes('k2')) return 'kimi'
  if (normalized.includes('codex') || normalized.includes('gpt') || normalized.includes('o3') || normalized.includes('o4') || normalized.includes('o5')) return 'codex'
  return 'gemini'
}

const getWelcomeUsageRangeCutoff = (range: WelcomeUsageRange, now: number): number => {
  if (range === '7d') return now - 7 * 24 * 60 * 60 * 1000
  if (range === '30d') return now - 30 * 24 * 60 * 60 * 1000
  return 0
}

const getWelcomeUsageHeatmapDayCount = (range: WelcomeUsageRange): number => {
  if (range === '7d') return 7
  if (range === '30d') return 30
  return 84
}

export const buildWelcomeUsageDashboardData = (
  records: UsageRecord[],
  chats: ChatRecord[],
  range: WelcomeUsageRange,
  now = Date.now()
): WelcomeUsageDashboardData => {
  const cutoff = getWelcomeUsageRangeCutoff(range, now)
  const runRecords = records
    .filter(record => record.usageKind !== 'reset_hint')
    .filter(record => record.timestamp >= cutoff)
  const messageEvents = chats.flatMap((chat) =>
    (chat.messages || [])
      .map((message) => {
        const timestamp = new Date(message.timestamp || '').getTime()
        return {
          chatId: chat.appChatId,
          timestamp
        }
      })
      .filter(event => Number.isFinite(event.timestamp) && event.timestamp >= cutoff)
  )

  const activeDayKeys = new Set<string>()
  const sessionIds = new Set<string>()
  const providerIds = new Set<ProviderId>()
  const hourlyTotals = new Array(24).fill(0) as number[]
  const dailyTotals = new Map<string, number>()
  const modelMap = new Map<string, WelcomeUsageModelDatum>()

  for (const event of messageEvents) {
    activeDayKeys.add(dayKeyFromTimestamp(event.timestamp))
    sessionIds.add(event.chatId)
  }

  for (const record of runRecords) {
    const provider = record.provider || inferProviderFromModelName(record.model || '')
    const model = record.model || 'unknown'
    const totalTokens = Math.max(0, Number(record.totalTokens || record.inputTokens + record.outputTokens || 0))
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

  const totalTokens = runRecords.reduce((sum, record) => sum + Math.max(0, Number(record.totalTokens || record.inputTokens + record.outputTokens || 0)), 0)
  const modelBreakdown = Array.from(modelMap.values())
    .sort((a, b) => b.totalTokens - a.totalTokens || b.runs - a.runs)
    .map(model => ({
      ...model,
      percent: totalTokens > 0 ? (model.totalTokens / totalTokens) * 100 : 0
    }))

  const todayStart = startOfLocalDay(now)
  const activeDayStarts = Array.from(activeDayKeys)
    .map(key => new Date(`${key}T00:00:00`).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  const activeStartSet = new Set(activeDayStarts)
  const countStreakEndingAt = (start: number): number => {
    let count = 0
    for (let cursor = start; activeStartSet.has(cursor); cursor -= 24 * 60 * 60 * 1000) {
      count += 1
    }
    return count
  }
  const currentStreak = countStreakEndingAt(todayStart) || countStreakEndingAt(todayStart - 24 * 60 * 60 * 1000)
  let longestStreak = 0
  let runningStreak = 0
  let previousDay = -1
  for (const day of activeDayStarts) {
    runningStreak = previousDay > 0 && day - previousDay === 24 * 60 * 60 * 1000 ? runningStreak + 1 : 1
    longestStreak = Math.max(longestStreak, runningStreak)
    previousDay = day
  }

  const peakHour = hourlyTotals.reduce((best, value, hour) => value > hourlyTotals[best] ? hour : best, 0)
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

  const chartDayCount = range === '7d' ? 7 : 6
  const activeChartDays = Array.from(dailyTotals.keys()).sort().slice(-chartDayCount)
  const fallbackChartDays = Array.from({ length: chartDayCount }, (_, index) => {
    const timestamp = todayStart - (chartDayCount - 1 - index) * 24 * 60 * 60 * 1000
    return dayKeyFromTimestamp(timestamp)
  })
  const chartDayKeys = activeChartDays.length >= Math.min(2, chartDayCount) ? activeChartDays : fallbackChartDays
  const chartDays = chartDayKeys.map(dayKey => ({
    dayKey,
    label: formatUsageDateLabel(dayKey),
    total: dailyTotals.get(dayKey) || 0
  }))
  const maxChartTotal = Math.max(1, ...chartDays.map(day => day.total))
  const favoriteModel = modelBreakdown[0]?.label || 'n/a'
  const hasActivity = runRecords.length > 0 || messageEvents.length > 0

  return {
    hasActivity,
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
    chartDays,
    modelBreakdown,
    maxChartTotal
  }
}
