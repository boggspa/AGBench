export type HeatmapLayout = 'single' | 'stacked'

/**
 * Decide which welcome-screen heatmap slots to render for the current layout +
 * cycle tick.
 *   - 'stacked' shows every slot (the long-standing layout).
 *   - 'single' shows exactly one slot, advancing through the list as `tick`
 *     increments (the caller drives `tick` on a 90s timer).
 * Empty in → empty out. Negative ticks are handled. Pure so the cycling logic
 * is unit-tested without a DOM.
 */
export function visibleHeatmapSlots<T>(slots: T[], layout: HeatmapLayout, tick: number): T[] {
  if (slots.length === 0) return []
  if (layout !== 'single') return slots
  const index = ((tick % slots.length) + slots.length) % slots.length
  return [slots[index]]
}
