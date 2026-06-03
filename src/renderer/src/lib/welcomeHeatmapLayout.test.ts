import { describe, expect, it } from 'vitest'
import { visibleHeatmapSlots } from './welcomeHeatmapLayout'

describe('visibleHeatmapSlots', () => {
  it('stacked shows every slot regardless of tick', () => {
    expect(visibleHeatmapSlots(['a', 'b', 'c'], 'stacked', 5)).toEqual(['a', 'b', 'c'])
  })

  it('single shows one slot, advancing with the tick', () => {
    expect(visibleHeatmapSlots(['a', 'b', 'c'], 'single', 0)).toEqual(['a'])
    expect(visibleHeatmapSlots(['a', 'b', 'c'], 'single', 1)).toEqual(['b'])
    expect(visibleHeatmapSlots(['a', 'b', 'c'], 'single', 2)).toEqual(['c'])
    expect(visibleHeatmapSlots(['a', 'b', 'c'], 'single', 3)).toEqual(['a'])
  })

  it('single with one slot always shows it (no real cycle)', () => {
    expect(visibleHeatmapSlots(['only'], 'single', 7)).toEqual(['only'])
  })

  it('handles a negative tick defensively', () => {
    expect(visibleHeatmapSlots(['a', 'b', 'c'], 'single', -1)).toEqual(['c'])
  })

  it('empty in, empty out for both layouts', () => {
    expect(visibleHeatmapSlots([], 'single', 0)).toEqual([])
    expect(visibleHeatmapSlots([], 'stacked', 0)).toEqual([])
  })
})
