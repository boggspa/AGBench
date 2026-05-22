import { describe, expect, it } from 'vitest'
import type { ToolActivity } from '../../../main/store/types'
import {
  buildTurnReceiptSummary,
  formatDuration,
  formatFamilyTally,
  tallyByFamily
} from './TurnReceiptCard'

/*
 * Pure-logic tests for the turn-receipt summary builder. No DOM, no
 * React rendering — the React component is a thin wrapper around
 * `buildTurnReceiptSummary` so pinning this helper covers the
 * rendering behaviour by proxy.
 */

function makeActivity(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    id: Math.random().toString(36).slice(2),
    toolName: 'read_file',
    displayName: 'read_file',
    category: 'read',
    status: 'success',
    durationMs: 100,
    ...overrides
  } as ToolActivity
}

describe('buildTurnReceiptSummary', () => {
  it('hides for empty or single-activity stacks', () => {
    expect(buildTurnReceiptSummary([], false).visible).toBe(false)
    expect(buildTurnReceiptSummary([makeActivity()], false).visible).toBe(false)
  })

  it('hides while any activity is still running or pending', () => {
    const result = buildTurnReceiptSummary(
      [
        makeActivity({ toolName: 'read_file', status: 'success' }),
        makeActivity({ toolName: 'write_file', status: 'running' }),
        makeActivity({ toolName: 'git_status', status: 'success' })
      ],
      false
    )
    expect(result.visible).toBe(false)
  })

  it('produces a summary line when every activity has resolved', () => {
    const { visible, summary } = buildTurnReceiptSummary(
      [
        makeActivity({ toolName: 'read_file', durationMs: 200 }),
        makeActivity({ toolName: 'read_file', durationMs: 100 }),
        makeActivity({ toolName: 'git_status', durationMs: 300 }),
        makeActivity({ toolName: 'write_file', durationMs: 400 })
      ],
      false
    )
    expect(visible).toBe(true)
    expect(summary).toContain('2 reads')
    expect(summary).toContain('1 git op')
    expect(summary).toContain('1 edit')
    expect(summary).toContain('1.0s') // total = 1000ms
    expect(summary).toContain('4/4 ✓')
  })

  it('reports error count distinctly when any tool errored', () => {
    const { summary } = buildTurnReceiptSummary(
      [
        makeActivity({ toolName: 'read_file', status: 'success' }),
        makeActivity({ toolName: 'write_file', status: 'error' }),
        makeActivity({ toolName: 'git_status', status: 'success' })
      ],
      false
    )
    expect(summary).toContain('2/3 ✓')
    expect(summary).toContain('1 ✗')
  })

  it('reports warning count when warnings exist and no errors', () => {
    const { summary } = buildTurnReceiptSummary(
      [
        makeActivity({ toolName: 'read_file', status: 'success' }),
        makeActivity({ toolName: 'write_file', status: 'warning' })
      ],
      false
    )
    expect(summary).toContain('1/2 ✓')
    expect(summary).toContain('1 ⚠')
  })

  it('collapses to a single-line summary in compact mode', () => {
    const { summary } = buildTurnReceiptSummary(
      [
        makeActivity({ toolName: 'read_file' }),
        makeActivity({ toolName: 'read_file' }),
        makeActivity({ toolName: 'git_status' })
      ],
      true
    )
    expect(summary).toContain('3 tools')
    // No per-family breakdown in compact mode.
    expect(summary).not.toContain('reads')
    expect(summary).not.toContain('git op')
  })
})

describe('tallyByFamily', () => {
  it('groups activities by tool family in descending count order', () => {
    const tallies = tallyByFamily([
      makeActivity({ toolName: 'read_file' }),
      makeActivity({ toolName: 'read_file' }),
      makeActivity({ toolName: 'read_file' }),
      makeActivity({ toolName: 'git_status' }),
      makeActivity({ toolName: 'write_file' })
    ])
    expect(tallies[0]).toEqual({ family: 'file', count: 3 })
    expect(tallies.map((t) => t.family)).toEqual(['file', 'git', 'edit'])
  })

  it("buckets unknown tool names into 'other' and sorts them last on ties", () => {
    const tallies = tallyByFamily([
      makeActivity({ toolName: 'completely_unknown_tool' }),
      makeActivity({ toolName: 'read_file' })
    ])
    expect(tallies[0].family).toBe('file')
    expect(tallies[1].family).toBe('other')
  })
})

describe('formatFamilyTally', () => {
  it('uses singular labels for count 1', () => {
    expect(formatFamilyTally({ family: 'file', count: 1 })).toBe('1 read')
    expect(formatFamilyTally({ family: 'edit', count: 1 })).toBe('1 edit')
    expect(formatFamilyTally({ family: 'task', count: 1 })).toBe('1 test')
  })

  it('uses plural labels for count > 1', () => {
    expect(formatFamilyTally({ family: 'file', count: 3 })).toBe('3 reads')
    expect(formatFamilyTally({ family: 'edit', count: 2 })).toBe('2 edits')
    expect(formatFamilyTally({ family: 'git', count: 4 })).toBe('4 git ops')
  })
})

describe('formatDuration', () => {
  it('renders millisecond ranges as `Xms`', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(150)).toBe('150ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('renders second ranges with one decimal place under 10s', () => {
    expect(formatDuration(1000)).toBe('1.0s')
    expect(formatDuration(2500)).toBe('2.5s')
    expect(formatDuration(9999)).toBe('10.0s')
  })

  it('renders second ranges as integers between 10s and 59s', () => {
    expect(formatDuration(10_000)).toBe('10s')
    expect(formatDuration(45_700)).toBe('46s')
  })

  it('renders minute ranges with optional seconds', () => {
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(90_000)).toBe('1m 30s')
    expect(formatDuration(125_000)).toBe('2m 5s')
  })
})
