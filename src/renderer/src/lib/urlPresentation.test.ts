import { describe, expect, it } from 'vitest'
import { extractHttpUrls, normalizeHttpUrlTarget } from './urlPresentation'

describe('urlPresentation', () => {
  it('extracts and dedupes HTTP links without trailing sentence punctuation', () => {
    const urls = extractHttpUrls(
      'See https://github.com/boggspa/TaskWraith, then https://github.com/boggspa/TaskWraith.'
    )
    expect(urls).toEqual([
      {
        url: 'https://github.com/boggspa/TaskWraith',
        origin: 'https://github.com',
        host: 'github.com'
      }
    ])
  })

  it('keeps balanced closing parentheses that are part of the URL', () => {
    expect(normalizeHttpUrlTarget('https://example.com/wiki/Foo_(bar)')?.url).toBe(
      'https://example.com/wiki/Foo_(bar)'
    )
    expect(normalizeHttpUrlTarget('https://example.com/docs)')?.url).toBe(
      'https://example.com/docs'
    )
  })

  it('rejects non-http presentation targets', () => {
    expect(normalizeHttpUrlTarget('file:///tmp/report.html')).toBeNull()
    expect(normalizeHttpUrlTarget('javascript:alert(1)')).toBeNull()
  })
})
