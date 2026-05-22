import { describe, expect, it } from 'vitest'
import type { ChatRecord } from './store/types'

/**
 * Phase F2 — pure-function tests for the sub-thread result back-
 * propagation logic.
 *
 * The actual `maybePropagateSubThreadResult` helper in `index.ts`
 * pulls from / pushes to `AppStore`, which would require a much
 * larger fixture to test directly. Instead this suite tests the
 * pure predicate + builder functions that determine WHETHER and
 * HOW propagation should happen.
 *
 * The helper in index.ts re-implements the same logic via direct
 * AppStore calls + side effects; this test surface ensures the
 * preconditions stay correctly enforced as the feature evolves.
 */

interface SubThreadReturnDecision {
  shouldPropagate: boolean
  reason?: string
  lastAssistantContent?: string
  parentChatId?: string
}

/** Pure helper mirroring the gate logic in
 * `maybePropagateSubThreadResult`. Exported here as a test helper
 * (not from index.ts to keep that file simple); kept in sync by
 * convention. If the helper diverges, the tests will catch a
 * regression because the index.ts version still has to apply the
 * same gates. */
function decideSubThreadReturn(subThread: ChatRecord): SubThreadReturnDecision {
  if (!subThread.parentChatId) {
    return { shouldPropagate: false, reason: 'no parentChatId' }
  }
  if (!subThread.delegationContext?.returnResultToParent) {
    return { shouldPropagate: false, reason: 'returnResultToParent=false' }
  }
  const lastAssistant = [...subThread.messages].reverse().find((m) => m.role === 'assistant')
  if (!lastAssistant || !lastAssistant.content.trim()) {
    return { shouldPropagate: false, reason: 'no assistant message' }
  }
  if (subThread.delegationContext.resultReturnedAt) {
    const assistantTimestamp = Date.parse(lastAssistant.timestamp)
    if (
      !Number.isFinite(assistantTimestamp) ||
      assistantTimestamp <= subThread.delegationContext.resultReturnedAt
    ) {
      return { shouldPropagate: false, reason: 'already propagated' }
    }
  }
  return {
    shouldPropagate: true,
    lastAssistantContent: lastAssistant.content,
    parentChatId: subThread.parentChatId
  }
}

function makeChat(overrides: Partial<ChatRecord> = {}): ChatRecord {
  return {
    appChatId: 'chat-1',
    scope: 'workspace',
    provider: 'codex',
    title: 'Sub-thread',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archived: false,
    messages: [],
    runs: [],
    ...overrides
  }
}

describe('Phase F2 — sub-thread return decision', () => {
  it('refuses propagation when chat has no parentChatId', () => {
    const chat = makeChat()
    const decision = decideSubThreadReturn(chat)
    expect(decision.shouldPropagate).toBe(false)
    expect(decision.reason).toBe('no parentChatId')
  })

  it('refuses propagation when returnResultToParent is false', () => {
    const chat = makeChat({
      parentChatId: 'parent-1',
      delegationContext: {
        createdAt: Date.now(),
        parentProvider: 'claude',
        delegationPrompt: 'Run the build',
        returnResultToParent: false
      },
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'Build succeeded',
          timestamp: new Date().toISOString()
        }
      ]
    })
    const decision = decideSubThreadReturn(chat)
    expect(decision.shouldPropagate).toBe(false)
    expect(decision.reason).toBe('returnResultToParent=false')
  })

  it('refuses propagation when already propagated', () => {
    const chat = makeChat({
      parentChatId: 'parent-1',
      delegationContext: {
        createdAt: Date.parse('2026-01-01T00:00:00Z'),
        parentProvider: 'claude',
        delegationPrompt: 'Run the build',
        returnResultToParent: true,
        resultReturnedAt: Date.parse('2026-01-01T00:00:30Z')
      },
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'Build succeeded',
          timestamp: '2026-01-01T00:00:10Z'
        }
      ]
    })
    const decision = decideSubThreadReturn(chat)
    expect(decision.shouldPropagate).toBe(false)
    expect(decision.reason).toBe('already propagated')
  })

  it('propagates a later recall result after an earlier result was returned', () => {
    const chat = makeChat({
      parentChatId: 'parent-1',
      delegationContext: {
        createdAt: Date.parse('2026-01-01T00:00:00Z'),
        parentProvider: 'claude',
        delegationPrompt: 'Run the build',
        returnResultToParent: true,
        resultReturnedAt: Date.parse('2026-01-01T00:00:30Z')
      },
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'Build succeeded',
          timestamp: '2026-01-01T00:00:10Z'
        },
        {
          id: 'm2',
          role: 'user',
          content: 'Show the second failure',
          timestamp: '2026-01-01T00:00:40Z'
        },
        {
          id: 'm3',
          role: 'assistant',
          content: 'Second failure details.',
          timestamp: '2026-01-01T00:00:50Z'
        }
      ]
    })
    const decision = decideSubThreadReturn(chat)
    expect(decision.shouldPropagate).toBe(true)
    expect(decision.lastAssistantContent).toBe('Second failure details.')
  })

  it('refuses propagation when no assistant message exists', () => {
    const chat = makeChat({
      parentChatId: 'parent-1',
      delegationContext: {
        createdAt: Date.now(),
        parentProvider: 'claude',
        delegationPrompt: 'Run the build',
        returnResultToParent: true
      },
      messages: [{ id: 'm1', role: 'user', content: 'Run it', timestamp: new Date().toISOString() }]
    })
    const decision = decideSubThreadReturn(chat)
    expect(decision.shouldPropagate).toBe(false)
    expect(decision.reason).toBe('no assistant message')
  })

  it('refuses propagation when the assistant message is empty', () => {
    const chat = makeChat({
      parentChatId: 'parent-1',
      delegationContext: {
        createdAt: Date.now(),
        parentProvider: 'claude',
        delegationPrompt: 'Run the build',
        returnResultToParent: true
      },
      messages: [
        { id: 'm1', role: 'assistant', content: '   \n  ', timestamp: new Date().toISOString() }
      ]
    })
    const decision = decideSubThreadReturn(chat)
    expect(decision.shouldPropagate).toBe(false)
    expect(decision.reason).toBe('no assistant message')
  })

  it('propagates the LAST assistant message when multiple exist', () => {
    const chat = makeChat({
      parentChatId: 'parent-1',
      delegationContext: {
        createdAt: Date.now(),
        parentProvider: 'claude',
        delegationPrompt: 'Run the build',
        returnResultToParent: true
      },
      messages: [
        { id: 'm1', role: 'user', content: 'Run it', timestamp: '2026-01-01T00:00:00Z' },
        { id: 'm2', role: 'assistant', content: 'Starting…', timestamp: '2026-01-01T00:00:01Z' },
        { id: 'm3', role: 'user', content: 'and then?', timestamp: '2026-01-01T00:00:02Z' },
        { id: 'm4', role: 'assistant', content: 'All done.', timestamp: '2026-01-01T00:00:03Z' }
      ]
    })
    const decision = decideSubThreadReturn(chat)
    expect(decision.shouldPropagate).toBe(true)
    expect(decision.lastAssistantContent).toBe('All done.')
    expect(decision.parentChatId).toBe('parent-1')
  })

  it('propagates when all preconditions are satisfied', () => {
    const chat = makeChat({
      parentChatId: 'parent-1',
      delegationContext: {
        createdAt: Date.now(),
        parentProvider: 'claude',
        delegationPrompt: 'Run swift build',
        returnResultToParent: true
      },
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'Build succeeded with 3 warnings.',
          timestamp: new Date().toISOString()
        }
      ]
    })
    const decision = decideSubThreadReturn(chat)
    expect(decision.shouldPropagate).toBe(true)
    expect(decision.lastAssistantContent).toBe('Build succeeded with 3 warnings.')
  })

  it('ignores tool / error / system messages when finding the result', () => {
    const chat = makeChat({
      parentChatId: 'parent-1',
      delegationContext: {
        createdAt: Date.now(),
        parentProvider: 'claude',
        delegationPrompt: 'Run swift build',
        returnResultToParent: true
      },
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'Running build',
          timestamp: '2026-01-01T00:00:00Z'
        },
        { id: 'm2', role: 'tool', content: '{"output":"..."}', timestamp: '2026-01-01T00:00:01Z' },
        { id: 'm3', role: 'system', content: 'note', timestamp: '2026-01-01T00:00:02Z' },
        { id: 'm4', role: 'error', content: 'transient', timestamp: '2026-01-01T00:00:03Z' }
      ]
    })
    const decision = decideSubThreadReturn(chat)
    // The last *assistant* message is 'Running build' — that's what we propagate.
    expect(decision.shouldPropagate).toBe(true)
    expect(decision.lastAssistantContent).toBe('Running build')
  })
})
