import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { isPathInsideWorkspace, resolveAgenticPermission } from './AgenticPolicy'

const tempPaths: string[] = []

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), prefix))
  tempPaths.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempPaths.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

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
    const workspace = makeTempDir('taskwraith-policy-workspace-')

    expect(isPathInsideWorkspace(workspace, workspace)).toBe(true)
    expect(isPathInsideWorkspace(workspace, path.join(workspace, 'src/file.ts'))).toBe(true)
  })

  it('rejects outside paths', () => {
    const workspace = makeTempDir('taskwraith-policy-workspace-')
    const outside = makeTempDir('taskwraith-policy-outside-')

    expect(isPathInsideWorkspace(workspace, path.join(outside, 'file.ts'))).toBe(false)
    expect(isPathInsideWorkspace(workspace, path.join(workspace, '../secret.txt'))).toBe(false)
  })

  it('rejects paths that escape through symlinks', () => {
    const workspace = makeTempDir('taskwraith-policy-workspace-')
    const outside = makeTempDir('taskwraith-policy-outside-')
    const linkPath = path.join(workspace, 'linked-outside')
    fs.symlinkSync(outside, linkPath, 'dir')

    expect(isPathInsideWorkspace(workspace, path.join(linkPath, 'secret.txt'))).toBe(false)
  })
})
