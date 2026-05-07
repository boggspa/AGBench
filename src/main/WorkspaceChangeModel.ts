import { randomUUID } from 'crypto'
import type {
  DiffFileSummary,
  WorkspaceChangeArtifact,
  WorkspaceChangeFile,
  WorkspaceChangeFilter,
  WorkspaceChangeSet,
  WorkspaceChangeSetInput,
  WorkspaceChangeSource,
  WorkspaceEditorChangeInput,
  WorkspaceRunChangeInput
} from './store/types'

export const WORKSPACE_CHANGE_SCHEMA_VERSION = 1

function normalizeIsoTimestamp(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback
}

function countDefined(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0
}

function summarizeStats(
  files: WorkspaceChangeFile[],
  artifacts: WorkspaceChangeArtifact[]
): WorkspaceChangeSet['stats'] {
  return {
    filesCreated: files.filter((file) => file.status === 'created' || file.status === 'untracked')
      .length,
    filesModified: files.filter((file) => file.status === 'modified' || file.status === 'renamed')
      .length,
    filesDeleted: files.filter((file) => file.status === 'deleted').length,
    filesPreExisting: files.filter((file) => file.origin === 'pre_existing').length,
    artifactsGenerated: artifacts.length,
    additions: files.reduce((total, file) => total + countDefined(file.additions), 0),
    deletions: files.reduce((total, file) => total + countDefined(file.deletions), 0)
  }
}

function defaultChangeSetTitle(input: WorkspaceChangeSetInput): string {
  if (input.title) return input.title
  if (input.source === 'provider_run') {
    return `${input.provider || 'Provider'} run workspace changes`
  }
  if (input.source === 'editor') return 'Editor workspace change'
  return 'Workspace change'
}

export function createWorkspaceChangeSet(
  input: WorkspaceChangeSetInput,
  now: string = new Date().toISOString()
): WorkspaceChangeSet {
  const files = input.files || []
  const artifacts = input.artifacts || []
  return {
    schemaVersion: WORKSPACE_CHANGE_SCHEMA_VERSION,
    ...input,
    id: input.id || `${input.source}-${input.runId || randomUUID()}`,
    source: input.source,
    status: input.status || 'captured',
    title: defaultChangeSetTitle(input),
    workspacePath: input.workspacePath,
    createdAt: normalizeIsoTimestamp(input.createdAt, now),
    updatedAt: normalizeIsoTimestamp(input.updatedAt, now),
    files,
    artifacts,
    stats: input.stats || summarizeStats(files, artifacts)
  }
}

function fileFromDiffSummary(
  summary: DiffFileSummary,
  origin: WorkspaceChangeFile['origin']
): WorkspaceChangeFile {
  return {
    path: summary.path,
    status: summary.status,
    origin,
    additions: summary.additions,
    deletions: summary.deletions,
    sizeBytes: summary.sizeBytes,
    isBinary: summary.isBinary,
    isNoise: summary.isNoise,
    isSensitive: summary.isSensitive,
    previewKind: summary.previewKind,
    diffText: summary.diffText
  }
}

function artifactFromCreatedFile(
  summary: Pick<DiffFileSummary, 'path' | 'status' | 'sizeBytes'> & {
    previewKind?: DiffFileSummary['previewKind']
  },
  source: WorkspaceChangeSource
): WorkspaceChangeArtifact {
  return {
    id: `${source}:file:${summary.path}`,
    kind: 'file',
    path: summary.path,
    label: summary.path,
    source,
    sizeBytes: summary.sizeBytes,
    metadata: {
      status: summary.status,
      previewKind: summary.previewKind
    }
  }
}

export function createWorkspaceChangeSetFromRunDiff(
  input: WorkspaceRunChangeInput,
  now: string = new Date().toISOString()
): WorkspaceChangeSet {
  const files: WorkspaceChangeFile[] = [
    ...input.runDiff.createdFiles.map((summary) => fileFromDiffSummary(summary, 'run_diff')),
    ...input.runDiff.modifiedFiles.map((summary) => fileFromDiffSummary(summary, 'run_diff')),
    ...input.runDiff.deletedFiles.map((summary) => fileFromDiffSummary(summary, 'run_diff')),
    ...input.runDiff.preExistingFiles.map((summary) => fileFromDiffSummary(summary, 'pre_existing'))
  ]
  const artifacts = input.runDiff.createdFiles
    .filter((summary) => !summary.isNoise && !summary.isSensitive)
    .map((summary) => artifactFromCreatedFile(summary, 'provider_run'))

  const changeSet = createWorkspaceChangeSet(
    {
      id: `run:${input.runId}`,
      source: 'provider_run',
      title: `${input.provider || 'Provider'} run changes`,
      summary: `Run diff captured ${input.runDiff.createdFiles.length} created, ${input.runDiff.modifiedFiles.length} modified, ${input.runDiff.deletedFiles.length} deleted.`,
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      effectiveWorkspacePath: input.effectiveWorkspacePath,
      chatId: input.chatId,
      runId: input.runId,
      provider: input.provider,
      preSnapshot: input.runDiff.preSnapshot,
      postSnapshot: input.runDiff.postSnapshot,
      files,
      artifacts,
      worktree: input.worktree,
      checkpoint: input.checkpoint,
      metadata: input.metadata
    },
    now
  )

  return {
    ...changeSet,
    metadata: {
      ...(changeSet.metadata || {}),
      runDiff: {
        createdFiles: input.runDiff.createdFiles.length,
        modifiedFiles: input.runDiff.modifiedFiles.length,
        deletedFiles: input.runDiff.deletedFiles.length,
        preExistingFiles: input.runDiff.preExistingFiles.length
      }
    }
  }
}

function splitLines(value: string): string[] {
  if (!value) return []
  return value.replace(/\r\n/g, '\n').split('\n')
}

export function estimateTextEditLineDelta(
  previousContent: string | undefined,
  nextContent: string
): { additions: number; deletions: number } {
  const previous = splitLines(previousContent || '')
  const next = splitLines(nextContent)
  if (previous.length === 0) {
    return { additions: next.length, deletions: 0 }
  }
  if (next.length === 0) {
    return { additions: 0, deletions: previous.length }
  }

  let prefix = 0
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) {
    prefix += 1
  }

  let previousSuffix = previous.length - 1
  let nextSuffix = next.length - 1
  while (
    previousSuffix >= prefix &&
    nextSuffix >= prefix &&
    previous[previousSuffix] === next[nextSuffix]
  ) {
    previousSuffix -= 1
    nextSuffix -= 1
  }

  const previousMiddle = previous.slice(prefix, previousSuffix + 1)
  const nextMiddle = next.slice(prefix, nextSuffix + 1)
  const cellCount = previousMiddle.length * nextMiddle.length
  if (cellCount > 0 && cellCount <= 100_000) {
    const previousLength = previousMiddle.length
    const nextLength = nextMiddle.length
    const table = Array.from({ length: previousLength + 1 }, () =>
      new Array<number>(nextLength + 1).fill(0)
    )
    for (let i = previousLength - 1; i >= 0; i -= 1) {
      for (let j = nextLength - 1; j >= 0; j -= 1) {
        table[i][j] =
          previousMiddle[i] === nextMiddle[j]
            ? table[i + 1][j + 1] + 1
            : Math.max(table[i + 1][j], table[i][j + 1])
      }
    }
    const commonMiddleLines = table[0][0]
    return {
      additions: Math.max(0, nextMiddle.length - commonMiddleLines),
      deletions: Math.max(0, previousMiddle.length - commonMiddleLines)
    }
  }

  return {
    additions: nextMiddle.length,
    deletions: previousMiddle.length
  }
}

export function createWorkspaceChangeSetFromEditorWrite(
  input: WorkspaceEditorChangeInput,
  now: string = new Date().toISOString()
): WorkspaceChangeSet {
  const delta = estimateTextEditLineDelta(input.previousContent, input.nextContent)
  const file: WorkspaceChangeFile = {
    path: input.filePath,
    status: input.existedBefore ? 'modified' : 'created',
    origin: 'manual_edit',
    additions: delta.additions,
    deletions: delta.deletions,
    sizeBytes: input.sizeBytes,
    previewKind: 'text_preview'
  }

  return createWorkspaceChangeSet(
    {
      source: 'editor',
      title: input.existedBefore ? `Edited ${input.filePath}` : `Created ${input.filePath}`,
      summary: input.existedBefore
        ? `Manual editor save modified ${input.filePath}.`
        : `Manual editor save created ${input.filePath}.`,
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      effectiveWorkspacePath: input.effectiveWorkspacePath,
      chatId: input.chatId,
      files: [file],
      artifacts: input.existedBefore ? [] : [artifactFromCreatedFile(file, 'editor')],
      metadata: input.metadata
    },
    now
  )
}

export function filterWorkspaceChangeSets(
  records: WorkspaceChangeSet[],
  filter: WorkspaceChangeFilter = {}
): WorkspaceChangeSet[] {
  const sourceSet = filter.sources?.length ? new Set(filter.sources) : null
  const statusSet = filter.statuses?.length ? new Set(filter.statuses) : null
  const sinceMs = filter.since ? new Date(filter.since).getTime() : null
  const filtered = records.filter((record) => {
    if (filter.workspaceId && record.workspaceId !== filter.workspaceId) return false
    if (filter.workspacePath && record.workspacePath !== filter.workspacePath) return false
    if (filter.chatId && record.chatId !== filter.chatId) return false
    if (filter.runId && record.runId !== filter.runId) return false
    if (filter.provider && record.provider !== filter.provider) return false
    if (sourceSet && !sourceSet.has(record.source)) return false
    if (statusSet && !statusSet.has(record.status)) return false
    if (sinceMs !== null && new Date(record.updatedAt).getTime() < sinceMs) return false
    return true
  })
  const sorted = [...filtered].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
  return filter.limit && filter.limit > 0 ? sorted.slice(0, Math.floor(filter.limit)) : sorted
}
