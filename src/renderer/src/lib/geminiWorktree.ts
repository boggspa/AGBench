import type { WorkspaceRecord, GeminiWorktreeConfig } from '../../../main/store/types'

const WORKTREE_DIFF_UNAVAILABLE_TEXT =
  'Gemini worktree mode is active, but the effective worktree path is not known. Diff Studio is disabled so it does not show changes from the original workspace.'

const createWorktreeDiffUnavailable = () => ({
  type: 'error',
  text: WORKTREE_DIFF_UNAVAILABLE_TEXT
})

const resolveGeminiWorktreeConfig = (
  workspace?: WorkspaceRecord | null
): GeminiWorktreeConfig | undefined => {
  const worktree = workspace?.geminiWorktree
  if (!worktree?.enabled) {
    return undefined
  }

  const name = typeof worktree.name === 'string' ? worktree.name.trim() : undefined
  const effectivePath =
    typeof worktree.effectivePath === 'string' ? worktree.effectivePath.trim() : undefined
  return {
    enabled: true,
    ...(name ? { name } : {}),
    ...(effectivePath ? { effectivePath } : {})
  }
}

const isGeminiWorktreeDiffUnavailable = (worktree?: GeminiWorktreeConfig | null): boolean =>
  Boolean(worktree?.enabled && !worktree.effectivePath)

const getDiffWorkspacePath = (
  workspace: WorkspaceRecord,
  worktree?: GeminiWorktreeConfig | null
): string => (worktree?.enabled && worktree.effectivePath ? worktree.effectivePath : workspace.path)

export {
  WORKTREE_DIFF_UNAVAILABLE_TEXT,
  createWorktreeDiffUnavailable,
  resolveGeminiWorktreeConfig,
  isGeminiWorktreeDiffUnavailable,
  getDiffWorkspacePath
}
