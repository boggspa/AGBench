import { describe, expect, it } from 'vitest'

import {
  buildContenteditableHtml,
  escapeHtml,
  normalisePastedText,
  replaceTriggerWithMention,
  spliceTextAtCaret,
  type MentionSegment
} from './contenteditable'

describe('escapeHtml', () => {
  it('escapes & < > " \' to entities', () => {
    expect(escapeHtml('& < > " \'')).toBe('&amp; &lt; &gt; &quot; &#39;')
  })

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('')
  })

  it('does not double-escape', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;')
  })

  it('preserves non-meta characters', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123')
  })
})

describe('buildContenteditableHtml', () => {
  it('returns <br> for empty text', () => {
    expect(buildContenteditableHtml('', [])).toBe('<br>')
  })

  it('escapes plain text without mentions', () => {
    expect(buildContenteditableHtml('hello <world>', [])).toBe('hello &lt;world&gt;')
  })

  it('turns newlines into <br>', () => {
    expect(buildContenteditableHtml('a\nb', [])).toBe('a<br>b')
  })

  it('wraps a single mention in a span', () => {
    const mentions: MentionSegment[] = [{ start: 6, end: 12, data: 'codex' }]
    expect(buildContenteditableHtml('hello @codex world', mentions)).toBe(
      'hello <span data-mention="codex">@codex</span> world'
    )
  })

  it('escapes mention data + className attributes', () => {
    const mentions: MentionSegment[] = [{ start: 0, end: 7, data: '<bad>', className: 'pro<vider' }]
    expect(buildContenteditableHtml('@"weird', mentions)).toBe(
      '<span data-mention="&lt;bad&gt;" class="pro&lt;vider">@&quot;weird</span>'
    )
  })

  it('renders multiple mentions in order', () => {
    const mentions: MentionSegment[] = [
      { start: 0, end: 6, data: 'codex', className: 'provider-codex' },
      { start: 11, end: 18, data: 'claude', className: 'provider-claude' }
    ]
    const out = buildContenteditableHtml('@codex and @claude', mentions)
    expect(out).toBe(
      '<span data-mention="codex" class="provider-codex">@codex</span> and <span data-mention="claude" class="provider-claude">@claude</span>'
    )
  })

  it('sorts unsorted mention input correctly', () => {
    const mentions: MentionSegment[] = [
      { start: 11, end: 18, data: 'claude' },
      { start: 0, end: 6, data: 'codex' }
    ]
    const out = buildContenteditableHtml('@codex and @claude', mentions)
    expect(out).toContain('@codex')
    expect(out.indexOf('@codex')).toBeLessThan(out.indexOf('@claude'))
  })

  it('throws on overlapping mentions', () => {
    const mentions: MentionSegment[] = [
      { start: 0, end: 6, data: 'a' },
      { start: 3, end: 9, data: 'b' }
    ]
    expect(() => buildContenteditableHtml('123456789', mentions)).toThrow(/Overlapping/)
  })

  it('handles trailing plain text after the last mention', () => {
    const mentions: MentionSegment[] = [{ start: 0, end: 6, data: 'codex' }]
    const out = buildContenteditableHtml('@codex says hi', mentions)
    expect(out).toBe('<span data-mention="codex">@codex</span> says hi')
  })

  it('preserves newlines in plain text segments around mentions', () => {
    const mentions: MentionSegment[] = [{ start: 6, end: 12, data: 'codex' }]
    const out = buildContenteditableHtml('hello\n@codex\nworld', mentions)
    expect(out).toBe('hello<br><span data-mention="codex">@codex</span><br>world')
  })

  it('omits className attribute when not provided', () => {
    const mentions: MentionSegment[] = [{ start: 0, end: 6, data: 'codex' }]
    expect(buildContenteditableHtml('@codex', mentions)).toBe(
      '<span data-mention="codex">@codex</span>'
    )
  })
})

describe('normalisePastedText', () => {
  it('returns empty string for empty input', () => {
    expect(normalisePastedText('')).toBe('')
  })

  it('strips simple tags', () => {
    expect(normalisePastedText('<b>hello</b>')).toBe('hello')
  })

  it('converts <br> variants to newlines', () => {
    expect(normalisePastedText('a<br>b<br/>c<br />d')).toBe('a\nb\nc\nd')
  })

  it('inserts newlines at </p> / </div> / </h1> / </li> / </tr>', () => {
    expect(normalisePastedText('<p>one</p><p>two</p>')).toBe('one\n\ntwo')
    expect(normalisePastedText('<div>a</div><div>b</div>')).toBe('a\n\nb')
    expect(normalisePastedText('<h1>title</h1><p>body</p>')).toBe('title\n\nbody')
  })

  it('decodes common HTML entities', () => {
    // Trailing &nbsp; is intentionally inside content (preceded
    // by text) so the trim doesn't strip it away — paste
    // normalisation deliberately trims surrounding whitespace
    // because most real-world pastes carry decorative ws.
    expect(normalisePastedText('text:&amp;&lt;&gt;&quot;&#39;&apos;&nbsp;x')).toBe("text:&<>\"'' x")
  })

  it('handles nested tags', () => {
    expect(normalisePastedText('<div><b>bold <i>italic</i></b></div>')).toBe('bold italic')
  })

  it('collapses 3+ newlines to 2', () => {
    expect(normalisePastedText('a<br><br><br><br>b')).toBe('a\n\nb')
  })

  it('trims surrounding whitespace', () => {
    expect(normalisePastedText('  \n\nhello\n\n  ')).toBe('hello')
  })

  it('preserves single newlines between content', () => {
    expect(normalisePastedText('line one<br>line two')).toBe('line one\nline two')
  })

  it('strips unknown tags without leaving content gaps', () => {
    expect(normalisePastedText('<custom>foo</custom>bar')).toBe('foobar')
  })

  it('handles real-world rich-paste shape (Google Docs style)', () => {
    const input = '<meta charset="utf-8"><b style="font-weight:bold">Hello</b>, <i>world</i>!'
    expect(normalisePastedText(input)).toBe('Hello, world!')
  })
})

describe('spliceTextAtCaret', () => {
  it('inserts at the caret', () => {
    const result = spliceTextAtCaret({
      value: 'hello world',
      caretOffset: 5,
      inserted: ' there'
    })
    expect(result.value).toBe('hello there world')
    expect(result.caretOffset).toBe(11)
  })

  it('inserts at the start', () => {
    const result = spliceTextAtCaret({ value: 'world', caretOffset: 0, inserted: 'hello ' })
    expect(result.value).toBe('hello world')
    expect(result.caretOffset).toBe(6)
  })

  it('inserts at the end', () => {
    const result = spliceTextAtCaret({ value: 'hello', caretOffset: 5, inserted: ' world' })
    expect(result.value).toBe('hello world')
    expect(result.caretOffset).toBe(11)
  })

  it('clamps caretOffset to 0 when negative', () => {
    const result = spliceTextAtCaret({ value: 'world', caretOffset: -3, inserted: 'X' })
    expect(result.value).toBe('Xworld')
    expect(result.caretOffset).toBe(1)
  })

  it('clamps caretOffset to value.length when too large', () => {
    const result = spliceTextAtCaret({ value: 'hi', caretOffset: 999, inserted: '!' })
    expect(result.value).toBe('hi!')
    expect(result.caretOffset).toBe(3)
  })

  it('handles empty insertion (no-op)', () => {
    const result = spliceTextAtCaret({ value: 'hello', caretOffset: 2, inserted: '' })
    expect(result.value).toBe('hello')
    expect(result.caretOffset).toBe(2)
  })

  it('handles empty value', () => {
    const result = spliceTextAtCaret({ value: '', caretOffset: 0, inserted: 'hi' })
    expect(result.value).toBe('hi')
    expect(result.caretOffset).toBe(2)
  })
})

describe('replaceTriggerWithMention', () => {
  it('replaces the trigger immediately before the caret', () => {
    // User typed "@Cod" (caret after "Cod"), picks "@Codex"
    const result = replaceTriggerWithMention({
      value: '@Cod',
      caretOffset: 4,
      triggerLength: 4,
      mentionText: '@Codex'
    })
    expect(result.value).toBe('@Codex')
    expect(result.caretOffset).toBe(6)
  })

  it('preserves text after the caret', () => {
    // "hello @Cod world", caret after "Cod"
    const result = replaceTriggerWithMention({
      value: 'hello @Cod world',
      caretOffset: 10,
      triggerLength: 4,
      mentionText: '@Codex'
    })
    expect(result.value).toBe('hello @Codex world')
    expect(result.caretOffset).toBe(12)
  })

  it('handles mention insertion at start of value', () => {
    const result = replaceTriggerWithMention({
      value: '@C hello',
      caretOffset: 2,
      triggerLength: 2,
      mentionText: '@Codex'
    })
    expect(result.value).toBe('@Codex hello')
    expect(result.caretOffset).toBe(6)
  })

  it('clamps triggerLength to the caret offset', () => {
    // triggerLength asks for 999 but caret is at 4 — only 4 chars get replaced.
    const result = replaceTriggerWithMention({
      value: '@Cod world',
      caretOffset: 4,
      triggerLength: 999,
      mentionText: '@Codex'
    })
    expect(result.value).toBe('@Codex world')
    expect(result.caretOffset).toBe(6)
  })

  it('handles empty mention text (delete the trigger)', () => {
    const result = replaceTriggerWithMention({
      value: 'hello @Cod world',
      caretOffset: 10,
      triggerLength: 4,
      mentionText: ''
    })
    expect(result.value).toBe('hello  world')
    expect(result.caretOffset).toBe(6)
  })
})
