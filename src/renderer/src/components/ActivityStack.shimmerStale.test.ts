import { describe, expect, it } from 'vitest'
import { isActivityShimmerStale } from './ActivityStack'
import type { ToolActivity } from '../../../main/store/types'

/*
 * 1.0.4-AS1 — staleness predicate that drives the shimmer-sweep
 * + icon-pulse expiration on tool-activity rows.
 *
 * The CSS keeps `data-status="running"` driving the animations,
 * and this predicate emits `data-stale="true"` as a sibling
 * attribute when the renderer can prove the activity is no
 * longer worth shimmering for. Two ways to prove that:
 *
 *  1. Terminal field set on the record (`endedAt` or
 *     `durationMs > 0`) despite `status` still saying running —
 *     classic state-merge race where the timing info landed but
 *     the status flip didn't.
 *  2. TTL safety net — activity started more than 4 minutes ago
 *     and no terminal field has arrived. Genuine long-runners
 *     past 4 minutes lose the shimmer but the row stays visible.
 */

function activity(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    id: 'a1',
    toolName: 'edit',
    displayName: 'edit',
    category: 'write',
    status: 'running',
    ...overrides
  } as ToolActivity
}

const NOW = Date.parse('2026-05-27T12:00:00.000Z')

describe('isActivityShimmerStale', () => {
  describe('non-running statuses', () => {
    it('returns false for success/warning/error/pending without TTL/terminal triggers', () => {
      expect(isActivityShimmerStale(activity({ status: 'success' }), NOW)).toBe(false)
      expect(isActivityShimmerStale(activity({ status: 'warning' }), NOW)).toBe(false)
      expect(isActivityShimmerStale(activity({ status: 'error' }), NOW)).toBe(false)
    })
  })

  describe('terminal-field detection (state-merge race)', () => {
    it('flags stale when endedAt is set even though status is still running', () => {
      const a = activity({
        status: 'running',
        startedAt: new Date(NOW - 5_000).toISOString(),
        endedAt: new Date(NOW - 1_000).toISOString()
      })
      expect(isActivityShimmerStale(a, NOW)).toBe(true)
    })

    it('flags stale when durationMs is set even though status is still running', () => {
      const a = activity({
        status: 'running',
        startedAt: new Date(NOW - 5_000).toISOString(),
        durationMs: 3_400
      })
      expect(isActivityShimmerStale(a, NOW)).toBe(true)
    })

    it('ignores durationMs of 0 — that means "we haven\'t recorded one yet"', () => {
      const a = activity({
        status: 'running',
        startedAt: new Date(NOW - 5_000).toISOString(),
        durationMs: 0
      })
      expect(isActivityShimmerStale(a, NOW)).toBe(false)
    })

    it('flags stale also on pending status (covers pre-dispatch races)', () => {
      const a = activity({
        status: 'pending',
        startedAt: new Date(NOW - 5_000).toISOString(),
        endedAt: new Date(NOW - 1_000).toISOString()
      })
      expect(isActivityShimmerStale(a, NOW)).toBe(true)
    })
  })

  describe('TTL safety net (4 minutes)', () => {
    it('returns false for running activities within the TTL window', () => {
      const a = activity({
        status: 'running',
        startedAt: new Date(NOW - 60_000).toISOString() // 1 minute ago
      })
      expect(isActivityShimmerStale(a, NOW)).toBe(false)
    })

    it('returns false right at the TTL boundary', () => {
      const a = activity({
        status: 'running',
        startedAt: new Date(NOW - 4 * 60_000).toISOString() // exactly 4 minutes
      })
      expect(isActivityShimmerStale(a, NOW)).toBe(false)
    })

    it('flags stale when running for longer than 4 minutes', () => {
      const a = activity({
        status: 'running',
        startedAt: new Date(NOW - 5 * 60_000).toISOString() // 5 minutes ago
      })
      expect(isActivityShimmerStale(a, NOW)).toBe(true)
    })

    it("returns false when running with no startedAt (can't compute TTL)", () => {
      const a = activity({ status: 'running' })
      // `startedAt` undefined — can't measure age, so no TTL trigger.
      // (Terminal-field paths above still flag stale if endedAt /
      // durationMs is set — those are independent of startedAt.)
      expect(isActivityShimmerStale(a, NOW)).toBe(false)
    })

    it('returns false when startedAt is unparseable', () => {
      const a = activity({ status: 'running', startedAt: 'not a date' })
      expect(isActivityShimmerStale(a, NOW)).toBe(false)
    })
  })
})
