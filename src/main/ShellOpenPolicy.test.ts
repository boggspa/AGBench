import { describe, expect, it } from 'vitest'
import { classifyShellOpenTarget } from './ShellOpenPolicy'

describe('ShellOpenPolicy', () => {
  it('allows web and mail links only as external targets', () => {
    expect(classifyShellOpenTarget('https://example.com/path')).toEqual({
      action: 'external',
      href: 'https://example.com/path'
    })
    expect(classifyShellOpenTarget('mailto:security@example.com')).toEqual({
      action: 'external',
      href: 'mailto:security@example.com'
    })
  })

  it('routes file URLs and scheme-less strings to openPath', () => {
    expect(classifyShellOpenTarget('file:///tmp/report.txt')).toEqual({
      action: 'path',
      path: '/tmp/report.txt'
    })
    expect(classifyShellOpenTarget('/tmp/report.txt')).toEqual({
      action: 'path',
      path: '/tmp/report.txt'
    })
  })

  it('rejects active or unsupported schemes', () => {
    expect(classifyShellOpenTarget('javascript:alert(1)')).toMatchObject({ action: 'deny' })
    expect(classifyShellOpenTarget('data:text/html,hello')).toMatchObject({ action: 'deny' })
    expect(classifyShellOpenTarget('ssh://example.com')).toMatchObject({ action: 'deny' })
  })

  it('treats single-letter prefixes as Windows paths', () => {
    expect(classifyShellOpenTarget('C:\\Users\\chris\\file.txt')).toEqual({
      action: 'path',
      path: 'C:\\Users\\chris\\file.txt'
    })
  })
})
