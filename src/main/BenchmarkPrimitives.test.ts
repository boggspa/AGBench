import { execFileSync, spawnSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import {
  BenchmarkArtifactStore,
  canonicalJson,
  captureBenchmarkEnvironmentManifest,
  createBenchmarkRunManifest,
  pinWorkspaceFiles,
  runBenchmarkEvaluators,
  sha256Bytes,
  sha256CanonicalJson
} from './BenchmarkPrimitives'
import type { BenchmarkTaskManifest } from './store/types'

function createTempWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), 'taskwraith-benchmark-'))
  writeFileSync(path.join(workspace, 'input.txt'), 'hello benchmark\n')
  mkdirSync(path.join(workspace, 'nested'))
  writeFileSync(path.join(workspace, 'nested', 'result.json'), '{"ok":true}\n')
  return workspace
}

describe('BenchmarkPrimitives', () => {
  it('creates stable canonical JSON hashes', () => {
    const left = { b: 2, a: { z: true, m: 'x' } }
    const right = { a: { m: 'x', z: true }, b: 2 }

    expect(canonicalJson(left)).toBe(canonicalJson(right))
    expect(sha256CanonicalJson(left)).toBe(sha256CanonicalJson(right))
  })

  it('pins workspace file hashes and rejects path escapes', async () => {
    const workspace = createTempWorkspace()
    try {
      const pinned = await pinWorkspaceFiles(workspace, ['input.txt'])
      expect(pinned).toHaveLength(1)
      expect(pinned[0]).toMatchObject({
        path: 'input.txt',
        sha256: sha256Bytes('hello benchmark\n')
      })
      await expect(pinWorkspaceFiles(workspace, ['../outside.txt'])).rejects.toThrow(/escapes/)
      const outside = mkdtempSync(path.join(tmpdir(), 'taskwraith-benchmark-outside-'))
      try {
        symlinkSync(outside, path.join(workspace, 'linked-outside'), 'dir')
        await expect(pinWorkspaceFiles(workspace, ['linked-outside/secret.txt'])).rejects.toThrow(
          /escapes/
        )
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('captures environment manifests with requested file pins', async () => {
    const workspace = createTempWorkspace()
    try {
      const manifest = await captureBenchmarkEnvironmentManifest({
        workspacePath: workspace,
        inputFiles: ['input.txt'],
        envKeys: ['PATH'],
        appVersion: 'test-version',
        capturedAt: '2026-01-01T00:00:00.000Z'
      })

      expect(manifest).toMatchObject({
        schemaVersion: 1,
        workspacePath: path.resolve(workspace),
        appVersion: 'test-version'
      })
      expect(manifest.files[0].sha256).toBe(sha256Bytes('hello benchmark\n'))
      expect(manifest.env?.PATH).toBeTruthy()
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('captures git pins when requested', async () => {
    const hasGit = spawnSync('git', ['--version']).status === 0
    if (!hasGit) return

    const workspace = createTempWorkspace()
    try {
      execFileSync('git', ['init'], { cwd: workspace })
      execFileSync('git', ['config', 'user.email', 'bench@example.test'], { cwd: workspace })
      execFileSync('git', ['config', 'user.name', 'Bench Test'], { cwd: workspace })
      execFileSync('git', ['add', 'input.txt'], { cwd: workspace })
      execFileSync('git', ['commit', '-m', 'initial'], { cwd: workspace })

      const manifest = await captureBenchmarkEnvironmentManifest({
        workspacePath: workspace,
        includeGitTrackedFiles: true,
        maxGitTrackedFiles: 10,
        capturedAt: '2026-01-01T00:00:00.000Z'
      })

      expect(manifest.git?.head).toMatch(/^[0-9a-f]{40}$/)
      expect(manifest.git?.trackedFiles?.some((file) => file.path === 'input.txt')).toBe(true)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('stores artifacts by content hash', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'taskwraith-artifacts-'))
    try {
      const store = new BenchmarkArtifactStore(root)
      const artifact = await store.putBytes({
        runId: 'run/one',
        name: 'stdout.txt',
        kind: 'stdout',
        bytes: 'done\n',
        createdAt: '2026-01-01T00:00:00.000Z'
      })

      expect(artifact.sha256).toBe(sha256Bytes('done\n'))
      expect(artifact.relativePath).toContain('stdout.txt')
      expect(readFileSync(path.join(root, artifact.relativePath), 'utf8')).toBe('done\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('runs benchmark scorers and emits reproducible run manifests', async () => {
    const workspace = createTempWorkspace()
    const artifactRoot = mkdtempSync(path.join(tmpdir(), 'taskwraith-artifacts-'))
    try {
      const store = new BenchmarkArtifactStore(artifactRoot)
      const artifact = await store.putBytes({
        runId: 'run-1',
        name: 'stdout.txt',
        kind: 'stdout',
        bytes: 'final answer: 42\n',
        createdAt: '2026-01-01T00:00:00.000Z'
      })
      const task: BenchmarkTaskManifest = {
        schemaVersion: 1,
        id: 'task-1',
        title: 'Answer and file check',
        prompt: 'Answer 42 and create a file.',
        workspacePath: workspace,
        inputFiles: ['input.txt'],
        scorers: [
          { id: 'text', kind: 'regex_match', pattern: '42' },
          { id: 'file', kind: 'file_exists', path: 'nested/result.json' },
          {
            id: 'artifact',
            kind: 'artifact_exists',
            artifactName: 'stdout.txt',
            artifactKind: 'stdout'
          }
        ]
      }
      const environment = await captureBenchmarkEnvironmentManifest({
        workspacePath: workspace,
        inputFiles: task.inputFiles,
        capturedAt: '2026-01-01T00:00:00.000Z'
      })
      const evaluation = await runBenchmarkEvaluators(task, {
        workspacePath: workspace,
        finalText: 'final answer: 42',
        artifacts: [artifact],
        evaluatedAt: '2026-01-01T00:00:00.000Z'
      })
      const runManifest = createBenchmarkRunManifest({
        id: 'manifest-1',
        runId: 'run-1',
        task,
        environment,
        artifacts: [artifact],
        evaluation,
        createdAt: '2026-01-01T00:00:00.000Z'
      })

      expect(evaluation).toMatchObject({ passed: true, score: 3, maxScore: 3 })
      expect(runManifest).toMatchObject({
        schemaVersion: 1,
        id: 'manifest-1',
        taskManifestSha256: sha256CanonicalJson(task),
        environmentManifestSha256: sha256CanonicalJson(environment),
        promptSha256: sha256Bytes(task.prompt)
      })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
      rmSync(artifactRoot, { recursive: true, force: true })
    }
  })
})
