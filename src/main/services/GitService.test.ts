import { execFileSync, spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitService, parseStatusPorcelainZ, type GitCommandRunner } from './GitService'

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function createRepo(): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'agbench-git-service-')))
  runGit(repo, ['init', '-b', 'main'])
  runGit(repo, ['config', 'user.name', 'AGBench Test'])
  runGit(repo, ['config', 'user.email', 'agbench@example.test'])
  writeFileSync(join(repo, 'README.md'), 'initial\n')
  runGit(repo, ['add', 'README.md'])
  runGit(repo, ['commit', '-m', 'Initial commit'])
  return repo
}

describe('GitService', () => {
  let repo: string

  beforeEach(() => {
    repo = createRepo()
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('parses porcelain status records', () => {
    expect(parseStatusPorcelainZ(' M README.md\0?? new file.txt\0')).toEqual([
      {
        path: 'README.md',
        index: ' ',
        workingTree: 'M',
        kind: 'modified',
        staged: false,
        unstaged: true
      },
      {
        path: 'new file.txt',
        index: '?',
        workingTree: '?',
        kind: 'untracked',
        staged: false,
        unstaged: true
      }
    ])
  })

  it('resolves the repository root from a nested directory', async () => {
    const nested = join(repo, 'src', 'feature')
    mkdirSync(nested, { recursive: true })

    const result = await new GitService().snapshot(nested)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.repoRoot).toBe(repo)
    expect(result.data.requestedPath).toBe(nested)
    expect(result.data.branch).toBe('main')
    expect(result.data.clean).toBe(true)
  })

  it('reports changed and untracked files', async () => {
    writeFileSync(join(repo, 'README.md'), 'changed\n')
    writeFileSync(join(repo, 'new.txt'), 'new\n')

    const result = await new GitService().snapshot(repo)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.counts.changed).toBe(2)
    expect(result.data.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'README.md', kind: 'modified', unstaged: true }),
        expect.objectContaining({ path: 'new.txt', kind: 'untracked', unstaged: true })
      ])
    )
  })

  it('stages selected paths without staging every file', async () => {
    writeFileSync(join(repo, 'one.txt'), 'one\n')
    writeFileSync(join(repo, 'two.txt'), 'two\n')

    const result = await new GitService().stage({ repoPath: repo, paths: ['one.txt'] })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'one.txt', staged: true }),
        expect.objectContaining({ path: 'two.txt', kind: 'untracked', staged: false })
      ])
    )
  })

  it('commits staged changes and returns a clean snapshot', async () => {
    writeFileSync(join(repo, 'committed.txt'), 'committed\n')
    const service = new GitService()
    const stageResult = await service.stage({ repoPath: repo, all: true })
    expect(stageResult.ok).toBe(true)

    const commitResult = await service.commit({ repoPath: repo, message: 'Add committed file' })

    expect(commitResult.ok).toBe(true)
    if (!commitResult.ok) return
    expect(commitResult.data.clean).toBe(true)
    expect(runGit(repo, ['log', '-1', '--pretty=%s']).trim()).toBe('Add committed file')
  })

  it('runs gh pr create from the resolved repository root', async () => {
    const nested = join(repo, 'nested')
    mkdirSync(nested, { recursive: true })
    const calls: Array<{ command: string; args: string[]; cwd: string }> = []
    const runner: GitCommandRunner = async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd })
      if (command === 'gh') {
        return {
          stdout: 'https://github.com/boggspa/AGBench/pull/42\n',
          stderr: '',
          code: 0
        }
      }
      const result = spawnSync(command, args, {
        cwd: options.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        code: result.status ?? 0
      }
    }

    const result = await new GitService({ run: runner }).createPullRequest({
      repoPath: nested,
      draft: true
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.url).toBe('https://github.com/boggspa/AGBench/pull/42')
    expect(calls.find((call) => call.command === 'gh')).toEqual({
      command: 'gh',
      args: ['pr', 'create', '--fill', '--draft'],
      cwd: repo
    })
  })
})
