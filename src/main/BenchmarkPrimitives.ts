import { createHash, randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promises as fs, createReadStream } from 'fs'
import * as path from 'path'
import type {
  BenchmarkArtifactKind,
  BenchmarkArtifactRecord,
  BenchmarkEnvironmentManifest,
  BenchmarkEvaluationReport,
  BenchmarkPinnedFile,
  BenchmarkRunManifest,
  BenchmarkScoreResult,
  BenchmarkScorerDefinition,
  BenchmarkTaskManifest,
  ProviderId
} from './store/types'

export interface CaptureBenchmarkEnvironmentOptions {
  workspacePath?: string
  inputFiles?: string[]
  envKeys?: string[]
  appVersion?: string
  includeGitTrackedFiles?: boolean
  maxGitTrackedFiles?: number
  capturedAt?: string
}

export interface BenchmarkArtifactStorePutInput {
  runId: string
  name: string
  kind: BenchmarkArtifactKind
  bytes: Buffer | string
  createdAt?: string
  metadata?: Record<string, unknown>
}

export interface BenchmarkArtifactStorePutFileInput {
  runId: string
  name?: string
  kind?: BenchmarkArtifactKind
  filePath: string
  createdAt?: string
  metadata?: Record<string, unknown>
}

export interface BenchmarkEvaluationContext {
  workspacePath?: string
  finalText?: string
  outputs?: Record<string, unknown>
  artifacts?: BenchmarkArtifactRecord[]
  evaluatedAt?: string
}

export interface CreateBenchmarkRunManifestInput {
  id?: string
  runId?: string
  task: BenchmarkTaskManifest
  environment: BenchmarkEnvironmentManifest
  artifacts?: BenchmarkArtifactRecord[]
  evaluation?: BenchmarkEvaluationReport
  provider?: ProviderId
  workspacePath?: string
  createdAt?: string
  metadata?: Record<string, unknown>
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function normalizeJsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item) ?? null)
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.keys(record)
      .sort()
      .reduce<Record<string, JsonValue>>((result, key) => {
        const normalized = normalizeJsonValue(record[key])
        if (normalized !== undefined) {
          result[key] = normalized
        }
        return result
      }, {})
  }
  return String(value)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value) ?? null)
}

export function sha256Bytes(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function sha256CanonicalJson(value: unknown): string {
  return sha256Bytes(canonicalJson(value))
}

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/')
}

function safeSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || 'artifact'
}

function resolveWorkspaceChild(workspacePath: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Benchmark path must be relative to the workspace: ${relativePath}`)
  }
  const workspaceRoot = path.resolve(workspacePath)
  const resolved = path.resolve(workspaceRoot, relativePath)
  const rel = path.relative(workspaceRoot, resolved)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Benchmark path escapes the workspace: ${relativePath}`)
  }
  return resolved
}

async function pinFile(filePath: string, displayPath: string): Promise<BenchmarkPinnedFile> {
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) {
    throw new Error(`Benchmark pinned path is not a file: ${displayPath}`)
  }
  return {
    path: toPosixPath(displayPath),
    sizeBytes: stat.size,
    sha256: await sha256File(filePath),
    mtimeMs: stat.mtimeMs,
    mode: stat.mode
  }
}

export async function pinWorkspaceFiles(workspacePath: string, filePaths: string[] = []): Promise<BenchmarkPinnedFile[]> {
  const uniquePaths = Array.from(new Set(filePaths.filter((filePath) => typeof filePath === 'string' && filePath.trim())))
  const pinned = await Promise.all(
    uniquePaths.sort().map((filePath) => pinFile(resolveWorkspaceChild(workspacePath, filePath), filePath))
  )
  return pinned
}

function execFileText(command: string, args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, timeout: 8_000, maxBuffer: 20 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      resolve(stdout.toString())
    })
  })
}

async function captureGitManifest(
  workspacePath: string,
  includeTrackedFiles: boolean,
  maxTrackedFiles: number
): Promise<BenchmarkEnvironmentManifest['git'] | undefined> {
  const root = (await execFileText('git', ['rev-parse', '--show-toplevel'], workspacePath))?.trim()
  if (!root) {
    return undefined
  }
  const [head, branch, statusPorcelain] = await Promise.all([
    execFileText('git', ['rev-parse', 'HEAD'], workspacePath),
    execFileText('git', ['rev-parse', '--abbrev-ref', 'HEAD'], workspacePath),
    execFileText('git', ['status', '--porcelain=v1', '-z'], workspacePath)
  ])
  const gitManifest: BenchmarkEnvironmentManifest['git'] = {
    root,
    head: head?.trim() || undefined,
    branch: branch?.trim() || undefined,
    dirty: Boolean(statusPorcelain),
    statusPorcelain: statusPorcelain || undefined
  }
  if (includeTrackedFiles) {
    const lsFiles = await execFileText('git', ['ls-files', '-z'], workspacePath)
    const trackedFiles = (lsFiles || '')
      .split('\0')
      .filter(Boolean)
      .slice(0, Math.max(0, maxTrackedFiles))
    gitManifest.trackedFiles = await pinWorkspaceFiles(root, trackedFiles)
  }
  return gitManifest
}

export async function captureBenchmarkEnvironmentManifest(
  options: CaptureBenchmarkEnvironmentOptions = {}
): Promise<BenchmarkEnvironmentManifest> {
  const workspacePath = options.workspacePath ? path.resolve(options.workspacePath) : undefined
  const files = workspacePath ? await pinWorkspaceFiles(workspacePath, options.inputFiles || []) : []
  const env = (options.envKeys || []).reduce<Record<string, string>>((result, key) => {
    if (process.env[key] !== undefined) {
      result[key] = String(process.env[key])
    }
    return result
  }, {})

  return {
    schemaVersion: 1,
    capturedAt: options.capturedAt || new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    appVersion: options.appVersion,
    workspacePath,
    git: workspacePath
      ? await captureGitManifest(
        workspacePath,
        Boolean(options.includeGitTrackedFiles),
        options.maxGitTrackedFiles || 500
      )
      : undefined,
    files,
    env: Object.keys(env).length ? env : undefined
  }
}

export class BenchmarkArtifactStore {
  constructor(private readonly rootDir: string) {}

  async putBytes(input: BenchmarkArtifactStorePutInput): Promise<BenchmarkArtifactRecord> {
    const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes)
    const sha256 = sha256Bytes(bytes)
    const runSegment = safeSegment(input.runId)
    const nameSegment = safeSegment(path.basename(input.name))
    const relativePath = path.join(runSegment, `${sha256.slice(0, 16)}-${nameSegment}`)
    const absolutePath = path.join(this.rootDir, relativePath)
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, bytes)
    return {
      id: `${input.runId}:${sha256.slice(0, 16)}:${nameSegment}`,
      runId: input.runId,
      kind: input.kind,
      name: input.name,
      relativePath: toPosixPath(relativePath),
      absolutePath,
      sha256,
      sizeBytes: bytes.byteLength,
      createdAt: input.createdAt || new Date().toISOString(),
      metadata: input.metadata
    }
  }

  async putFile(input: BenchmarkArtifactStorePutFileInput): Promise<BenchmarkArtifactRecord> {
    const name = input.name || path.basename(input.filePath)
    const bytes = await fs.readFile(input.filePath)
    return this.putBytes({
      runId: input.runId,
      name,
      kind: input.kind || 'file',
      bytes,
      createdAt: input.createdAt,
      metadata: {
        sourcePath: path.resolve(input.filePath),
        ...(input.metadata || {})
      }
    })
  }
}

function scorerWeight(scorer: BenchmarkScorerDefinition): number {
  return Number.isFinite(scorer.weight) && Number(scorer.weight) > 0 ? Number(scorer.weight) : 1
}

function outputTarget(context: BenchmarkEvaluationContext, target: string | undefined): unknown {
  if (!target || target === 'finalText') {
    return context.finalText || ''
  }
  if (target.startsWith('outputs.')) {
    return context.outputs?.[target.slice('outputs.'.length)]
  }
  return context.outputs?.[target]
}

function jsonField(value: unknown, target: string | undefined): unknown {
  const pathParts = (target || '').split('.').filter(Boolean)
  let current = typeof value === 'string'
    ? (() => {
      try {
        return JSON.parse(value)
      } catch {
        return undefined
      }
    })()
    : value
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

async function evaluateScorer(
  scorer: BenchmarkScorerDefinition,
  context: BenchmarkEvaluationContext
): Promise<BenchmarkScoreResult> {
  const maxScore = scorerWeight(scorer)
  const pass = (passed: boolean, message?: string, metadata?: Record<string, unknown>): BenchmarkScoreResult => ({
    scorerId: scorer.id,
    kind: scorer.kind,
    passed,
    score: passed ? maxScore : 0,
    maxScore,
    message,
    metadata
  })

  if (scorer.kind === 'exact_match') {
    const actual = String(outputTarget(context, scorer.target) ?? '')
    const expected = String(scorer.expected ?? '')
    return pass(actual === expected, actual === expected ? undefined : 'Output did not exactly match expected text.')
  }

  if (scorer.kind === 'regex_match') {
    const actual = String(outputTarget(context, scorer.target) ?? '')
    if (!scorer.pattern) {
      return pass(false, 'Regex scorer is missing a pattern.')
    }
    const regex = new RegExp(scorer.pattern, scorer.flags)
    return pass(regex.test(actual), `Pattern ${scorer.pattern} ${regex.test(actual) ? 'matched' : 'did not match'}.`)
  }

  if (scorer.kind === 'file_exists') {
    if (!context.workspacePath || !scorer.path) {
      return pass(false, 'File scorer requires workspacePath and path.')
    }
    const targetPath = resolveWorkspaceChild(context.workspacePath, scorer.path)
    try {
      const stat = await fs.stat(targetPath)
      if (!stat.isFile()) {
        return pass(false, 'Path exists but is not a file.')
      }
      if (scorer.sha256) {
        const actualSha = await sha256File(targetPath)
        return pass(actualSha === scorer.sha256, actualSha === scorer.sha256 ? undefined : 'File hash mismatch.', { sha256: actualSha })
      }
      return pass(true)
    } catch {
      return pass(false, 'Expected file was not found.')
    }
  }

  if (scorer.kind === 'artifact_exists') {
    const artifact = (context.artifacts || []).find((item) => {
      if (scorer.artifactName && item.name !== scorer.artifactName) return false
      if (scorer.artifactKind && item.kind !== scorer.artifactKind) return false
      if (scorer.sha256 && item.sha256 !== scorer.sha256) return false
      return true
    })
    return pass(Boolean(artifact), artifact ? undefined : 'Expected artifact was not recorded.', artifact ? { artifactId: artifact.id } : undefined)
  }

  if (scorer.kind === 'json_field_equals') {
    const source = outputTarget(context, scorer.target?.startsWith('outputs.') ? scorer.target : undefined)
    const actual = jsonField(source, scorer.target?.startsWith('outputs.') ? undefined : scorer.target)
    return pass(canonicalJson(actual) === canonicalJson(scorer.expected), 'JSON field comparison completed.', { actual })
  }

  return pass(false, `Unsupported scorer kind: ${(scorer as BenchmarkScorerDefinition).kind}`)
}

export function validateBenchmarkTaskManifest(task: BenchmarkTaskManifest): string[] {
  const errors: string[] = []
  if (!task || typeof task !== 'object') errors.push('Task manifest must be an object.')
  if (task?.schemaVersion !== 1) errors.push('Task manifest schemaVersion must be 1.')
  if (!task?.id?.trim()) errors.push('Task manifest id is required.')
  if (!task?.title?.trim()) errors.push('Task manifest title is required.')
  if (typeof task?.prompt !== 'string') errors.push('Task manifest prompt must be a string.')
  if (!Array.isArray(task?.scorers)) errors.push('Task manifest scorers must be an array.')
  for (const scorer of task?.scorers || []) {
    if (!scorer.id?.trim()) errors.push('Scorer id is required.')
    if (!scorer.kind) errors.push(`Scorer ${scorer.id || '<unknown>'} kind is required.`)
  }
  return errors
}

export async function runBenchmarkEvaluators(
  task: BenchmarkTaskManifest,
  context: BenchmarkEvaluationContext
): Promise<BenchmarkEvaluationReport> {
  const manifestErrors = validateBenchmarkTaskManifest(task)
  if (manifestErrors.length) {
    throw new Error(`Invalid benchmark task manifest: ${manifestErrors.join(' ')}`)
  }
  const results = await Promise.all(task.scorers.map((scorer) => evaluateScorer(scorer, context)))
  const score = results.reduce((total, result) => total + result.score, 0)
  const maxScore = results.reduce((total, result) => total + result.maxScore, 0)
  return {
    schemaVersion: 1,
    taskId: task.id,
    evaluatedAt: context.evaluatedAt || new Date().toISOString(),
    score,
    maxScore,
    passed: maxScore > 0 && score === maxScore,
    results
  }
}

export function createBenchmarkRunManifest(input: CreateBenchmarkRunManifestInput): BenchmarkRunManifest {
  const createdAt = input.createdAt || new Date().toISOString()
  const provider = input.provider || input.task.provider
  const workspacePath = input.workspacePath || input.task.workspacePath || input.environment.workspacePath
  const taskManifestSha256 = sha256CanonicalJson(input.task)
  const environmentManifestSha256 = sha256CanonicalJson(input.environment)
  const promptSha256 = sha256Bytes(input.task.prompt)
  return {
    schemaVersion: 1,
    id: input.id || `benchmark-run-${randomUUID()}`,
    taskId: input.task.id,
    runId: input.runId,
    provider,
    workspacePath,
    createdAt,
    taskManifestSha256,
    environmentManifestSha256,
    promptSha256,
    task: input.task,
    environment: input.environment,
    artifacts: input.artifacts || [],
    evaluation: input.evaluation,
    metadata: input.metadata
  }
}
