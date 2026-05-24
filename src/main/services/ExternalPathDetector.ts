/*
 * ExternalPathDetector — slice 5 of the external-path-redesign arc.
 *
 * Inspects a tool-call's params for filesystem paths that fall outside
 * the workspace's containment. When detected, callers (Codex/Gemini/
 * Kimi registration sites in `main/index.ts`) override the generic
 * approval `actions` with the slice-4 triplet
 * (`grantExternalPathRead | grantExternalPathEdit | declineExternalPath`)
 * and stash the detected path under `preview.externalPathDetection` so
 * the renderer modal can display it prominently.
 *
 * Pure-ish: takes the values it needs as arguments, no module-level
 * singletons. Unit-tested in `ExternalPathDetector.test.ts`.
 */

import * as path from 'node:path'

/**
 * Map of tool-name lowercase → semantic category.
 * `read` = touches the file but doesn't mutate; needs READ grant.
 * `write` = mutates the file; needs EDIT grant.
 * Anything not in this map is treated as "not a file IO tool" and
 * the detector skips it entirely (e.g. shell commands, web search,
 * task tools — those have their own approval paths).
 */
const FILE_IO_TOOL_CATEGORY: Record<string, 'read' | 'write'> = {
  // Read-side
  read_file: 'read',
  list_directory: 'read',
  // Write-side
  write_file: 'write',
  replace: 'write',
  edit: 'write',
  edit_file: 'write',
  create_file: 'write',
  delete_file: 'write',
  multiedit: 'write',
  notebookedit: 'write',
  apply_patch: 'write',
  str_replace: 'write',
  str_replace_editor: 'write',
  strreplaceeditor: 'write'
}

/**
 * Strip `mcp__<server>__` / `agbench__` / `agentbench__` namespace
 * prefixes so the bare tool name can be category-looked up.
 */
function stripToolNamespace(toolName: string): string {
  const lower = (toolName || '').toLowerCase()
  if (lower.startsWith('mcp__')) {
    const idx = lower.indexOf('__', 5)
    return idx > 5 ? lower.slice(idx + 2) : lower
  }
  if (lower.startsWith('agbench__')) return lower.slice('agbench__'.length)
  if (lower.startsWith('agentbench__')) return lower.slice('agentbench__'.length)
  return lower
}

/**
 * Inspect a params object for the conventional path-bearing fields.
 * Returns the first non-empty absolute path found, or undefined.
 */
function extractPathFromParams(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined
  const record = params as Record<string, unknown>
  // Field order tracks ToolParser's `getPathFromRecord` (renderer side)
  // but stays local to main since we can't import across the bundle
  // boundary cleanly.
  const candidates = [
    record.path,
    record.filePath,
    record.file_path,
    record.target,
    record.target_file,
    record.target_file_path,
    record.targetPath,
    record.targetFile
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      const trimmed = candidate.trim()
      if (path.isAbsolute(trimmed)) return trimmed
    }
  }
  return undefined
}

/**
 * Decide whether a path lies outside the workspace. Returns true when:
 *   - workspacePath is missing (global chat — no workspace to be inside of)
 *   - the path resolves outside `workspacePath`
 *
 * Uses path normalisation + a trailing slash check to avoid false
 * positives on prefix matches (e.g. `/Users/me/proj-2` vs `/Users/me/proj`).
 */
function isOutsideWorkspace(absolutePath: string, workspacePath?: string): boolean {
  if (!workspacePath) return true
  const normalisedWorkspace = path.resolve(workspacePath).replace(/\/+$/, '')
  const normalisedPath = path.resolve(absolutePath).replace(/\/+$/, '')
  if (normalisedPath === normalisedWorkspace) return false
  return !normalisedPath.startsWith(normalisedWorkspace + path.sep)
}

export interface ExternalPathDetection {
  needsPrompt: boolean
  path?: string
  access?: 'read' | 'write'
  basename?: string
}

/**
 * Run the detector against a tool call. Returns
 * `{ needsPrompt: true, path, access, basename }` when the call
 * references a path outside the workspace AND the tool is a
 * recognised file-IO operation. Otherwise returns
 * `{ needsPrompt: false }`.
 *
 * Callers should plumb the result into the approval payload:
 *   - Override actions with the slice-4 triplet
 *   - Set `preview.externalPathDetection = { path, basename, access }`
 *   - Optionally adjust the `title` / `body` to mention the path
 */
export function detectExternalPath(input: {
  toolName: string
  params: unknown
  workspacePath?: string
  /**
   * Existing grants for the chat (provider-agnostic). When the path
   * is already granted at the same-or-higher access level, the
   * detector returns `needsPrompt: false` so the agent proceeds
   * without re-prompting.
   */
  existingGrants?: Array<{ path: string; access: 'read' | 'write' }>
}): ExternalPathDetection {
  const category = FILE_IO_TOOL_CATEGORY[stripToolNamespace(input.toolName)]
  if (!category) return { needsPrompt: false }

  const detectedPath = extractPathFromParams(input.params)
  if (!detectedPath) return { needsPrompt: false }

  if (!isOutsideWorkspace(detectedPath, input.workspacePath)) {
    return { needsPrompt: false }
  }

  // Honour existing grants — skip-prompt when the path is already
  // covered. A write-access grant covers read needs too; a read
  // grant doesn't cover write needs.
  if (input.existingGrants?.length) {
    const matching = input.existingGrants.find((grant) => {
      if (!grant?.path) return false
      const normalisedGrantPath = path.resolve(grant.path).replace(/\/+$/, '')
      const normalisedDetectedPath = path.resolve(detectedPath).replace(/\/+$/, '')
      if (normalisedGrantPath === normalisedDetectedPath) return true
      return normalisedDetectedPath.startsWith(normalisedGrantPath + path.sep)
    })
    if (matching) {
      if (category === 'read' || matching.access === 'write') {
        return { needsPrompt: false }
      }
    }
  }

  return {
    needsPrompt: true,
    path: detectedPath,
    access: category,
    basename: path.basename(detectedPath)
  }
}
