import { describe, expect, it } from 'vitest'

import { classifyMarkdownLink } from './classifyMarkdownLink'

describe('classifyMarkdownLink', () => {
  it('returns unknown for empty / nullish', () => {
    expect(classifyMarkdownLink('')).toEqual({ kind: 'unknown', resolved: '' })
    expect(classifyMarkdownLink(null)).toEqual({ kind: 'unknown', resolved: '' })
    expect(classifyMarkdownLink(undefined)).toEqual({ kind: 'unknown', resolved: '' })
  })

  it('classifies external schemes', () => {
    expect(classifyMarkdownLink('https://example.com')).toEqual({
      kind: 'external',
      resolved: 'https://example.com'
    })
    expect(classifyMarkdownLink('http://example.com')).toMatchObject({ kind: 'external' })
    expect(classifyMarkdownLink('mailto:alice@example.com')).toMatchObject({ kind: 'external' })
  })

  it('classifies agent chip URIs', () => {
    expect(classifyMarkdownLink('agent://abc-123')).toEqual({
      kind: 'agent',
      resolved: 'agent://abc-123'
    })
  })

  it('classifies absolute paths', () => {
    expect(classifyMarkdownLink('/Users/me/foo.ts')).toEqual({
      kind: 'path',
      resolved: '/Users/me/foo.ts'
    })
  })

  it('classifies relative paths', () => {
    expect(classifyMarkdownLink('./src/foo.ts')).toMatchObject({
      kind: 'path',
      resolved: './src/foo.ts'
    })
    expect(classifyMarkdownLink('../foo.ts')).toMatchObject({
      kind: 'path',
      resolved: '../foo.ts'
    })
  })

  it('classifies bare filenames as paths', () => {
    expect(classifyMarkdownLink('README.md')).toMatchObject({
      kind: 'path',
      resolved: 'README.md'
    })
  })

  it('strips :line:col suffix from paths', () => {
    expect(classifyMarkdownLink('/Users/me/foo.ts:42')).toEqual({
      kind: 'path',
      resolved: '/Users/me/foo.ts',
      line: 42
    })
    expect(classifyMarkdownLink('/Users/me/foo.ts:42:7')).toEqual({
      kind: 'path',
      resolved: '/Users/me/foo.ts',
      line: 42,
      column: 7
    })
  })

  it('decodes file:// URIs to plain paths', () => {
    expect(classifyMarkdownLink('file:///Users/me/foo%20bar.ts')).toMatchObject({
      kind: 'path',
      resolved: '/Users/me/foo bar.ts'
    })
  })

  it('refuses unsafe schemes', () => {
    expect(classifyMarkdownLink('javascript:alert(1)')).toMatchObject({ kind: 'unknown' })
    expect(classifyMarkdownLink('data:text/html,foo')).toMatchObject({ kind: 'unknown' })
    expect(classifyMarkdownLink('vbscript:msgbox(1)')).toMatchObject({ kind: 'unknown' })
  })

  it('refuses other unknown schemes', () => {
    expect(classifyMarkdownLink('ssh://server')).toMatchObject({ kind: 'unknown' })
    expect(classifyMarkdownLink('ftp://server')).toMatchObject({ kind: 'unknown' })
  })

  it('treats single-letter "scheme" as Windows drive-letter path', () => {
    expect(classifyMarkdownLink('C:\\Users\\me\\foo.ts')).toMatchObject({ kind: 'path' })
  })

  it('preserves https:// with port numbers', () => {
    expect(classifyMarkdownLink('https://example.com:8080/path')).toEqual({
      kind: 'external',
      resolved: 'https://example.com:8080/path'
    })
  })

  it('trims whitespace from href', () => {
    expect(classifyMarkdownLink('  /Users/me/foo.ts  ')).toMatchObject({
      kind: 'path',
      resolved: '/Users/me/foo.ts'
    })
  })
})
