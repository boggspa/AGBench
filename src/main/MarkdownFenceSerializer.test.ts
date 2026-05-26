import { describe, expect, it } from 'vitest'
import {
  longestBacktickRun,
  markdownFenceFor,
  sanitizeMarkdownFenceInfo,
  truncateOpaqueMarkdown,
  wrapOpaqueMarkdownBlock
} from './MarkdownFenceSerializer'

function unwrap(wrapped: string): { fence: string; info: string; content: string } {
  const firstLineEnd = wrapped.indexOf('\n')
  expect(firstLineEnd).toBeGreaterThan(0)
  const firstLine = wrapped.slice(0, firstLineEnd)
  const [fence, ...infoParts] = firstLine.split(' ')
  const closingStart = wrapped.lastIndexOf(`\n${fence}`)
  expect(closingStart).toBeGreaterThan(firstLineEnd)
  return {
    fence,
    info: infoParts.join(' '),
    content: wrapped.slice(firstLineEnd + 1, closingStart)
  }
}

describe('MarkdownFenceSerializer', () => {
  it('finds the longest contiguous backtick run', () => {
    expect(longestBacktickRun('plain text')).toBe(0)
    expect(longestBacktickRun('` one ``` three `` two')).toBe(3)
    expect(longestBacktickRun('```` four then ```')).toBe(4)
  })

  it('promotes fences above nested json, bash, and swift blocks', () => {
    const text = [
      'Paste this brief:',
      '```json',
      '{"ok": true}',
      '```',
      '```bash',
      'npm test',
      '```',
      '```swift',
      'print("done")',
      '```'
    ].join('\n')

    const wrapped = wrapOpaqueMarkdownBlock(text, 'markdown')
    const unwrapped = unwrap(wrapped)
    expect(unwrapped.fence).toBe('````')
    expect(unwrapped.info).toBe('markdown')
    expect(unwrapped.content).toBe(text)
  })

  it('promotes past four-backtick inner fences', () => {
    const text = ['````', 'already fenced', '````'].join('\n')
    expect(markdownFenceFor(text)).toBe('`````')
    const wrapped = wrapOpaqueMarkdownBlock(text)
    const unwrapped = unwrap(wrapped)
    expect(unwrapped.fence).toBe('`````')
    expect(unwrapped.content).toBe(text)
  })

  it('preserves wrapped opaque content byte-for-byte', () => {
    const text = 'line one\n\n```json\n{"nested": true}\n```\ntrailing newline\n'
    const wrapped = wrapOpaqueMarkdownBlock(text, 'markdown')
    expect(unwrap(wrapped).content).toBe(text)
  })

  it('sanitizes info-string whitespace and rejects backticks', () => {
    expect(sanitizeMarkdownFenceInfo(' markdown\ncopy\tblock ')).toBe('markdown copy block')
    expect(() => sanitizeMarkdownFenceInfo('bad`info')).toThrow(/backticks/i)
    expect(() => wrapOpaqueMarkdownBlock('content', 'bad`info')).toThrow(/backticks/i)
  })

  it('truncates outside active fences when a useful safe boundary exists', () => {
    const text = [
      'Intro paragraph that should survive.',
      '',
      '```json',
      '{"ok": true}',
      '```',
      '',
      'A long trailing paragraph that can be truncated without closing a fence.'
    ].join('\n')
    const truncated = truncateOpaqueMarkdown(text, text.indexOf('trailing paragraph') + 20)
    expect(truncated).toContain('{"ok": true}')
    expect(truncated).toContain('[... truncated]')
    expect(truncated.endsWith('```')).toBe(false)
  })

  it('closes an active fence when forced to truncate inside it', () => {
    const text = ['Intro', '```bash', 'echo one', 'echo two', 'echo three', '```', 'After'].join('\n')
    const truncated = truncateOpaqueMarkdown(text, text.indexOf('echo three') + 4)
    expect(truncated).toContain('```bash')
    expect(truncated).toContain('[... truncated]')
    expect(truncated.endsWith('```')).toBe(true)
    expect((truncated.match(/```/g) || []).length).toBe(2)
  })
})

