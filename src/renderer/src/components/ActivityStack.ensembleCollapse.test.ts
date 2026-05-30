import { describe, expect, it } from 'vitest'
import { buildCompactGroupLabel, buildTimelineItems } from './ActivityStack'
import type { ToolActivity } from '../../../main/store/types'

/*
 * 1.0.4-AS2 — Ensemble-mode collapse pattern.
 *
 * The user picked pattern (a) from three options: "Only the
 * currently-running activity stays expanded; everything terminal
 * collapses into a `▾ N activities` group above it."
 *
 * `buildTimelineItems(activities, { collapseAllTerminal: true })`
 * implements that pattern by:
 *   - Treating every non-running, non-error activity (read /
 *     write / shell / task / search / unknown) as a collapse
 *     candidate, not just read+search like the default.
 *   - Dropping the min-group-size from 3 to 1 so even a single
 *     completed activity collapses.
 *   - Leaving running / pending / error activities inline so the
 *     active step + anything the user needs to act on is always
 *     visible.
 *
 * Single-provider chats stay on the default (read/search,
 * min-3) path — verified by tests below.
 */

function activity(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    id: `a-${Math.random().toString(36).slice(2, 8)}`,
    toolName: 'edit',
    displayName: 'edit',
    category: 'write',
    status: 'success',
    ...overrides
  } as ToolActivity
}

describe('buildTimelineItems — default (single-provider) behavior', () => {
  it('only groups read+search activities (writes stay inline regardless of count)', () => {
    const acts: ToolActivity[] = [
      activity({ id: 'r1', category: 'read', toolName: 'read_file' }),
      activity({ id: 'r2', category: 'read', toolName: 'read_file' }),
      activity({ id: 'w1', category: 'write', toolName: 'edit' }),
      activity({ id: 'r3', category: 'read', toolName: 'read_file' })
    ]
    const items = buildTimelineItems(acts)
    // The two-read run at the front now collapses (min-2 in AS2b).
    // The write is its own category (never collapses solo). The
    // trailing single read stays inline (only one in its run).
    expect(items.map((i) => i.type)).toEqual(['compact-group', 'activity', 'activity'])
  })

  it('groups 2+ consecutive read/search activities into a compact group (AS2b min)', () => {
    const acts: ToolActivity[] = [
      activity({ id: 'r1', category: 'read', toolName: 'read_file' }),
      activity({ id: 'r2', category: 'read', toolName: 'read_file' }),
      activity({ id: 'r3', category: 'read', toolName: 'read_file' })
    ]
    const items = buildTimelineItems(acts)
    expect(items.length).toBe(1)
    expect(items[0].type).toBe('compact-group')
  })

  it('does NOT collapse write/shell/task activities even when 3+ consecutive', () => {
    const acts: ToolActivity[] = [
      activity({ id: 'w1', category: 'write', toolName: 'edit' }),
      activity({ id: 'w2', category: 'write', toolName: 'edit' }),
      activity({ id: 'w3', category: 'write', toolName: 'edit' })
    ]
    const items = buildTimelineItems(acts)
    expect(items.map((i) => i.type)).toEqual(['activity', 'activity', 'activity'])
  })
})

describe('buildTimelineItems — Ensemble mode (collapseAllTerminal: true)', () => {
  it('collapses every terminal activity — read, write, shell, task — into one group', () => {
    const acts: ToolActivity[] = [
      activity({ id: 'r1', category: 'read', toolName: 'read_file' }),
      activity({ id: 'w1', category: 'write', toolName: 'edit' }),
      activity({ id: 's1', category: 'shell', toolName: 'bash' }),
      activity({ id: 't1', category: 'task', toolName: 'unknown' })
    ]
    const items = buildTimelineItems(acts, { collapseAllTerminal: true })
    expect(items.length).toBe(1)
    expect(items[0].type).toBe('compact-group')
    if (items[0].type === 'compact-group') {
      expect(items[0].activities.length).toBe(4)
    }
  })

  it('keeps SINGLE terminal activities inline in Ensemble too (AS2b — min-2)', () => {
    // Pre-AS2b: ensemble threshold was 1, so even one solitary
    // completed write collapsed into a "1 activity" header that
    // hid useful context (which file, what edit, etc.). AS2b
    // raised the threshold to 2 across both modes so single
    // terminal activities stay readable inline.
    const acts: ToolActivity[] = [activity({ id: 'w1', category: 'write', status: 'success' })]
    const items = buildTimelineItems(acts, { collapseAllTerminal: true })
    expect(items.length).toBe(1)
    expect(items[0].type).toBe('activity')
  })

  it('isolates a solitary terminal activity (no adjacent collapsibles) as inline', () => {
    // The key invariant from user feedback: single activities
    // shouldn't collapse. When a terminal activity is the only
    // candidate in its run (because the surrounding activities
    // are running/pending/errors), it stays inline.
    const acts: ToolActivity[] = [
      activity({ id: 'pend', category: 'write', status: 'pending' }),
      activity({ id: 'w1', category: 'write', status: 'success' }),
      activity({ id: 'live', category: 'write', status: 'running' })
    ]
    const items = buildTimelineItems(acts, { collapseAllTerminal: true })
    // All three stay inline: pend is non-candidate, w1 is solo
    // collapsible (no adjacent collapsibles → stays inline by
    // the min-2 threshold), live is non-candidate.
    expect(items.map((i) => i.type)).toEqual(['activity', 'activity', 'activity'])
  })

  it('leaves the currently-running activity inline + collapses the prior terminals', () => {
    const acts: ToolActivity[] = [
      activity({ id: 'r1', category: 'read', status: 'success' }),
      activity({ id: 'w1', category: 'write', status: 'success' }),
      activity({ id: 's1', category: 'shell', status: 'success' }),
      activity({ id: 'live', category: 'write', status: 'running' })
    ]
    const items = buildTimelineItems(acts, { collapseAllTerminal: true })
    // Three terminals collapse, the running one stays inline.
    expect(items.length).toBe(2)
    expect(items[0].type).toBe('compact-group')
    expect(items[1].type).toBe('activity')
    if (items[1].type === 'activity') {
      expect(items[1].activity.id).toBe('live')
    }
  })

  it('keeps errors inline so the user can act on them, even when surrounding activities collapse', () => {
    const acts: ToolActivity[] = [
      activity({ id: 'r1', category: 'read', status: 'success' }),
      activity({ id: 'r2', category: 'read', status: 'success' }),
      activity({ id: 'err', category: 'shell', status: 'error' }),
      activity({ id: 'r3', category: 'read', status: 'success' }),
      activity({ id: 'r4', category: 'read', status: 'success' })
    ]
    const items = buildTimelineItems(acts, { collapseAllTerminal: true })
    // Two compact groups (one each side of the error) + the error inline.
    expect(items.map((i) => i.type)).toEqual(['compact-group', 'activity', 'compact-group'])
    if (items[1].type === 'activity') {
      expect(items[1].activity.id).toBe('err')
    }
  })

  it('keeps pending activities inline (active step is always readable)', () => {
    const acts: ToolActivity[] = [
      activity({ id: 'r1', category: 'read', status: 'success' }),
      activity({ id: 'r2', category: 'read', status: 'success' }),
      activity({ id: 'pend', category: 'write', status: 'pending' })
    ]
    const items = buildTimelineItems(acts, { collapseAllTerminal: true })
    expect(items.map((i) => i.type)).toEqual(['compact-group', 'activity'])
    if (items[1].type === 'activity') {
      expect(items[1].activity.id).toBe('pend')
    }
  })

  it('produces an empty timeline for empty input', () => {
    expect(buildTimelineItems([], { collapseAllTerminal: true })).toEqual([])
  })

  it('keeps ensemble_yield activities inline (social-glue exception, all alias forms)', () => {
    // Three aliases: bare, Codex-style, Claude-style. All should
    // stay inline even though their status is terminal.
    const yields: ToolActivity[] = [
      activity({ id: 'y1', toolName: 'ensemble_yield', category: 'task' }),
      activity({ id: 'y2', toolName: 'mcp_AGBench_ensemble_yield', category: 'task' }),
      activity({ id: 'y3', toolName: 'mcp__AGBench__ensemble_yield', category: 'task' })
    ]
    const items = buildTimelineItems(yields, { collapseAllTerminal: true })
    expect(items.length).toBe(3)
    expect(items.every((i) => i.type === 'activity')).toBe(true)
  })

  it('separates the inline ensemble_yield from a surrounding collapsed group', () => {
    // Read+read → yield → read+read. The two read-pairs collapse
    // around the yield (which stays inline), producing
    // [group, yield, group].
    const acts: ToolActivity[] = [
      activity({ id: 'r1', category: 'read', status: 'success' }),
      activity({ id: 'r2', category: 'read', status: 'success' }),
      activity({ id: 'y1', toolName: 'ensemble_yield', category: 'task', status: 'success' }),
      activity({ id: 'r3', category: 'read', status: 'success' }),
      activity({ id: 'r4', category: 'read', status: 'success' })
    ]
    const items = buildTimelineItems(acts, { collapseAllTerminal: true })
    expect(items.map((i) => i.type)).toEqual(['compact-group', 'activity', 'compact-group'])
    if (items[1].type === 'activity') {
      expect(items[1].activity.id).toBe('y1')
    }
  })
})

/*
 * 1.0.4-AS2b — smarter compact-group labels. Pre-AS2b the
 * heterogeneous (Ensemble) fallback emitted a generic
 * "N activities". User feedback: "'activity' is a bit generic
 * when we have so many useful ways of presenting transparent,
 * and useful information whilst still being able to compactify".
 *
 * The new label picks the dominant category and emits
 * category-specific phrasing — "Edited 3 files", "Ran 2
 * commands", etc. — with a "+N more" suffix when the group
 * spans multiple categories.
 */
describe('buildCompactGroupLabel (AS2b)', () => {
  it('keeps the descriptive read+search phrasing for pure read/search groups', () => {
    expect(
      buildCompactGroupLabel([
        activity({ id: 'r1', category: 'read', toolName: 'read_file' }),
        activity({ id: 'r2', category: 'read', toolName: 'read_file' }),
        activity({ id: 'r3', category: 'read', toolName: 'read_file' })
      ])
    ).toBe('Read 3 files')

    expect(
      buildCompactGroupLabel([
        activity({ id: 's1', category: 'search', toolName: 'grep' }),
        activity({ id: 's2', category: 'search', toolName: 'grep' })
      ])
    ).toBe('Searched 2 times')

    expect(
      buildCompactGroupLabel([
        activity({ id: 'r1', category: 'read', toolName: 'read_file' }),
        activity({ id: 's1', category: 'search', toolName: 'grep' })
      ])
    ).toBe('Read 1 file and searched 1 time')
  })

  it('emits "Edited N files" for write-heavy heterogeneous groups', () => {
    expect(
      buildCompactGroupLabel([
        activity({ id: 'w1', category: 'write', toolName: 'edit' }),
        activity({ id: 'w2', category: 'write', toolName: 'edit' }),
        activity({ id: 'w3', category: 'write', toolName: 'edit' }),
        activity({ id: 's1', category: 'shell', toolName: 'bash' })
      ])
    ).toBe('Edited 3 files (+1 more)')
  })

  it('emits "Ran N commands" for shell-heavy heterogeneous groups', () => {
    expect(
      buildCompactGroupLabel([
        activity({ id: 's1', category: 'shell', toolName: 'bash' }),
        activity({ id: 's2', category: 'shell', toolName: 'bash' })
      ])
    ).toBe('Ran 2 commands')
  })

  it('emits "Completed N tasks" for task-heavy heterogeneous groups', () => {
    expect(
      buildCompactGroupLabel([
        activity({ id: 't1', category: 'task', toolName: 'plan' }),
        activity({ id: 't2', category: 'task', toolName: 'plan' }),
        activity({ id: 'w1', category: 'write', toolName: 'edit' })
      ])
    ).toBe('Completed 2 tasks (+1 more)')
  })

  it('uses singular phrasing for count === 1', () => {
    expect(
      buildCompactGroupLabel([
        activity({ id: 'w1', category: 'write', toolName: 'edit' }),
        activity({ id: 's1', category: 'shell', toolName: 'bash' })
      ])
    ).toBe('Edited 1 file (+1 more)')
  })

  it('falls back to "Used N tools" when no activity has a categorisable kind', () => {
    expect(
      buildCompactGroupLabel([
        activity({ id: 'u1', category: 'unknown', toolName: 'x' }),
        activity({ id: 'u2', category: 'unknown', toolName: 'y' })
      ])
    ).toBe('Used 2 tools')
  })

  it('picks the highest-count category as the dominant label', () => {
    // 2 writes, 1 shell, 3 reads → reads dominate → "Read 3 files (+3 more)"
    // But reads alone (pure read/search) doesn't qualify as heterogeneous,
    // so we only test this when otherCount > 0. Here writes contribute
    // to otherCount, so we land in the heterogeneous branch with reads
    // as dominant.
    expect(
      buildCompactGroupLabel([
        activity({ id: 'r1', category: 'read', toolName: 'read_file' }),
        activity({ id: 'r2', category: 'read', toolName: 'read_file' }),
        activity({ id: 'r3', category: 'read', toolName: 'read_file' }),
        activity({ id: 'w1', category: 'write', toolName: 'edit' }),
        activity({ id: 'w2', category: 'write', toolName: 'edit' }),
        activity({ id: 's1', category: 'shell', toolName: 'bash' })
      ])
    ).toBe('Read 3 files (+3 more)')
  })
})
