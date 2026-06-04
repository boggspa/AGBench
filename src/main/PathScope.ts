import { isAbsolute, relative, resolve, sep } from 'path'
import type { ChatScope } from './store/types'
import { isPathInsideWorkspace } from './AgenticPolicy'
export function resolveWorkspaceDirectory(workspacePath: string, requestedCwd?: string | null): string {
  const workspaceRoot = resolve(workspacePath)
  const cwd =
    requestedCwd && requestedCwd.trim()
      ? isAbsolute(requestedCwd)
        ? resolve(requestedCwd)
        : resolve(workspaceRoot, requestedCwd)
      : workspaceRoot
  if (!isPathInsideWorkspace(workspaceRoot, cwd)) {
    throw new Error('Command cwd is outside the workspace.')
  }
  return cwd
}

export function resolveHostDirectory(baseCwd: string, requestedCwd?: string | null): string {
  return requestedCwd && requestedCwd.trim()
    ? isAbsolute(requestedCwd)
      ? resolve(requestedCwd)
      : resolve(baseCwd, requestedCwd)
    : resolve(baseCwd)
}

export function resolveScopedDirectory(
  scope: ChatScope,
  baseCwd: string,
  workspacePath: string | undefined,
  requestedCwd?: string | null
): string {
  return scope === 'global'
    ? resolveHostDirectory(baseCwd, requestedCwd)
    : resolveWorkspaceDirectory(workspacePath || baseCwd, requestedCwd)
}

export function resolveGeminiMcpPath(workspacePath: string, filePath: string): string {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('A workspace path is required.')
  }
  return resolveWorkspaceChild(workspacePath, filePath)
}

export function resolveWorkspaceChild(workspace: string, filePath: string): string {
  const workspaceRoot = resolve(workspace)
  const targetPath = isAbsolute(filePath) ? resolve(filePath) : resolve(workspaceRoot, filePath)
  const rel = relative(workspaceRoot, targetPath)
  if (
    rel === '' ||
    rel === '..' ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel) ||
    !isPathInsideWorkspace(workspaceRoot, targetPath)
  ) {
    throw new Error('Path is outside the workspace.')
  }
  return targetPath
}

export function toWorkspaceRelativePath(workspace: string, targetPath: string): string {
  return relative(resolve(workspace), resolve(targetPath)).replace(/\\/g, '/')
}
