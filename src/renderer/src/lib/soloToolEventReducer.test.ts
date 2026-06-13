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

  it('keeps trailing assistant text after a newly inserted tool row', () => {
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

    expect(result.messages.map((message) => message.role)).toEqual(['tool', 'assistant'])
    expect(result.messages[1].id).toBe('assistant-1')
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
