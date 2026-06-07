import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveGeminiMcpPath } from './PathScope'

describe('resolveGeminiMcpPath', () => {
  it('allows the workspace root only when the caller opts in', () => {
    const workspace = resolve('/tmp/taskwraith-path-scope')

    expect(resolveGeminiMcpPath(workspace, '.', { allowWorkspaceRoot: true })).toBe(workspace)
    expect(() => resolveGeminiMcpPath(workspace, '.')).toThrow('Path is outside the workspace.')
  })

  it('still rejects paths outside the workspace', () => {
    const workspace = resolve('/tmp/taskwraith-path-scope')

    expect(() =>
      resolveGeminiMcpPath(workspace, '../outside', { allowWorkspaceRoot: true })
    ).toThrow('Path is outside the workspace.')
  })
})
