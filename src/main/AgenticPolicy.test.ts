import { describe, expect, it } from 'vitest'
import { isPathInsideWorkspace, resolveAgenticPermission } from './AgenticPolicy'

describe('resolveAgenticPermission', () => {
  it('allows global allow', () => {
    expect(resolveAgenticPermission('allow')).toBe('allow')
  })

  it('denies global deny', () => {
    expect(resolveAgenticPermission('deny', true, true)).toBe('deny')
  })

  it('asks by default', () => {
    expect(resolveAgenticPermission('ask')).toBe('ask')
  })

  it('allows workspace policy only when a workspace grant exists', () => {
    expect(resolveAgenticPermission('workspace', false)).toBe('ask')
    expect(resolveAgenticPermission('workspace', true)).toBe('allow')
  })

  it('allows session grants for ask and workspace policies', () => {
    expect(resolveAgenticPermission('ask', false, true)).toBe('allow')
    expect(resolveAgenticPermission('workspace', false, true)).toBe('allow')
  })
})

describe('isPathInsideWorkspace', () => {
  it('accepts the workspace root and children', () => {
    expect(isPathInsideWorkspace('/tmp/workspace', '/tmp/workspace')).toBe(true)
    expect(isPathInsideWorkspace('/tmp/workspace', '/tmp/workspace/src/file.ts')).toBe(true)
  })

  it('rejects outside paths', () => {
    expect(isPathInsideWorkspace('/tmp/workspace', '/tmp/workspace-else/file.ts')).toBe(false)
    expect(isPathInsideWorkspace('/tmp/workspace', '/tmp/workspace/../secret.txt')).toBe(false)
  })
})
