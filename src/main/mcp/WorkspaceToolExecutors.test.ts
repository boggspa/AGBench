import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveMcpScopedPath } from './WorkspaceToolExecutors'

describe('resolveMcpScopedPath', () => {
  it('allows workspace-root directory/search targets only when requested', () => {
    const workspace = resolve('/tmp/taskwraith-workspace-tools')
    const context = {
      scope: 'workspace' as const,
      cwd: workspace,
      workspacePath: workspace
    }

    expect(resolveMcpScopedPath(context, '.', { allowWorkspaceRoot: true })).toBe(workspace)
    expect(() => resolveMcpScopedPath(context, '.')).toThrow('Path is outside the workspace.')
  })

  it('continues to reject outside-workspace targets', () => {
    const workspace = resolve('/tmp/taskwraith-workspace-tools')
    const context = {
      scope: 'workspace' as const,
      cwd: workspace,
      workspacePath: workspace
    }

    expect(() =>
      resolveMcpScopedPath(context, '../outside', { allowWorkspaceRoot: true })
    ).toThrow('Path is outside the workspace.')
  })
})
