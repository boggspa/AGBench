import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'url'
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

  it('allows Apple System Settings deep links for local permission setup', () => {
    expect(
      classifyShellOpenTarget(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
      )
    ).toEqual({
      action: 'external',
      href: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
    })
  })

  it('routes file URLs and scheme-less strings to openPath', () => {
    const fileUrl =
      process.platform === 'win32' ? 'file:///C:/tmp/report.txt' : 'file:///tmp/report.txt'
    expect(classifyShellOpenTarget(fileUrl)).toEqual({
      action: 'path',
      path: fileURLToPath(fileUrl)
    })
    expect(classifyShellOpenTarget('/tmp/report.txt')).toEqual({
      action: 'path',
      path: '/tmp/report.txt'
    })
    expect(classifyShellOpenTarget('/System/Applications/Messages.app')).toEqual({
      action: 'path',
      path: '/System/Applications/Messages.app'
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
