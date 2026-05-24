import { describe, it, expect, vi } from 'vitest'
import { probeExternalPath } from './ExternalPathProbe'

/**
 * Mock fs builder. `tree` is a map of absolute path → entry descriptor.
 *   - `{ kind: 'dir' }` → a directory
 *   - `{ kind: 'file', content?: string }` → a file (optional content for readFile)
 *
 * Any path not in the tree throws ENOENT on stat/readFile, mimicking
 * a real fs.
 */
function buildFs(tree: Record<string, { kind: 'dir' | 'file'; content?: string }>) {
  return {
    stat: vi.fn(async (p: string) => {
      const entry = tree[p]
      if (!entry) throw new Error(`ENOENT: ${p}`)
      return {
        isDirectory: () => entry.kind === 'dir',
        isFile: () => entry.kind === 'file'
      }
    }),
    readFile: vi.fn(async (p: string, _encoding: BufferEncoding) => {
      const entry = tree[p]
      if (!entry || entry.kind !== 'file') {
        throw new Error(`ENOENT: ${p}`)
      }
      return entry.content || ''
    })
  }
}

describe('probeExternalPath', () => {
  it('returns null for relative paths', async () => {
    const fs = buildFs({})
    expect(await probeExternalPath('./relative/path', fs)).toBeNull()
  })

  it('returns null when path does not exist', async () => {
    const fs = buildFs({})
    expect(await probeExternalPath('/missing/path', fs)).toBeNull()
  })

  it('detects a repo with .git directory and a normal branch HEAD', async () => {
    const fs = buildFs({
      '/repo/src/file.ts': { kind: 'file', content: 'export {}' },
      '/repo/src': { kind: 'dir' },
      '/repo': { kind: 'dir' },
      '/repo/.git': { kind: 'dir' },
      '/repo/.git/HEAD': { kind: 'file', content: 'ref: refs/heads/main\n' }
    })
    const result = await probeExternalPath('/repo/src/file.ts', fs)
    expect(result).toEqual({ isRepo: true, repoRoot: '/repo', branch: 'main' })
  })

  it('detects a repo with detached HEAD (no branch)', async () => {
    const fs = buildFs({
      '/repo/src/file.ts': { kind: 'file' },
      '/repo/src': { kind: 'dir' },
      '/repo': { kind: 'dir' },
      '/repo/.git': { kind: 'dir' },
      '/repo/.git/HEAD': {
        kind: 'file',
        content: 'b1946ac92492d2347c6235b4d2611184cf8a8b6b\n'
      }
    })
    const result = await probeExternalPath('/repo/src/file.ts', fs)
    expect(result).toEqual({ isRepo: true, repoRoot: '/repo', branch: undefined })
  })

  it('detects a worktree via `.git` pointer file', async () => {
    const fs = buildFs({
      '/worktree/file.ts': { kind: 'file' },
      '/worktree': { kind: 'dir' },
      '/worktree/.git': {
        kind: 'file',
        content: 'gitdir: /main-repo/.git/worktrees/wt1\n'
      },
      '/main-repo/.git/worktrees/wt1/HEAD': {
        kind: 'file',
        content: 'ref: refs/heads/feature-branch\n'
      }
    })
    const result = await probeExternalPath('/worktree/file.ts', fs)
    expect(result).toEqual({
      isRepo: true,
      repoRoot: '/worktree',
      branch: 'feature-branch'
    })
  })

  it('walks up multiple levels to find the repo root', async () => {
    const fs = buildFs({
      '/a/b/c/d/file.ts': { kind: 'file' },
      '/a/b/c/d': { kind: 'dir' },
      '/a/b/c': { kind: 'dir' },
      '/a/b': { kind: 'dir' },
      '/a': { kind: 'dir' },
      '/a/.git': { kind: 'dir' },
      '/a/.git/HEAD': { kind: 'file', content: 'ref: refs/heads/master\n' }
    })
    const result = await probeExternalPath('/a/b/c/d/file.ts', fs)
    expect(result).toEqual({ isRepo: true, repoRoot: '/a', branch: 'master' })
  })

  it('returns null when no .git is found walking up to root', async () => {
    const fs = buildFs({
      '/just/a/dir/file.ts': { kind: 'file' },
      '/just/a/dir': { kind: 'dir' },
      '/just/a': { kind: 'dir' },
      '/just': { kind: 'dir' }
    })
    expect(await probeExternalPath('/just/a/dir/file.ts', fs)).toBeNull()
  })

  it('handles a path that points to the repo root itself', async () => {
    const fs = buildFs({
      '/repo': { kind: 'dir' },
      '/repo/.git': { kind: 'dir' },
      '/repo/.git/HEAD': { kind: 'file', content: 'ref: refs/heads/dev\n' }
    })
    const result = await probeExternalPath('/repo', fs)
    expect(result).toEqual({ isRepo: true, repoRoot: '/repo', branch: 'dev' })
  })

  it('returns repo with undefined branch when HEAD is missing', async () => {
    const fs = buildFs({
      '/repo/file.ts': { kind: 'file' },
      '/repo': { kind: 'dir' },
      '/repo/.git': { kind: 'dir' }
      // No HEAD file
    })
    const result = await probeExternalPath('/repo/file.ts', fs)
    expect(result).toEqual({ isRepo: true, repoRoot: '/repo', branch: undefined })
  })
})
