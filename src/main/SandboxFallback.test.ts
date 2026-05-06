import { describe, expect, it } from 'vitest'
import { isCodexSandboxToolingFailure } from './SandboxFallback'

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
})
