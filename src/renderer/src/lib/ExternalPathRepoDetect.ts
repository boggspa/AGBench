/*
 * ExternalPathRepoDetect — renderer-side helper that turns a probe
 * result + an absolute path into a display-ready descriptor for the
 * stacked above-rows.
 *
 * Slice 1 of the external-path-redesign arc. Pure functions: no IPC,
 * no React. The renderer's `useExternalPathRepoMetadata` hook (slice 2)
 * does the IPC; this module shapes the result so the row component
 * (slice 3) renders consistently for both repo and non-repo grants.
 */

import { pathBasename, stripTrailingPathSeparators } from './pathDisplay'

/** Subset of `ExternalPathProbeResult` consumed by the renderer. */
export interface ExternalPathGitMetadata {
  isRepo: boolean
  repoRoot: string
  branch?: string
}

export interface ExternalPathDescriptor {
  /** True when the probe found a `.git` walking up from the path. */
  isRepo: boolean
  /** The git repo root, or the path itself if not a repo. */
  repoRoot: string
  /** Display-friendly basename. For a repo, this is the repo-root
   * directory's basename (e.g. `TaskWraith`). For a file or non-repo
   * folder, the basename of the path itself. */
  basename: string
  /** Current branch when the path lives inside a git repo with a
   * non-detached HEAD; undefined otherwise. */
  branch?: string
  /** Same as basename today; kept as a separate field so callers can
   * customise repo display later (e.g. owner/repo from origin URL)
   * without breaking the basename usage. */
  repoName?: string
}

/**
 * Compose a render-ready descriptor from a probe result + raw path.
 *
 * Both the probe and the path are needed because non-repo paths still
 * deserve a row (showing just the basename), so we can't bail when
 * `gitMetadata` is null — we just emit `{ isRepo: false }`.
 */
export function describeExternalPath(
  absolutePath: string,
  opts?: { gitMetadata?: ExternalPathGitMetadata | null }
): ExternalPathDescriptor {
  const gitMetadata = opts?.gitMetadata ?? null
  const trimmed = stripTrailingPathSeparators(absolutePath || '')
  const displayBasename = pathBasename(trimmed, trimmed || '/')

  if (gitMetadata && gitMetadata.isRepo) {
    const repoBasename = pathBasename(gitMetadata.repoRoot, gitMetadata.repoRoot)
    return {
      isRepo: true,
      repoRoot: gitMetadata.repoRoot,
      basename: repoBasename,
      branch: gitMetadata.branch,
      repoName: repoBasename
    }
  }

  return {
    isRepo: false,
    repoRoot: trimmed || absolutePath,
    basename: displayBasename
  }
}
