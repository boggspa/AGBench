import { describe, expect, it } from 'vitest'
import { summarizeOllamaToolResult } from './OllamaToolResultSummary'

describe('summarizeOllamaToolResult', () => {
  it('keeps only the head of large read_file bodies', () => {
    const output = Array.from({ length: 120 }, (_, index) => `line ${index}`).join('\n')
    const summary = summarizeOllamaToolResult('read_file', output, 2400)
    expect(summary).toContain('read_file summary')
    expect(summary.length).toBeLessThan(output.length)
  })
})
