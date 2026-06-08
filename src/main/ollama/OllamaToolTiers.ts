import { TASKWRAITH_MCP_TOOLS, type TaskWraithMcpToolName } from '../TaskWraithMcpTools'
import type { AppSettings, OllamaToolControlTier } from '../store/types'

export type OllamaToolName = TaskWraithMcpToolName

export const OLLAMA_READ_TOOL_NAMES = [
  'read_file',
  'list_directory',
  'workspace_search'
] as const satisfies readonly OllamaToolName[]

export const OLLAMA_FILE_EDIT_TOOL_NAMES = [
  'write_file',
  'replace',
  'apply_patch'
] as const satisfies readonly OllamaToolName[]

export const OLLAMA_SHELL_TOOL_NAMES = [
  'run_shell_command'
] as const satisfies readonly OllamaToolName[]

const OLLAMA_TIER4_EXTRA_TOOL_NAMES = TASKWRAITH_MCP_TOOLS.filter(
  (toolName) =>
    !OLLAMA_READ_TOOL_NAMES.includes(toolName as (typeof OLLAMA_READ_TOOL_NAMES)[number]) &&
    !OLLAMA_FILE_EDIT_TOOL_NAMES.includes(toolName as (typeof OLLAMA_FILE_EDIT_TOOL_NAMES)[number]) &&
    !OLLAMA_SHELL_TOOL_NAMES.includes(toolName as (typeof OLLAMA_SHELL_TOOL_NAMES)[number])
) as OllamaToolName[]

export const OLLAMA_KNOWN_TOOL_NAMES = new Set<OllamaToolName>(TASKWRAITH_MCP_TOOLS)

export function normalizeOllamaToolControlTier(
  value?: string | null
): OllamaToolControlTier {
  if (
    value === 'approved_edits' ||
    value === 'approved_shell' ||
    value === 'provider_parity'
  ) {
    return value
  }
  return 'read_only'
}

export function ollamaToolNamesForTier(
  tier: OllamaToolControlTier | string | undefined | null
): OllamaToolName[] {
  const normalized = normalizeOllamaToolControlTier(tier)
  if (normalized === 'provider_parity') {
    return [
      ...OLLAMA_READ_TOOL_NAMES,
      ...OLLAMA_FILE_EDIT_TOOL_NAMES,
      ...OLLAMA_SHELL_TOOL_NAMES,
      ...OLLAMA_TIER4_EXTRA_TOOL_NAMES
    ]
  }
  if (normalized === 'approved_shell') {
    return [...OLLAMA_READ_TOOL_NAMES, ...OLLAMA_FILE_EDIT_TOOL_NAMES, ...OLLAMA_SHELL_TOOL_NAMES]
  }
  if (normalized === 'approved_edits') {
    return [...OLLAMA_READ_TOOL_NAMES, ...OLLAMA_FILE_EDIT_TOOL_NAMES]
  }
  return [...OLLAMA_READ_TOOL_NAMES]
}

export function ollamaProviderParityWorkspaceGranted(
  settings: Pick<AppSettings, 'ollamaProviderParityWorkspaceGrants'>,
  workspacePath?: string | null
): boolean {
  const path = String(workspacePath || '').trim()
  if (!path) return false
  const grants = settings.ollamaProviderParityWorkspaceGrants || {}
  return typeof grants[path] === 'string' && grants[path].trim().length > 0
}

export function effectiveOllamaToolControlTier(
  settings: Pick<AppSettings, 'ollamaToolControlTier' | 'ollamaProviderParityWorkspaceGrants'>,
  workspacePath?: string | null
): OllamaToolControlTier {
  const tier = normalizeOllamaToolControlTier(settings.ollamaToolControlTier)
  if (tier !== 'provider_parity') return tier
  return ollamaProviderParityWorkspaceGranted(settings, workspacePath) ? 'provider_parity' : 'read_only'
}

export function ollamaToolAllowedInTier(
  toolName: string,
  tier: OllamaToolControlTier | string | undefined | null
): boolean {
  return ollamaToolNamesForTier(tier).includes(toolName as OllamaToolName)
}

export function ollamaToolRequiresIntent(toolName: string): boolean {
  return (
    OLLAMA_FILE_EDIT_TOOL_NAMES.includes(toolName as (typeof OLLAMA_FILE_EDIT_TOOL_NAMES)[number]) ||
    OLLAMA_SHELL_TOOL_NAMES.includes(toolName as (typeof OLLAMA_SHELL_TOOL_NAMES)[number])
  )
}

export function ollamaToolIntent(args: Record<string, unknown>): string {
  return String(args.intent || args.summary || args.reason || args.description || '').trim()
}

export function ollamaTierLabel(tier: OllamaToolControlTier): string {
  if (tier === 'provider_parity') return 'provider-parity'
  if (tier === 'approved_shell') return 'approved shell'
  if (tier === 'approved_edits') return 'approved file-edit'
  return 'read-only workspace'
}
