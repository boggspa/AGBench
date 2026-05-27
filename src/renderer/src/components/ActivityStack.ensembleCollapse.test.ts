import { describe, expect, it } from 'vitest'
import { buildTimelineItems } from './ActivityStack'
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
  it('only groups read+search activities and requires at least 3', () => {
    const acts: ToolActivity[] = [
      activity({ id: 'r1', category: 'read', toolName: 'read_file' }),
      activity({ id: 'r2', category: 'read', toolName: 'read_file' }),
      activity({ id: 'w1', category: 'write', toolName: 'edit' }),
      activity({ id: 'r3', category: 'read', toolName: 'read_file' })
    ]
    const items = buildTimelineItems(acts)
    // 2 reads inline (under min-3), then 1 write inline, then 1 read inline.
    expect(items.map((i) => i.type)).toEqual([
      'activity',
      'activity',
      'activity',
      'activity'
    ])
  })

  it('groups 3+ consecutive read/search activities into a compact group', () => {
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

  it('drops the min-group-size to 1 so even a single terminal activity collapses', () => {
    const acts: ToolActivity[] = [activity({ id: 'w1', category: 'write', status: 'success' })]
    const items = buildTimelineItems(acts, { collapseAllTerminal: true })
    expect(items.length).toBe(1)
    expect(items[0].type).toBe('compact-group')
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
      activity({ id: 'err', category: 'shell', status: 'error' }),
      activity({ id: 'r2', category: 'read', status: 'success' })
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
    // Read → yield → read. The two reads collapse around the yield
    // (which stays inline), producing [group(1), yield, group(1)].
    const acts: ToolActivity[] = [
      activity({ id: 'r1', category: 'read', status: 'success' }),
      activity({ id: 'y1', toolName: 'ensemble_yield', category: 'task', status: 'success' }),
      activity({ id: 'r2', category: 'read', status: 'success' })
    ]
    const items = buildTimelineItems(acts, { collapseAllTerminal: true })
    expect(items.map((i) => i.type)).toEqual(['compact-group', 'activity', 'compact-group'])
    if (items[1].type === 'activity') {
      expect(items[1].activity.id).toBe('y1')
    }
  })
})
