import { describe, expect, it } from 'vitest'
import { resolveRegisteredExplicitExternalPath } from './ExternalPathGrantRequest'
import type { WorkspaceRecord } from './store/types'

function makeWorkspace(path: string): WorkspaceRecord {
  return {
    id: 'workspace-1',
    path,
    displayName: 'repo',
    createdAt: 1,
    lastOpenedAt: 1,
    pinned: false
  }
}

describe('resolveRegisteredExplicitExternalPath', () => {
  it('accepts an explicit path only when it exactly matches a registered workspace', () => {
    const workspace = makeWorkspace('/repo')
    const result = resolveRegisteredExplicitExternalPath({
      explicitPath: '/repo',
      canonicalPath: (value) => value,
      findRegisteredWorkspace: (value) => (value === workspace.path ? workspace : undefined)
    })
    expect(result).toEqual({ path: '/repo', workspace })
  })

  it('rejects arbitrary explicit paths and registered workspace descendants', () => {
    const workspace = makeWorkspace('/repo')
    const findRegisteredWorkspace = (value: string) =>
      value === workspace.path ? workspace : undefined

    expect(
      resolveRegisteredExplicitExternalPath({
        explicitPath: '/tmp/unregistered',
        canonicalPath: (value) => value,
        findRegisteredWorkspace
      })
    ).toBeNull()
    expect(
      resolveRegisteredExplicitExternalPath({
        explicitPath: '/repo/subdir',
        canonicalPath: (value) => value,
        findRegisteredWorkspace
      })
    ).toBeNull()
  })
})
