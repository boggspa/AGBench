import type { RunEventRecord } from './store/types'

export const RUN_EVENT_CATCHUP_FRAME_LIMIT = 500

export interface ResolveRunEventCatchupInput {
  storedEvents: RunEventRecord[]
  resumeFrom?: number | null
  safetyLimit?: number
}

export interface RunEventCatchupResolution {
  catchupEvents: RunEventRecord[]
  catchupBatches: RunEventRecord[][]
  nextLiveSeq: number
  highWater: number
  normalizedResumeFrom: number | null
  oversized: boolean
  warning?: string
}

export function resolveRunEventCatchup(
  input: ResolveRunEventCatchupInput
): RunEventCatchupResolution {
  const events = [...input.storedEvents].sort((a, b) => a.sequence - b.sequence)
  const highWater = events.reduce((max, event) => Math.max(max, event.sequence), 0)
  const safetyLimit = Math.max(1, Math.floor(input.safetyLimit || RUN_EVENT_CATCHUP_FRAME_LIMIT))
  const normalizedResumeFrom = normalizeResumeFrom(input.resumeFrom)

  if (highWater === 0) {
    return {
      catchupEvents: [],
      catchupBatches: [],
      nextLiveSeq: 0,
      highWater,
      normalizedResumeFrom,
      oversized: false
    }
  }

  if (normalizedResumeFrom === null) {
    return {
      catchupEvents: [],
      catchupBatches: [],
      nextLiveSeq: highWater + 1,
      highWater,
      normalizedResumeFrom,
      oversized: false
    }
  }

  if (normalizedResumeFrom > highWater) {
    return {
      catchupEvents: [],
      catchupBatches: [],
      nextLiveSeq: highWater + 1,
      highWater,
      normalizedResumeFrom: highWater,
      oversized: false,
      warning: `resumeFrom ${normalizedResumeFrom} is ahead of run-event high-water ${highWater}; clamped to high-water.`
    }
  }

  const catchupEvents = events.filter((event) => event.sequence > normalizedResumeFrom)
  const catchupBatches = batchEvents(catchupEvents, safetyLimit)

  return {
    catchupEvents,
    catchupBatches,
    nextLiveSeq: highWater + 1,
    highWater,
    normalizedResumeFrom,
    oversized: catchupBatches.length > 1
  }
}

function normalizeResumeFrom(resumeFrom: number | null | undefined): number | null {
  if (resumeFrom === null || resumeFrom === undefined) return null
  if (!Number.isFinite(resumeFrom) || resumeFrom < 0) return null
  return Math.floor(resumeFrom)
}

function batchEvents(events: RunEventRecord[], safetyLimit: number): RunEventRecord[][] {
  if (events.length === 0) return []
  const batches: RunEventRecord[][] = []
  for (let index = 0; index < events.length; index += safetyLimit) {
    batches.push(events.slice(index, index + safetyLimit))
  }
  return batches
}
