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

  it('1.0.7 — KEEPS virtualisation ON for ensemble chats (oscillation fixed at source)', () => {
    // e4feee5 had force-disabled windowing for ensembles to dodge a flicker;
    // the flicker's root cause is now fixed (content-scaled estimates +
    // scrollbar-gutter + stable window snapshot + one-shot anchor), so
    // ensembles window like any other chat — preserving the benefit for the
    // densest transcripts.
    const html = renderToStaticMarkup(
      <TranscriptPanel
        {...makeProps({
          virtualize: true,
          autoFollowRef: { current: false },
          currentChat: { chatKind: 'ensemble' }
        })}
      />
    )
    expect(html).toContain('transcript-virtualized')
    // Far fewer blocks than the full list — the window is active.
    expect(countBlocks(html)).toBeLessThan(40)
    // Top mounted; far end collapsed into the bottom spacer.
    expect(html).toContain('UNIQUEMARK_0 ')
    expect(html).not.toContain('UNIQUEMARK_119 ')
  })

  it('1.0.7 — keeps virtualisation ON for non-ensemble chats too', () => {
    const html = renderToStaticMarkup(
      <TranscriptPanel
        {...makeProps({
          virtualize: true,
          autoFollowRef: { current: false },
          currentChat: { chatKind: 'single' }
        })}
      />
    )
    expect(html).toContain('transcript-virtualized')
    expect(countBlocks(html)).toBeLessThan(40)
  })

  it('renders a run-result side chat action when the current run is complete', () => {
    const html = renderToStaticMarkup(
      <TranscriptPanel
        {...makeProps({
          virtualize: false,
          messages: [
            {
              id: 'assistant-1',
              role: 'assistant',
              content: 'Run result summary',
              timestamp: '2026-01-01T00:00:00.000Z'
            }
          ],
          runCompleteNotice: {
            timestamp: '2026-01-01T00:00:10.000Z',
            exitCode: 0
          },
          currentRun: {
            runId: 'run-1',
            startedAt: '2026-01-01T00:00:00.000Z'
          },
          onOpenSideChatFromRun: () => {}
        })}
      />
    )

    expect(html).toContain('Open side chat from run result')
    expect(html).toContain('Side chat')
  })

  it('renders Ollama brand providers with model badges in message headers', () => {
    const html = renderToStaticMarkup(
      <TranscriptPanel
        {...makeProps({
          virtualize: false,
          currentProviderLabel: 'Ollama',
          currentProvider: 'ollama',
          messages: [
            {
              id: 'assistant-qwen',
              role: 'assistant',
              content: 'Local response',
              timestamp: '2026-01-01T00:00:00.000Z',
              metadata: {
                providerModel: 'qwen3:4b-instruct',
                providerModelLabel: 'Qwen 3 (4B Param)'
              }
            }
          ]
        })}
      />
    )

    expect(html).toContain('provider-qwen')
    expect(html).toContain('Qwen')
    expect(html).toContain('Qwen 3 (4B Param)')
  })

  it('renders a run-result side chat action on historical run boundary cards', () => {
    const html = renderToStaticMarkup(
      <TranscriptPanel
        {...makeProps({
          virtualize: false,
          messages: [
            {
              id: 'm-run',
              role: 'user',
              content: 'Run this task',
              timestamp: '2026-01-01T00:00:00.000Z',
              runId: 'run-1'
            }
          ],
          currentChat: {
            appChatId: 'chat-1',
            provider: 'codex',
            runs: [
              {
                runId: 'run-1',
                provider: 'codex',
                promptMessageId: 'm-run',
                startedAt: '2026-01-01T00:00:00.000Z',
                endedAt: '2026-01-01T00:00:10.000Z',
                status: 'success'
              }
            ]
          },
          onOpenSideChatFromRun: () => {}
        })}
      />
    )

    expect(html).toContain('Open side chat from this run result')
    expect(html).toContain('Side chat')
  })

  it('marks the selected side-chat seed message in the transcript', () => {
    const html = renderToStaticMarkup(
      <TranscriptPanel
        {...makeProps({
          virtualize: false,
          sideChatSeedMessageId: 'm2',
          onOpenSideChatFromMessage: () => {}
        })}
      />
    )

    expect(html).toContain('is-side-chat-seed')
    expect(html).toContain('data-message-id="m2"')
  })
})
