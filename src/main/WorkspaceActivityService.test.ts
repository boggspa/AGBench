import { execFileSync } from 'child_process'
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearWorkspaceActivityCache,
  getWorkspaceActivitySnapshot
} from './WorkspaceActivityService'

const NOW = Date.parse('2026-05-31T12:00:00.000Z')

const tempDirs: string[] = []

async function makeTempWorkspace(prefix = 'taskwraith-workspace-activity-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function git(cwd: string, args: string[], env: Record<string, string> = {}): void {
  execFileSync('git', args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'ignore'
  })
}

async function initGitWorkspace(): Promise<string> {
  const dir = await makeTempWorkspace('taskwraith-workspace-activity-git-')
  git(dir, ['init'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'TaskWraith Test'])
  return dir
}

afterEach(async () => {
  clearWorkspaceActivityCache()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('getWorkspaceActivitySnapshot', () => {
  it('uses git commit timestamps for git workspaces without exposing file details', async () => {
    const dir = await initGitWorkspace()
    await writeFile(join(dir, 'tracked.txt'), 'hello\n')
    git(dir, ['add', '.'])
    git(dir, ['commit', '-m', 'initial'], {
      GIT_AUTHOR_DATE: '2026-05-30T10:00:00.000Z',
      GIT_COMMITTER_DATE: '2026-05-30T10:00:00.000Z'
    })

    const snapshot = await getWorkspaceActivitySnapshot(dir, 90, { now: NOW, cacheTtlMs: 0 })

    expect(snapshot.source).toBe('git')
    expect(snapshot.stats.gitRepo).toBe(true)
    expect(snapshot.stats.commits).toBe(1)
    expect(snapshot.events).toEqual([
      expect.objectContaining({
        kind: 'git_commit',
        timestamp: Date.parse('2026-05-30T10:00:00.000Z')
      })
    ])
    expect(JSON.stringify(snapshot.events)).not.toContain('tracked.txt')
    expect(JSON.stringify(snapshot.events)).not.toContain('initial')
  })

  it('adds current worktree changed-file mtimes for dirty git workspaces', async () => {
    const dir = await initGitWorkspace()
    const filePath = join(dir, 'tracked.txt')
    await writeFile(filePath, 'before\n')
    git(dir, ['add', '.'])
    git(dir, ['commit', '-m', 'initial'], {
      GIT_AUTHOR_DATE: '2026-05-20T10:00:00.000Z',
      GIT_COMMITTER_DATE: '2026-05-20T10:00:00.000Z'
    })
    await writeFile(filePath, 'after\n')
    const dirtyTime = new Date('2026-05-31T09:30:00.000Z')
    await utimes(filePath, dirtyTime, dirtyTime)

    const snapshot = await getWorkspaceActivitySnapshot(dir, 90, { now: NOW, cacheTtlMs: 0 })

    expect(snapshot.source).toBe('git')
    expect(snapshot.stats.worktreeFiles).toBe(1)
    expect(snapshot.events.some((event) => event.kind === 'worktree_change')).toBe(true)
    expect(JSON.stringify(snapshot.events)).not.toContain('tracked.txt')
  })

  it('falls back to bounded filesystem mtimes for non-git workspaces', async () => {
    const dir = await makeTempWorkspace('taskwraith-workspace-activity-fs-')
    const sourceFile = join(dir, 'source.ts')
    await writeFile(sourceFile, 'export const value = 1\n')
    const sourceTime = new Date('2026-05-29T14:00:00.000Z')
    await utimes(sourceFile, sourceTime, sourceTime)
    await mkdir(join(dir, 'node_modules'), { recursive: true })
    const ignoredFile = join(dir, 'node_modules', 'ignored.js')
    await writeFile(ignoredFile, 'ignored\n')
    await utimes(ignoredFile, sourceTime, sourceTime)

    const snapshot = await getWorkspaceActivitySnapshot(dir, 90, { now: NOW, cacheTtlMs: 0 })

    expect(snapshot.source).toBe('filesystem')
    expect(snapshot.stats.gitRepo).toBe(false)
    expect(snapshot.stats.filesystemFiles).toBe(1)
    expect(snapshot.stats.scannedFiles).toBe(1)
    expect(snapshot.events).toEqual([
      expect.objectContaining({
        kind: 'filesystem_change',
        timestamp: sourceTime.getTime()
      })
    ])
    expect(JSON.stringify(snapshot.events)).not.toContain('source.ts')
  })

  it('marks filesystem snapshots truncated when the scan cap is reached', async () => {
    const dir = await makeTempWorkspace('taskwraith-workspace-activity-cap-')
    for (let index = 0; index < 4; index += 1) {
      await writeFile(join(dir, `file-${index}.txt`), `${index}\n`)
    }

    const snapshot = await getWorkspaceActivitySnapshot(dir, 90, {
      now: NOW,
      cacheTtlMs: 0,
      scanLimit: 2
    })

    expect(snapshot.source).toBe('filesystem')
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.stats.scannedFiles).toBe(2)
    expect(snapshot.stats.scanLimit).toBe(2)
  })
})
