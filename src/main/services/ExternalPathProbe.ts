/*
 * ExternalPathProbe — main-process side of the runtime external-path
 * detection flow. Given an absolute filesystem path, decides whether
 * the path is inside a git repo and (if so) what branch is currently
 * checked out.
 *
 * Slice 1 of the external-path-redesign arc. Pure-ish: takes the `fs`
 * promises API as an injectable dependency so the test suite can mock
 * it. Doesn't touch the renderer, doesn't touch IPC — that wiring
 * lives in `main/index.ts` registering `ipcMain.handle('probe-external
 * -path', ...)` against this module.
 *
 * Repo detection rules:
 *   - Walk up the directory tree from `absolutePath` looking for
 *     `.git` (directory or file — `.git` can be a regular file in
 *     git worktrees, holding a `gitdir: <path>` pointer).
 *   - Stop at filesystem root.
 *   - First match wins; that directory IS the repo root.
 *
 * Branch detection rules:
 *   - Read `<repoRoot>/.git/HEAD` (or follow the `gitdir:` pointer
 *     for worktrees).
 *   - If HEAD starts with `ref: refs/heads/<branch>`, branch is
 *     `<branch>`.
 *   - If HEAD is a raw SHA (detached HEAD), branch is undefined.
 *
 * Returns null when:
 *   - The path doesn't exist on disk
 *   - No `.git` is found walking up
 *
 * Returns `{ isRepo: true, repoRoot, branch? }` when a repo is found.
 */

import * as path from 'node:path'
import { promises as fsPromises } from 'node:fs'

export interface ExternalPathProbeResult {
  isRepo: boolean
  repoRoot: string
  /** Undefined when HEAD is detached or unreadable. */
  branch?: string
}

interface FsLike {
  stat: (path: string) => Promise<{ isDirectory(): boolean; isFile(): boolean }>
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>
}

/**
 * Probe an absolute path. Returns the repo descriptor if the path
 * is inside a git repo, or null otherwise.
 *
 * `fs` is injectable for test mocking; production callers pass
 * `fsPromises` (the default).
 */
export async function probeExternalPath(
  absolutePath: string,
  fs: FsLike = fsPromises as unknown as FsLike
): Promise<ExternalPathProbeResult | null> {
  if (!absolutePath || !path.isAbsolute(absolutePath)) {
    return null
  }

  // Confirm the path itself exists. We don't strictly need this — the
  // walk-up loop would just bottom out at root — but failing fast on
  // non-existent paths produces a clearer error path for callers.
  try {
    await fs.stat(absolutePath)
  } catch {
    return null
  }

  const repoRoot = await findRepoRoot(absolutePath, fs)
  if (!repoRoot) return null

  const branch = await readCurrentBranch(repoRoot, fs)
  return { isRepo: true, repoRoot, branch }
}

/**
 * Walk up looking for `.git`. Returns the directory CONTAINING `.git`,
 * which is the repo root.
 */
async function findRepoRoot(startPath: string, fs: FsLike): Promise<string | null> {
  let current = startPath

  // If startPath is a file, its containing directory is the search
  // starting point. We don't need to check whether it's a file first;
  // `path.dirname(<file>)` correctly returns the parent.
  try {
    const stat = await fs.stat(current)
    if (stat.isFile()) {
      current = path.dirname(current)
    }
  } catch {
    return null
  }

  const root = path.parse(current).root
  while (current && current !== root) {
    const dotGit = path.join(current, '.git')
    try {
      const stat = await fs.stat(dotGit)
      if (stat.isDirectory() || stat.isFile()) {
        return current
      }
    } catch {
      // No .git at this level; walk up.
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return null
}

/**
 * Read the current branch by parsing `<repoRoot>/.git/HEAD`. Handles:
 *   - Normal repo: `.git/HEAD` is a file with `ref: refs/heads/<branch>`
 *   - Worktree: `.git` is a regular file with `gitdir: <abs path>`;
 *     follow the pointer and read the HEAD inside that pointed dir.
 *   - Detached HEAD: HEAD content is a raw 40-char SHA. Returns undefined.
 */
async function readCurrentBranch(repoRoot: string, fs: FsLike): Promise<string | undefined> {
  const dotGitPath = path.join(repoRoot, '.git')
  let headPath: string

  try {
    const dotGitStat = await fs.stat(dotGitPath)
    if (dotGitStat.isFile()) {
      // Worktree: `.git` is a pointer file like `gitdir: /abs/path/...`.
      const pointer = (await fs.readFile(dotGitPath, 'utf8')).trim()
      const match = pointer.match(/^gitdir:\s*(.+)$/m)
      if (!match) return undefined
      const gitDirAbs = path.isAbsolute(match[1]) ? match[1] : path.resolve(repoRoot, match[1])
      headPath = path.join(gitDirAbs, 'HEAD')
    } else {
      headPath = path.join(dotGitPath, 'HEAD')
    }
  } catch {
    return undefined
  }

  try {
    const headContent = (await fs.readFile(headPath, 'utf8')).trim()
    const refMatch = headContent.match(/^ref:\s*refs\/heads\/(.+)$/)
    if (refMatch) return refMatch[1].trim()
    // Otherwise HEAD is a raw SHA (detached). No branch to report.
    return undefined
  } catch {
    return undefined
  }
}
