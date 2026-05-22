import type { AgenticServicePolicy } from './store/types'
import fs from 'fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'path'

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
  const workspaceRoot = canonicalizeExistingOrPlannedPath(workspacePath)
  const target = canonicalizeExistingOrPlannedPath(targetPath)
  if (!workspaceRoot || !target) return false
  return isRelativePathInside(workspaceRoot, target)
}

function canonicalizeExistingOrPlannedPath(inputPath: string): string | null {
  let cursor = resolve(inputPath)
  const missingSegments: string[] = []

  while (true) {
    try {
      const real = fs.realpathSync.native(cursor)
      return resolve(real, ...missingSegments)
    } catch {
      const parent = dirname(cursor)
      if (parent === cursor) return null
      missingSegments.unshift(basename(cursor))
      cursor = parent
    }
  }
}

function isRelativePathInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}
