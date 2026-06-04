import { isAbsolute } from 'path'
import type { GeminiWorktreeLaunchOption } from '../store/types'
export function appendGeminiCliWorktreeArgs(
  args: string[],
  worktree: GeminiWorktreeLaunchOption = null
): string | null {
  if (!worktree) {
    return null
  }

  let enabled = false
  let name: string | undefined

  if (typeof worktree === 'boolean') {
    enabled = worktree
  } else if (typeof worktree === 'string') {
    enabled = true
    name = worktree
  } else {
    enabled = Boolean(worktree.enabled)
    name = typeof worktree.name === 'string' ? worktree.name : undefined
  }

  if (!enabled) {
    return null
  }

  const normalizedName = name?.trim()
  if (normalizedName) {
    const hasParentTraversal = normalizedName.split(/[\\/]+/).some((part) => part === '..')
    if (
      normalizedName.startsWith('-') ||
      isAbsolute(normalizedName) ||
      hasParentTraversal ||
      !/^[a-zA-Z0-9._/-]+$/.test(normalizedName)
    ) {
      return 'Invalid Gemini worktree name provided. Execution blocked.'
    }
    args.push('--worktree', normalizedName)
    return null
  }

  args.push('--worktree')
  return null
}
