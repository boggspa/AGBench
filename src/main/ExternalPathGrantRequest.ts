import type { WorkspaceRecord } from './store/types'

export interface RegisteredExplicitExternalPath {
  path: string
  workspace: WorkspaceRecord
}

export function resolveRegisteredExplicitExternalPath(input: {
  explicitPath: string
  findRegisteredWorkspace: (workspacePath: string) => WorkspaceRecord | undefined
  canonicalPath: (value: string) => string
}): RegisteredExplicitExternalPath | null {
  const selectedPath = input.canonicalPath(input.explicitPath)
  const workspace = input.findRegisteredWorkspace(selectedPath)
  if (!workspace) return null
  return {
    path: input.canonicalPath(workspace.path),
    workspace
  }
}
