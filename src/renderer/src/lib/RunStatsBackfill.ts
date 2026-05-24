const POSITIVE_STAT_KEYS = [
  'input_tokens',
  'inputTokens',
  'prompt_tokens',
  'promptTokens',
  'output_tokens',
  'outputTokens',
  'completion_tokens',
  'completionTokens',
  'total_tokens',
  'totalTokens',
  'all_tokens',
  'total',
  'duration_ms',
  'durationMs',
  'cost_usd',
  'total_cost_usd',
  'inputTokenLimit',
  'outputTokenLimit',
  'totalTokenLimit',
  'input_tokens_limit',
  'output_tokens_limit',
  'total_tokens_limit'
]

function statNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function hasMeaningfulRunStats(stats: unknown): boolean {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return false
  const record = stats as Record<string, unknown>
  return POSITIVE_STAT_KEYS.some((key) => statNumber(record[key]) > 0)
}

export function shouldBackfillRunStats(existingStats: unknown, candidateStats: unknown): boolean {
  return !hasMeaningfulRunStats(existingStats) && hasMeaningfulRunStats(candidateStats)
}
