import { describe, expect, it } from 'vitest'
import { resolveRunEventCatchup } from './ReplayCursor'
import type { RunEventRecord } from './store/types'

describe('resolveRunEventCatchup', () => {
  it('returns events with sequence greater than resumeFrom', () => {
    const resolution = resolveRunEventCatchup({
      storedEvents: events(1, 2, 3, 4),
      resumeFrom: 2
    })

    expect(resolution.catchupEvents.map((event) => event.sequence)).toEqual([3, 4])
    expect(resolution.catchupBatches.map((batch) => batch.map((event) => event.sequence))).toEqual([[3, 4]])
    expect(resolution.nextLiveSeq).toBe(5)
    expect(resolution.warning).toBeUndefined()
  })

  it('treats null resumeFrom as a fresh live-only subscription', () => {
    const resolution = resolveRunEventCatchup({
      storedEvents: events(1, 2, 3),
      resumeFrom: null
    })

    expect(resolution.catchupEvents).toEqual([])
    expect(resolution.catchupBatches).toEqual([])
    expect(resolution.nextLiveSeq).toBe(4)
  })

  it('clamps future resumeFrom values to the current high-water mark', () => {
    const resolution = resolveRunEventCatchup({
      storedEvents: events(1, 2, 3),
      resumeFrom: 99
    })

    expect(resolution.catchupEvents).toEqual([])
    expect(resolution.nextLiveSeq).toBe(4)
    expect(resolution.normalizedResumeFrom).toBe(3)
    expect(resolution.warning).toContain('ahead of run-event high-water')
  })

  it('splits oversized catchup into bounded batches', () => {
    const resolution = resolveRunEventCatchup({
      storedEvents: events(1, 2, 3, 4, 5),
      resumeFrom: 0,
      safetyLimit: 2
    })

    expect(resolution.catchupEvents.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5])
    expect(resolution.catchupBatches.map((batch) => batch.map((event) => event.sequence))).toEqual([[1, 2], [3, 4], [5]])
    expect(resolution.oversized).toBe(true)
    expect(resolution.nextLiveSeq).toBe(6)
  })

  it('returns an empty cursor response for unknown runs with no stored events', () => {
    const resolution = resolveRunEventCatchup({
      storedEvents: [],
      resumeFrom: 42
    })

    expect(resolution.catchupEvents).toEqual([])
    expect(resolution.catchupBatches).toEqual([])
    expect(resolution.highWater).toBe(0)
    expect(resolution.nextLiveSeq).toBe(0)
  })

  it('treats negative and non-finite resumeFrom values as fresh subscriptions', () => {
    expect(resolveRunEventCatchup({ storedEvents: events(1), resumeFrom: -1 }).normalizedResumeFrom).toBeNull()
    expect(resolveRunEventCatchup({ storedEvents: events(1), resumeFrom: Number.NaN }).normalizedResumeFrom).toBeNull()
  })
})

function events(...sequences: number[]): RunEventRecord[] {
  return sequences.map((sequence) => ({
    schemaVersion: 1,
    id: `event-${sequence}`,
    sequence,
    runId: 'run-1',
    provider: 'codex',
    kind: 'lifecycle',
    phase: 'control',
    source: 'main',
    timestamp: `2026-05-17T00:00:0${sequence}.000Z`
  }))
}
