import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../main/store/types'
import { reduceSoloToolEventMessages } from './soloToolEventReducer'

const NOW = '2026-06-13T00:00:00.000Z'

function reduce(messages: ChatMessage[], event: any) {
  return reduceSoloToolEventMessages(messages, event, {
    createMessageId: () => 'tool-message-1',
    nowIso: () => NOW
  })
}

describe('reduceSoloToolEventMessages', () => {
  it('creates a tool message for a solo tool_use event', () => {
    const result = reduce([], {
      type: 'tool_event',
      isUse: true,
      data: {
        type: 'tool_use',
        tool_id: 'call-1',
        tool_name: 'mcp_TaskWraith_git_status',
        parameters: {}
      }
    })

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toMatchObject({
      id: 'tool-message-1',
      role: 'tool',
      timestamp: NOW
    })
    expect(result.messages[0].toolActivities?.[0]).toMatchObject({
      id: 'call-1',
      toolName: 'mcp_TaskWraith_git_status',
      displayName: 'Git status',
      status: 'running'
    })
    expect(result.latestToolActivity?.id).toBe('call-1')
    expect(result.isResult).toBe(false)
  })

  it('pairs a solo tool_result with the existing tool activity', () => {
    const first = reduce([], {
      type: 'tool_event',
      isUse: true,
      data: {
        type: 'tool_use',
        tool_id: 'call-1',
        tool_name: 'read_file',
        parameters: { file_path: 'README.md' }
      }
    })
    const second = reduce(first.messages, {
      type: 'tool_event',
      isResult: true,
      data: {
        type: 'tool_result',
        tool_id: 'call-1',
        content: 'ok'
      }
    })

    expect(second.messages).toHaveLength(1)
    expect(second.messages[0].toolActivities).toHaveLength(1)
    expect(second.messages[0].toolActivities?.[0]).toMatchObject({
      id: 'call-1',
      toolName: 'read_file',
      status: 'success',
      resultSummary: 'ok'
    })
    expect(second.latestToolActivity?.status).toBe('success')
    expect(second.isResult).toBe(true)
  })

  it('appends a tool row AFTER trailing assistant text (true stream order)', () => {
    // The assistant text streamed first, then the tool ran — the tool card
    // belongs below the text, not pushed above it.
    const messages: ChatMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'I will check that.',
        timestamp: NOW
      }
    ]
    const result = reduce(messages, {
      type: 'tool_event',
      isUse: true,
      data: {
        type: 'tool_use',
        tool_id: 'call-1',
        tool_name: 'workspace_search',
        parameters: { query: 'needle' }
      }
    })

    expect(result.messages.map((message) => message.role)).toEqual(['assistant', 'tool'])
    expect(result.messages[0].id).toBe('assistant-1')
    expect(result.messages[1].toolActivities?.[0]?.id).toBe('call-1')
  })

  it('starts a NEW tool row when a tool burst is separated from a prior tool burst by assistant text', () => {
    // [tool burst 1] -> assistant text -> [new tool] must stay as TWO tool
    // groups in order. Reaching back past the assistant to merge into the
    // first burst is exactly the interleaving regression this guards against.
    const messages: ChatMessage[] = [
      {
        id: 'tool-1',
        role: 'tool',
        content: '',
        timestamp: NOW,
        toolActivities: [
          {
            id: 'call-1',
            toolName: 'read_file',
            displayName: 'Read file',
            status: 'success'
          } as any
        ]
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Found it. Now editing.',
        timestamp: NOW
      }
    ]
    const result = reduce(messages, {
      type: 'tool_event',
      isUse: true,
      data: {
        type: 'tool_use',
        tool_id: 'call-2',
        tool_name: 'edit_file',
        parameters: { file_path: 'a.ts' }
      }
    })

    // Three messages in stream order: tools, text, tools — NOT [tools+tools, text].
    expect(result.messages.map((message) => message.role)).toEqual(['tool', 'assistant', 'tool'])
    expect(result.messages[0].id).toBe('tool-1')
    expect(result.messages[0].toolActivities).toHaveLength(1)
    expect(result.messages[0].toolActivities?.[0]?.id).toBe('call-1')
    expect(result.messages[1].id).toBe('assistant-1')
    expect(result.messages[2].toolActivities).toHaveLength(1)
    expect(result.messages[2].toolActivities?.[0]?.id).toBe('call-2')
  })

  it('collapses consecutive tool events (no text between) into one row', () => {
    // The desirable collapse: back-to-back tools with no assistant text
    // between them stay in a single ActivityStack group.
    const first = reduce([], {
      type: 'tool_event',
      isUse: true,
      data: { type: 'tool_use', tool_id: 'call-1', tool_name: 'read_file', parameters: {} }
    })
    const second = reduce(first.messages, {
      type: 'tool_event',
      isUse: true,
      data: { type: 'tool_use', tool_id: 'call-2', tool_name: 'grep', parameters: {} }
    })

    expect(second.messages).toHaveLength(1)
    expect(second.messages[0].role).toBe('tool')
    expect(second.messages[0].toolActivities?.map((a) => a.id)).toEqual(['call-1', 'call-2'])
  })

  it('creates a paired orphan activity when a result arrives without its use event', () => {
    const result = reduce([], {
      type: 'tool_event',
      name: 'read_file',
      isResult: true,
      data: {
        type: 'tool_result',
        tool_id: 'missing-call',
        content: 'late result'
      }
    })

    expect(result.messages[0].toolActivities?.[0]).toMatchObject({
      id: 'missing-call',
      toolName: 'read_file',
      status: 'success',
      resultSummary: 'late result'
    })
    expect(result.isResult).toBe(true)
  })
})
