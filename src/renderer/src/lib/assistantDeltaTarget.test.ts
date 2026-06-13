import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../main/store/types'
import { resolveAssistantDeltaTarget } from './assistantDeltaTarget'

const NOW = '2026-06-13T00:00:00.000Z'

function assistant(id: string, content: string): ChatMessage {
  return { id, role: 'assistant', content, timestamp: NOW }
}

function tool(id: string): ChatMessage {
  return {
    id,
    role: 'tool',
    content: '',
    timestamp: NOW,
    toolActivities: [{ id: `${id}-a`, toolName: 'read_file', displayName: 'Read file', status: 'success' } as any]
  }
}

describe('resolveAssistantDeltaTarget', () => {
  it('appends a fresh bubble when there are no messages yet', () => {
    expect(resolveAssistantDeltaTarget([], { incoming: 'hi' })).toEqual({ action: 'append' })
  })

  it('merges into the trailing assistant bubble (continuation, no tool since)', () => {
    const messages = [assistant('a1', 'Hello')]
    expect(resolveAssistantDeltaTarget(messages, { incoming: ' world' })).toEqual({
      action: 'merge',
      index: 0
    })
  })

  it('SEALS at a tool boundary — a genuine increment after a tool burst starts a NEW bubble', () => {
    // [assistant, tool] then more text: the new text belongs BELOW the tool,
    // not merged back into the pre-burst bubble. This is the core interleave.
    const messages = [assistant('a1', 'First segment.'), tool('t1')]
    expect(resolveAssistantDeltaTarget(messages, { incoming: 'Second segment.' })).toEqual({
      action: 'append'
    })
  })

  it('does not reach back across MULTIPLE consecutive tools for an increment', () => {
    const messages = [assistant('a1', 'First.'), tool('t1'), tool('t2')]
    expect(resolveAssistantDeltaTarget(messages, { incoming: 'Second.' })).toEqual({
      action: 'append'
    })
  })

  it('routes a tagged cumulative restatement back to its bubble across a tool burst (no duplicate)', () => {
    // Claude divergent envelope: full turn re-stated after a tool ran. Must
    // replace the existing bubble in place, never append a duplicate.
    const messages = [assistant('a1', 'Partial answer'), tool('t1')]
    expect(
      resolveAssistantDeltaTarget(messages, {
        incoming: 'Partial answer now complete',
        cumulative: true
      })
    ).toEqual({ action: 'merge', index: 0 })
  })

  it('routes an UNTAGGED superset snapshot back to its bubble across a tool burst', () => {
    // Cursor cumulative frames are untagged; detected by superset of the
    // existing bubble content.
    const messages = [assistant('a1', 'Hello'), tool('t1')]
    expect(resolveAssistantDeltaTarget(messages, { incoming: 'Hello world' })).toEqual({
      action: 'merge',
      index: 0
    })
  })

  it('treats a non-superset increment after a tool as a new segment, not a restatement', () => {
    const messages = [assistant('a1', 'Reading the file.'), tool('t1')]
    // Brand-new prose that does not extend the prior bubble → seal, append.
    expect(resolveAssistantDeltaTarget(messages, { incoming: 'The file says X.' })).toEqual({
      action: 'append'
    })
  })

  it('stops at a user/error boundary when scanning for a cumulative target', () => {
    const messages: ChatMessage[] = [
      assistant('a1', 'Old turn'),
      { id: 'u1', role: 'user', content: 'next question', timestamp: NOW },
      tool('t1')
    ]
    // The only assistant is behind a user message — do not reach across it.
    expect(
      resolveAssistantDeltaTarget(messages, { incoming: 'anything', cumulative: true })
    ).toEqual({ action: 'append' })
  })
})
