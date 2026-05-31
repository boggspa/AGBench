import { describe, expect, it } from 'vitest'
import type { WorkspaceActivitySnapshot } from '../../../main/store/types'
import { buildWorkspaceActivityHeatmapGrid, formatActivityCount } from './WorkspaceActivityHeatmap'

const NOW = new Date('2026-05-31T12:00:00')

function snapshot(events: WorkspaceActivitySnapshot['events']): WorkspaceActivitySnapshot {
  return {
    workspacePath: '/repo',
    dayCount: 90,
    generatedAt: NOW.getTime(),
    source: 'git',
    truncated: false,
    events,
    stats: {
      gitRepo: true,
      commits: 0,
      worktreeFiles: 0,
      filesystemFiles: 0,
      scannedFiles: 0,
      scanLimit: 5000
    }
  }
}

describe('buildWorkspaceActivityHeatmapGrid', () => {
  it('buckets workspace events into the 90-day by two-hour grid', () => {
    const grid = buildWorkspaceActivityHeatmapGrid(
      snapshot([
        {
          timestamp: new Date('2026-05-31T10:30:00').getTime(),
          kind: 'git_commit',
          count: 1,
          weight: 2
        }
      ]),
      NOW,
      90
    )

    expect(grid.columns).toBe(90)
    expect(grid.cells).toHaveLength(90 * 12)
    const cell = grid.cells.find((candidate) => candidate.column === 89 && candidate.row === 5)
    expect(cell).toMatchObject({ active: true, count: 1, weight: 2 })
    expect(grid.totals).toEqual({ last24h: 1, last7d: 1, window: 1 })
  })

  it('keeps count totals separate from intensity weights', () => {
    const grid = buildWorkspaceActivityHeatmapGrid(
      snapshot([
        {
          timestamp: new Date('2026-05-31T10:00:00').getTime(),
          kind: 'git_commit',
          count: 1,
          weight: 10
        },
        {
          timestamp: new Date('2026-05-25T09:00:00').getTime(),
          kind: 'filesystem_change',
          count: 3,
          weight: 3
        }
      ]),
      NOW,
      90
    )

    expect(grid.totals.last24h).toBe(1)
    expect(grid.totals.last7d).toBe(4)
    expect(grid.totals.window).toBe(4)
    expect(grid.cells.filter((cell) => cell.active).every((cell) => cell.intensity > 0)).toBe(true)
  })

  it('drops events outside the requested window', () => {
    const grid = buildWorkspaceActivityHeatmapGrid(
      snapshot([
        {
          timestamp: new Date('2026-01-01T10:00:00').getTime(),
          kind: 'git_commit',
          count: 1,
          weight: 1
        }
      ]),
      NOW,
      90
    )

    expect(grid.totals.window).toBe(0)
    expect(grid.cells.every((cell) => !cell.active)).toBe(true)
  })
})

describe('formatActivityCount', () => {
  it('formats compact activity counts', () => {
    expect(formatActivityCount(0)).toBe('0')
    expect(formatActivityCount(42)).toBe('42')
    expect(formatActivityCount(1_500)).toBe('1.5K')
    expect(formatActivityCount(25_000)).toBe('25K')
  })
})
