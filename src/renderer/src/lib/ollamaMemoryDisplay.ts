const OLLAMA_PEAK_RSS_GB_PATHS: Array<string | string[]> = [
  ['ollamaMemoryPeakRssGb'],
  ['hardware', 'ram', 'peakRssGb'],
  ['hardware', 'ram', 'rssGb'],
  ['ollamaMemoryRssGb']
]

const readPositiveNumber = (obj: unknown, paths: Array<string | string[]>): number => {
  for (const path of paths) {
    const keys = Array.isArray(path) ? path : [path]
    let cursor: unknown = obj
    let found = true
    for (const key of keys) {
      if (!cursor || typeof cursor !== 'object' || !(key in cursor)) {
        found = false
        break
      }
      cursor = (cursor as Record<string, unknown>)[key]
    }
    if (!found) continue
    const value = typeof cursor === 'string' ? Number(cursor.trim()) : Number(cursor)
    if (Number.isFinite(value) && value > 0) return value
  }
  return 0
}

/** Peak llama-server RSS in GB from a run stats blob. */
export function extractOllamaPeakRssGb(stats: unknown): number {
  return readPositiveNumber(stats, OLLAMA_PEAK_RSS_GB_PATHS)
}

/** Compact peak-RAM label for the composer telemetry row (e.g. `17.0GB`). */
export function formatOllamaComposerPeakGb(gb: number): string {
  if (!Number.isFinite(gb) || gb <= 0) return ''
  if (gb >= 10) return `${gb.toFixed(1)}GB`
  if (gb >= 1) return `${gb.toFixed(1)}GB`
  return `${gb.toFixed(2)}GB`
}

/** Human-readable peak-RAM label for run-complete summaries (e.g. `17 GB`). */
export function formatOllamaSummaryMemoryGb(gb: number): string {
  if (!Number.isFinite(gb) || gb <= 0) return ''
  if (gb >= 10) return `${gb.toFixed(0)} GB`
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${gb.toFixed(2)} GB`
}

const OLLAMA_SAMPLE_COUNT_PATHS: Array<string | string[]> = [
  ['ollamaMemorySampleCount'],
  ['hardware', 'ram', 'sampleCount']
]

/** Periodic memory-poll count from a run stats or usage record blob. */
export function extractOllamaSampleCount(stats: unknown): number {
  return readPositiveNumber(stats, OLLAMA_SAMPLE_COUNT_PATHS)
}

/** Fields to persist on a {@link UsageRecord} when an Ollama run finishes. */
export function ollamaMemoryUsageFields(stats: unknown): {
  ollamaMemoryPeakRssGb?: number
  ollamaMemorySampleCount?: number
} {
  const peakGb = extractOllamaPeakRssGb(stats)
  if (peakGb <= 0) return {}
  const sampleCount = extractOllamaSampleCount(stats)
  return {
    ollamaMemoryPeakRssGb: peakGb,
    ...(sampleCount > 0 ? { ollamaMemorySampleCount: sampleCount } : {})
  }
}
