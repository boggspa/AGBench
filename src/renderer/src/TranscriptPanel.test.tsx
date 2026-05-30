import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRef } from 'react'
import { TranscriptPanel } from './App'
import type { ChatMessage } from '../../main/store/types'

/**
 * 1.0.6-TV1 — TranscriptPanel windowing wiring.
 *
 * These render the panel with `renderToStaticMarkup` (server render).
 * That deliberately exercises the INITIAL window only: the window is
 * computed in the render body from estimate heights + the windowing
 * refs' initial values, so it is fully deterministic without needing
 * jsdom layout, requestAnimationFrame, or ResizeObserver (none of which
 * run under server render). The pure window math itself is covered
 * exhaustively in `lib/TranscriptVirtualWindow.test.ts`; here we assert
 * the wiring: spacers render with the right heights, only the window
 * slice mounts, and the bottom-pin path mounts the last row.
 */

function msg(i: number): ChatMessage {
  return {
    id: `m${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `UNIQUEMARK_${i} sample transcript line`,
    timestamp: '2026-01-01T00:00:00.000Z'
  }
}

const MESSAGES: ChatMessage[] = Array.from({ length: 120 }, (_, i) => msg(i))

function makeProps(overrides: Record<string, any> = {}): any {
  return {
    scrollRef: createRef<HTMLDivElement>(),
    contentRef: createRef<HTMLDivElement>(),
    endRef: createRef<HTMLDivElement>(),
    messages: MESSAGES,
    isWelcomeChat: false,
    isThinking: false,
    showFallbackUX: false,
    pendingPlanChoice: null,
    pendingAgentQuestion: null,
    onAgentQuestionSubmit: () => {},
    onAgentQuestionDismiss: () => {},
    runCompleteNotice: null,
    runCompleteDurationText: null,
    currentChat: null,
    currentRun: null,
    currentWorkspacePath: undefined,
    currentProviderLabel: 'Claude',
    currentProvider: 'claude',
    thinkingProviderLabel: undefined,
    thinkingProvider: null,
    thinkingModelBadge: null,
    displayFileChangeSummaries: [],
    fileChangeSummaryText: '',
    fileChangeShouldShowStats: false,
    fileChangeDisplayAdds: 0,
    fileChangeDisplayDels: 0,
    chats: [],
    runningChatIds: [],
    onPlanChoiceSubmit: () => {},
    onRunFallback: () => {},
    onOpenSubThread: () => {},
    onInspectRun: () => {},
    compactDensity: false,
    pendingQueuedAppRunIds: undefined,
    onCopyMessage: () => {},
    onDeleteMessage: () => {},
    ...overrides
  }
}

function countBlocks(html: string): number {
  return (html.match(/data-vrow-id="/g) || []).length
}

/** Pull a spacer div's pixel height out of the static markup. */
function spacerHeight(html: string, cls: string): number {
  const idx = html.indexOf(cls)
  if (idx < 0) return -1
  const slice = html.slice(idx, idx + 160)
  const m = slice.match(/height:(\d+)/)
  return m ? parseInt(m[1], 10) : -1
}

describe('TranscriptPanel virtualisation wiring (TV1)', () => {
  it('non-virtualised (default): mounts every block, renders no spacers', () => {
    const html = renderToStaticMarkup(<TranscriptPanel {...makeProps({ virtualize: false })} />)
    expect(countBlocks(html)).toBe(MESSAGES.length)
    expect(html).not.toContain('vlist-spacer-top')
    expect(html).not.toContain('vlist-spacer-bottom')
    // Both ends present — the whole list is in the DOM.
    expect(html).toContain('UNIQUEMARK_0 ')
    expect(html).toContain('UNIQUEMARK_119 ')
    // No virtualised class hook.
    expect(html).not.toContain('transcript-virtualized')
  })

  it('virtualised + scrolled to top: mounts only the top window, top spacer 0, bottom spacer > 0', () => {
    const html = renderToStaticMarkup(
      <TranscriptPanel {...makeProps({ virtualize: true, autoFollowRef: { current: false } })} />
    )
    expect(html).toContain('transcript-virtualized')
    // Far fewer blocks than the full list.
    const blocks = countBlocks(html)
    expect(blocks).toBeGreaterThan(0)
    expect(blocks).toBeLessThan(40)
    // Top of the list is mounted; the far end is collapsed into a spacer.
    expect(html).toContain('UNIQUEMARK_0 ')
    expect(html).not.toContain('UNIQUEMARK_119 ')
    // Spacer geometry: nothing above the top, a tall run below.
    expect(spacerHeight(html, 'vlist-spacer-top')).toBe(0)
    expect(spacerHeight(html, 'vlist-spacer-bottom')).toBeGreaterThan(0)
  })

  it('virtualised + bottom-pinned (auto-follow): mounts the last window, bottom spacer 0', () => {
    const html = renderToStaticMarkup(
      <TranscriptPanel {...makeProps({ virtualize: true, autoFollowRef: { current: true } })} />
    )
    const blocks = countBlocks(html)
    expect(blocks).toBeGreaterThan(0)
    expect(blocks).toBeLessThan(40)
    // Bottom of the list is mounted; the far top is collapsed.
    expect(html).toContain('UNIQUEMARK_119 ')
    expect(html).not.toContain('UNIQUEMARK_0 ')
    // The window reaches the end → bottom spacer collapses to 0, the
    // existing `scrollTop = scrollHeight` snap still hits the true bottom.
    expect(spacerHeight(html, 'vlist-spacer-bottom')).toBe(0)
    expect(spacerHeight(html, 'vlist-spacer-top')).toBeGreaterThan(0)
  })

  it('mounted + collapsed blocks reconcile: window blocks ≪ total, ends are mutually exclusive', () => {
    // Top window and bottom window mount disjoint slices of the same
    // 120-message list — proof the window actually moves with the pin
    // state rather than always rendering the same rows.
    const top = renderToStaticMarkup(
      <TranscriptPanel {...makeProps({ virtualize: true, autoFollowRef: { current: false } })} />
    )
    const bottom = renderToStaticMarkup(
      <TranscriptPanel {...makeProps({ virtualize: true, autoFollowRef: { current: true } })} />
    )
    expect(top.includes('UNIQUEMARK_0 ')).toBe(true)
    expect(bottom.includes('UNIQUEMARK_0 ')).toBe(false)
    expect(top.includes('UNIQUEMARK_119 ')).toBe(false)
    expect(bottom.includes('UNIQUEMARK_119 ')).toBe(true)
  })
})
