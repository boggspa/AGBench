import { describe, expect, it } from 'vitest'
import {
  isCodexSandboxToolingFailure,
  isSwiftPmCommand,
  isSwiftPmNestedSandboxFailure
} from './SandboxFallback'

describe('isCodexSandboxToolingFailure', () => {
  it('detects sandbox-exec apply failures', () => {
    expect(isCodexSandboxToolingFailure('sandbox-exec: sandbox_apply: Operation not permitted')).toBe(true)
  })

  it('detects SwiftPM cache permission collisions', () => {
    expect(isCodexSandboxToolingFailure('SwiftPM user cache under ~/Library/Caches/org.swift.swiftpm was not writable: Operation not permitted')).toBe(true)
  })

  it('detects Xcode sandbox operation failures', () => {
    expect(isCodexSandboxToolingFailure('xcrun failed inside sandbox: Operation not permitted')).toBe(true)
  })

  it('does not flag ordinary command failures', () => {
    expect(isCodexSandboxToolingFailure('npm test failed with exit code 1')).toBe(false)
    expect(isCodexSandboxToolingFailure('permission denied: ./script.sh')).toBe(false)
  })

  it('recognizes SwiftPM commands that trigger nested sandboxing', () => {
    expect(isSwiftPmCommand('swift test')).toBe(true)
    expect(isSwiftPmCommand('swift run RGBTriangles --auto-quit 1')).toBe(true)
    expect(isSwiftPmCommand(['swift', 'package', 'dump-package'])).toBe(true)
    expect(isSwiftPmCommand('swift build')).toBe(false)
  })

  it('requires both a SwiftPM command and sandbox failure for nested fallback', () => {
    expect(
      isSwiftPmNestedSandboxFailure(
        'swift test',
        'sandbox-exec: sandbox_apply: Operation not permitted'
      )
    ).toBe(true)
    expect(
      isSwiftPmNestedSandboxFailure(
        'npm test',
        'sandbox-exec: sandbox_apply: Operation not permitted'
      )
    ).toBe(false)
  })
})
