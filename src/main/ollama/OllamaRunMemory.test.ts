import { describe, expect, it } from 'vitest'
import {
  appendOllamaTrajectoryEntry,
  compressOllamaMessagesWithWorkingMemory,
  createEmptyOllamaSessionMemory,
  shouldRollOllamaRunSummary
} from './OllamaRunMemory'

describe('OllamaRunMemory', () => {
  it('rolls working memory after every third tool turn', () => {
    expect(shouldRollOllamaRunSummary(3)).toBe(true)
    expect(shouldRollOllamaRunSummary(2)).toBe(false)
  })

  it('compresses the in-flight loop to system + initial user + working memory', () => {
    const memory = appendOllamaTrajectoryEntry(createEmptyOllamaSessionMemory('gpt-oss:20b'), {
      toolName: 'workspace_search',
      args: { query: 'foo' },
      ok: true,
      resultSummary: '1 match'
    })
    const compressed = compressOllamaMessagesWithWorkingMemory(
      [
        { role: 'system', content: 'tools' },
        { role: 'user', content: 'find foo' },
        { role: 'assistant', content: '' },
        { role: 'tool', content: 'raw tool output', tool_name: 'workspace_search' }
      ],
      memory.workingMemory
    )
    expect(compressed).toHaveLength(3)
    expect(compressed[2]?.content).toContain('working memory')
  })
})
