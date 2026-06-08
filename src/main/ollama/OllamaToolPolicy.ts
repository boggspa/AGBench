import {
  assertPatchPathsInScope,
  formatScopedPath,
  resolveMcpScopedPath,
  type WorkspaceToolContext
} from '../mcp/WorkspaceToolExecutors'
import type { OllamaToolControlTier } from '../store/types'
import { ollamaToolIntent, ollamaToolRequiresIntent } from './OllamaToolTiers'

export const OLLAMA_PROTECTED_WORKSPACE_PATHS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.ssh',
  '.aws',
  '.config',
  '.npmrc',
  '.yarnrc',
  '.pnpmrc',
  '.env',
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'Podfile.lock',
  'electron-builder.yml',
  'electron-builder.yaml',
  'entitlements.mac.plist',
  'entitlements.plist'
])

const OLLAMA_FORCE_PROMPT_TOOLS = new Set([
  'write_file',
  'replace',
  'apply_patch',
  'run_shell_command'
])

export function ollamaProtectedPathReason(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const parts = normalized.split('/').filter(Boolean)
  const basename = parts[parts.length - 1] || normalized
  if (parts.some((part) => part === '.git' || part === '.hg' || part === '.svn')) {
    return 'version-control metadata is protected'
  }
  if (basename === '.env' || basename.startsWith('.env.')) {
    return 'environment/secret files are protected'
  }
  if (/\.(pem|key|p12|pfx|mobileprovision)$/i.test(basename)) {
    return 'credential/key material is protected'
  }
  if (OLLAMA_PROTECTED_WORKSPACE_PATHS.has(normalized) || OLLAMA_PROTECTED_WORKSPACE_PATHS.has(basename)) {
    return 'this workspace control file is protected'
  }
  if (parts.includes('.github')) {
    return 'CI/workflow configuration is protected'
  }
  return null
}

export function assertOllamaMutationIntent(
  toolName: string,
  args: Record<string, unknown>
): void {
  if (!ollamaToolRequiresIntent(toolName)) return
  if (ollamaToolIntent(args)) return
  throw new Error(`${toolName} requires an intent or summary before TaskWraith can request approval.`)
}

export function assertOllamaProtectedWritePaths(
  toolName: string,
  args: Record<string, unknown>,
  context: WorkspaceToolContext,
  cwd: string
): void {
  const checkRelativePath = (relativePath: string): void => {
    const reason = ollamaProtectedPathReason(relativePath)
    if (reason) {
      throw new Error(`Ollama cannot modify ${relativePath}: ${reason}.`)
    }
  }
  if (toolName === 'write_file' || toolName === 'replace') {
    const targetPath = resolveMcpScopedPath(context, String(args.path || args.file_path || ''))
    checkRelativePath(formatScopedPath(context, targetPath))
  }
  if (toolName === 'apply_patch') {
    const patch = String(args.patch || args.diff || '')
    const patchPaths = assertPatchPathsInScope(context, cwd, patch)
    for (const patchPath of patchPaths) {
      checkRelativePath(patchPath)
    }
  }
}

export function ollamaToolRequiresModalApproval(
  toolName: string,
  tier: OllamaToolControlTier | null | undefined
): boolean {
  return Boolean(tier && tier !== 'provider_parity' && OLLAMA_FORCE_PROMPT_TOOLS.has(toolName))
}
