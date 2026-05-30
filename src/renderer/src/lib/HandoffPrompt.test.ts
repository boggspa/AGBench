import { describe, expect, it } from 'vitest'
import { formatOpaqueMarkdownPromptSection } from './HandoffPrompt'

describe('formatOpaqueMarkdownPromptSection', () => {
  it('wraps handoff prompt sections with promoted fences', () => {
    const content = ['Review this:', '```json', '{"ok": true}', '```'].join('\n')
    const section = formatOpaqueMarkdownPromptSection('Latest assistant summary', content)

    expect(section).toContain('Latest assistant summary:')
    expect(section).toContain('```` markdown')
    expect(section).toContain(content)
  })
})
