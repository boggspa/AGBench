import { describe, expect, it } from 'vitest'
import { suggestOllamaTierBump } from './OllamaTierSuggestion'

describe('suggestOllamaTierBump', () => {
  it('suggests approved edits for refactor prompts at read-only tier', () => {
    const warning = suggestOllamaTierBump('Refactor this module across files', 'read_only')
    expect(warning?.id).toBe('ollama-tier-suggestion')
    expect(warning?.message).toContain('Approved edits')
  })

  it('suggests shell tier for npm test prompts when only read-only is enabled', () => {
    const warning = suggestOllamaTierBump('Run npm test and fix failures', 'read_only')
    expect(warning?.message).toContain('Approved')
  })

  it('returns null when the current tier already covers the request', () => {
    expect(suggestOllamaTierBump('Refactor this module', 'approved_edits')).toBeNull()
    expect(suggestOllamaTierBump('hello', 'read_only')).toBeNull()
  })
})
