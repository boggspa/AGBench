import type { AgenticServicePolicy } from './store/types'
import { isAbsolute, relative, resolve } from 'path'

export type AgenticPermissionDecision = 'allow' | 'ask' | 'deny'

export function resolveAgenticPermission(
  policy: AgenticServicePolicy | undefined,
  hasWorkspaceGrant = false,
  hasSessionGrant = false
): AgenticPermissionDecision {
  if (policy === 'deny') return 'deny'
  if (policy === 'allow' || hasSessionGrant) return 'allow'
  if (policy === 'workspace' && hasWorkspaceGrant) return 'allow'
  return 'ask'
}

export function isPathInsideWorkspace(workspacePath: string, targetPath: string): boolean {
  const workspaceRoot = resolve(workspacePath)
  const target = resolve(targetPath)
  const rel = relative(workspaceRoot, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
