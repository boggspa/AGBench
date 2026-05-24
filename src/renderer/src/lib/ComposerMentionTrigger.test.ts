import { describe, expect, it } from 'vitest'
import { formatComposerPathMention, parseComposerMentionTrigger } from './ComposerMentionTrigger'

describe('parseComposerMentionTrigger', () => {
  it('matches plain agent-style mention queries', () => {
    expect(parseComposerMentionTrigger('Ask @builder', 12)).toEqual({
      anchorIndex: 4,
      query: 'builder'
    })
  })

  it('allows workspace file path characters after @', () => {
    expect(parseComposerMentionTrigger('Open @src/renderer/App.tsx')).toEqual({
      anchorIndex: 5,
      query: 'src/renderer/App.tsx'
    })
  })

  it('requires a token boundary before @ so emails do not trigger', () => {
    expect(parseComposerMentionTrigger('mail me@example.com')).toBeNull()
  })

  it('returns null once the caret has moved past the mention token', () => {
    expect(parseComposerMentionTrigger('Open @src/App.tsx now')).toBeNull()
  })
})

describe('formatComposerPathMention', () => {
  it('keeps simple paths readable and quotes paths with whitespace', () => {
    expect(formatComposerPathMention('src/App.tsx')).toBe('src/App.tsx ')
    expect(formatComposerPathMention('/tmp/My File.txt')).toBe('"/tmp/My File.txt" ')
  })
})
