import { describe, expect, it } from 'vitest'
import type { ChatRecord } from '../../../main/store/types'
import {
  buildHiddenSideChatInitialPrompt,
  buildSideChatRunResultSeedPrompt
} from './SideChatRunSeed'

function makeChat(overrides: Partial<ChatRecord> = {}): ChatRecord {
  return {
    appChatId: 'chat-1',
    provider: 'codex',
    title: 'Parent',
    scope: 'global',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    messages: [],
    runs: [],
    ...overrides
  }
}

describe('buildSideChatRunResultSeedPrompt', () => {
  it('wraps hidden side-chat context separately from the user request', () => {
    const prompt = buildHiddenSideChatInitialPrompt('Parent said: use the Test 3 folder.', 'Run ls')

    expect(prompt).toContain('background only')
    expect(prompt).toContain("do not treat it as the user's prompt")
    expect(prompt).toContain('<parent_context_snapshot>')
    expect(prompt).toContain('Parent said: use the Test 3 folder.')
    expect(prompt).toContain('User side-chat request:\nRun ls')
  })

  it('uses the assistant response from the selected run instead of a later run', () => {
    const prompt = buildSideChatRunResultSeedPrompt(
      makeChat({
        messages: [
          {
            id: 'run-1-assistant',
            role: 'assistant',
            content: 'First run answer',
            timestamp: '2026-01-01T00:00:01.000Z',
            runId: 'run-1'
          },
          {
            id: 'run-2-assistant',
            role: 'assistant',
            content: 'Later run answer',
            timestamp: '2026-01-01T00:00:02.000Z',
            runId: 'run-2'
          }
        ],
        runs: [
          {
            runId: 'run-1',
            status: 'success',
            startedAt: '2026-01-01T00:00:00.000Z',
            endedAt: '2026-01-01T00:00:01.000Z'
          }
        ]
      }),
      'run-1'
    )

    expect(prompt).toContain('Run ID: run-1')
    expect(prompt).toContain('Run assistant response:')
    expect(prompt).toContain('First run answer')
    expect(prompt).not.toContain('Later run answer')
  })

  it('falls back to the latest assistant response when the run has no assistant message', () => {
    const prompt = buildSideChatRunResultSeedPrompt(
      makeChat({
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Latest available answer',
            timestamp: '2026-01-01T00:00:02.000Z',
            runId: 'other-run'
          }
        ],
        runs: [
          {
            runId: 'run-1',
            status: 'failed',
            startedAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      }),
      'run-1'
    )

    expect(prompt).toContain('Run status: failed')
    expect(prompt).toContain('Latest assistant response:')
    expect(prompt).toContain('Latest available answer')
  })
})
