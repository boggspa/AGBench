/**
 * 1.0.6-TV6 — RemoteThreadSnapshot projection (the iOS / Remote Console
 * contract).
 *
 * The Mac must project *bounded* transcript windows to a paired
 * iPhone/iPad, never a full chat dump (a long AGBench thread is many MB
 * of Ensemble rounds, tool traces, screenshots, diff cards). This pure,
 * renderer-free module is the seam the Remote Task Console (Codex's
 * R0–R12, task #198) builds against: given a thread's persisted
 * `messages` + `runs`, it returns a `RemoteThreadSnapshot` whose `rows`
 * are bounded *by construction* for every {@link RemoteProjectionMode}.
 *
 * Design contract (stable — Codex depends on it):
 *   - `threadId === appChatId` — the same id `BridgeRunEventSink`'s
 *     `extractThreadId` stamps on forwarded run events, so a snapshot
 *     and the live event stream address the same thread.
 *   - `row.id === message.id` — the persisted desktop message id, so a
 *     remote deep-link / "jump to row" resolves to the exact desktop
 *     row (the desktop side brings it in-window via TV4 `scrollToRow`).
 *   - Bounded: `latestN` caps to `n`, `aroundRow` to `2·radius+1`,
 *     `attention` to `maxAttentionRows`, `summaryOnly` to 0 rows.
 *   - Additive: this never replaces raw-event forwarding; the bridge
 *     emits a snapshot alongside the existing per-pair event fan-out.
 *
 * It is deliberately a sibling of `BridgeRunEventSink.ts` and imports
 * only `store/types`, so it stays unit-testable with no Electron / DOM
 * surface and no coupling to the renderer's `TranscriptVirtualWindow`.
 * The row-kind mapping mirrors that renderer module's classification so
 * a row's identity is consistent across desktop and remote.
 */

import type { ChatMessage, ChatRun, DiffFileSummary } from './store/types'

export type RemoteProjectionMode =
  | { kind: 'latestN'; n: number }
  | { kind: 'aroundRow'; rowId: string; radius: number }
  | { kind: 'attention' }
  | { kind: 'summaryOnly' }

export type RemoteThreadRowKind =
  | 'user'
  | 'assistant'
  | 'tool'
  | 'runBoundary'
  | 'system'
  | 'error'
  | 'attention'
  | 'summary'

export type RemoteAttentionKind = 'planChoice' | 'agentQuestion' | 'approval'

export interface RemoteThreadRow {
  /** === desktop `message.id`, so remote deep-links resolve exactly. */
  id: string
  runId?: string
  role: ChatMessage['role']
  kind: RemoteThreadRowKind
  /** Bounded + sanitized one-screen preview of the row body. */
  preview: string
  /** True when `preview` was clipped from a longer body. */
  truncated: boolean
  /** Present for tool rows — compact stand-in for the ActivityStack. */
  toolSummary?: {
    activityCount: number
    status: 'running' | 'success' | 'error' | 'mixed'
  }
  /** Present for rows that need the user — drives the remote action UI. */
  attention?: {
    kind: RemoteAttentionKind
    promptPreview: string
  }
  timestamp: string
}

export interface RemoteRunSummary {
  runId: string
  provider?: string
  model?: string
  status?: string
  exitCode?: number
  startedAt?: string
  endedAt?: string
  durationMs?: number
  /** Best-effort token tally pulled from `run.stats` when present. */
  totalTokens?: number
  /** File-change counts pulled from `run.runDiff` when present. */
  fileChanges?: RemoteRunFileChangeCounts
}

export interface RemoteRunFileChangeCounts {
  filesChanged: number
  additions: number
  deletions: number
  createdFiles?: number
  modifiedFiles?: number
  deletedFiles?: number
  preExistingFiles?: number
  workspaceCount?: number
  workspaces?: RemoteRunWorkspaceFileChanges[]
}

export interface RemoteRunWorkspaceFileChanges {
  workspacePath?: string
  filesChanged: number
  additions: number
  deletions: number
  createdFiles?: number
  modifiedFiles?: number
  deletedFiles?: number
  preExistingFiles?: number
}

export interface RemoteThreadSnapshot {
  /** appChatId — matches BridgeRunEventSink.extractThreadId. */
  threadId: string
  schemaVersion: 1
  mode: RemoteProjectionMode
  /** BOUNDED by `mode` — never the full history. */
  rows: RemoteThreadRow[]
  /** Total projectable rows in the thread (one per message). */
  totalRows: number
  /** Index into the full thread of `rows[0]` (0 for filtered modes). */
  windowStartIndex: number
  hasMoreAbove: boolean
  hasMoreBelow: boolean
  runSummary?: RemoteRunSummary
  generatedAt: string
}

export interface RemoteProjectionOptions {
  threadId: string
  mode: RemoteProjectionMode
  /** Max chars for `preview` / `promptPreview` (default 280). */
  previewMaxChars?: number
  /** Cap for `attention` mode (default 50). */
  maxAttentionRows?: number
  /**
   * Caller-supplied attention augment. The desktop surfaces plan
   * choices / pending approvals via transient state rather than a
   * persisted message marker; the bridge passes those message ids here
   * so the projection can flag them even before they carry metadata.
   * Auto-detected metadata markers are unioned with this set.
   */
  attentionRowIds?: ReadonlySet<string>
  /** Stable timestamp for `generatedAt` (tests pass a fixed value). */
  generatedAt?: string
}

const DEFAULT_PREVIEW_MAX = 280
const DEFAULT_MAX_ATTENTION_ROWS = 50

/**
 * Collapse whitespace, strip control characters, and clip to `max`.
 * Returns the bounded preview plus whether it was truncated.
 */
export function sanitizePreview(
  raw: string | undefined,
  max: number = DEFAULT_PREVIEW_MAX
): { preview: string; truncated: boolean } {
  if (!raw) return { preview: '', truncated: false }
  // Replace C0 controls (incl. NUL), DEL, and C1 controls with a
  // space, then collapse remaining whitespace runs — no literal
  // control bytes in source.
  let cleaned = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    cleaned += code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? ' ' : raw[i]
  }
  const collapsed = cleaned.replace(/\s+/g, ' ').trim()
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : DEFAULT_PREVIEW_MAX
  if (collapsed.length <= limit) return { preview: collapsed, truncated: false }
  return { preview: `${collapsed.slice(0, Math.max(0, limit - 3)).trimEnd()}...`, truncated: true }
}

/**
 * Map a message to its remote row kind. Mirrors the renderer's
 * `classifyRowType` ordering (sub-thread cards reuse system/tool roles
 * with a metadata `kind`, so they must be detected before the plain
 * role mapping). Attention overrides are applied separately by the
 * projector after this base classification.
 */
export function classifyRemoteKind(message: ChatMessage): RemoteThreadRowKind {
  const metaKind = message.metadata?.kind
  if (message.role === 'system' && metaKind === 'subThreadDelegation') return 'system'
  if (metaKind === 'subThreadReturn') return 'tool'
  if (message.role === 'tool') return 'tool'
  if (message.role === 'user') return 'user'
  if (message.role === 'error') return 'error'
  if (message.role === 'assistant') return 'assistant'
  return 'system'
}

/** Auto-detected attention from a message's own metadata. */
function detectMessageAttention(message: ChatMessage): RemoteAttentionKind | null {
  const metaKind = message.metadata?.kind
  if (message.role === 'system' && metaKind === 'agentQuestion') return 'agentQuestion'
  if (metaKind === 'planChoice') return 'planChoice'
  if (metaKind === 'approval' || metaKind === 'pendingApproval') return 'approval'
  return null
}

function buildToolSummary(message: ChatMessage): RemoteThreadRow['toolSummary'] | undefined {
  if (message.role !== 'tool') return undefined
  const activities = message.toolActivities || []
  if (activities.length === 0) return undefined
  let running = 0
  let success = 0
  let error = 0
  for (const a of activities) {
    if (a.status === 'running' || a.status === 'pending') running++
    else if (a.status === 'error') error++
    else success++
  }
  let status: 'running' | 'success' | 'error' | 'mixed'
  if (running > 0) status = 'running'
  else if (error > 0 && success > 0) status = 'mixed'
  else if (error > 0) status = 'error'
  else status = 'success'
  return { activityCount: activities.length, status }
}

function buildRow(
  message: ChatMessage,
  previewMax: number,
  attentionKind: RemoteAttentionKind | null
): RemoteThreadRow {
  const { preview, truncated } = sanitizePreview(message.content, previewMax)
  const row: RemoteThreadRow = {
    id: message.id,
    role: message.role,
    kind: attentionKind ? 'attention' : classifyRemoteKind(message),
    preview,
    truncated,
    timestamp: message.timestamp
  }
  if (typeof message.runId === 'string') row.runId = message.runId
  const toolSummary = buildToolSummary(message)
  if (toolSummary) row.toolSummary = toolSummary
  if (attentionKind) {
    row.attention = {
      kind: attentionKind,
      promptPreview: sanitizePreview(message.content, previewMax).preview
    }
  }
  return row
}

function parseTime(value?: string): number {
  if (!value) return NaN
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : NaN
}

/** Best-effort run summary from the most recent run. */
export function buildRunSummary(runs: ChatRun[] | undefined): RemoteRunSummary | undefined {
  if (!Array.isArray(runs) || runs.length === 0) return undefined
  const run = runs[runs.length - 1]
  if (!run || typeof run.runId !== 'string') return undefined
  const summary: RemoteRunSummary = { runId: run.runId }
  if (run.provider) summary.provider = run.provider
  const model = run.actualModel || run.requestedModel
  if (model) summary.model = model
  if (run.status) summary.status = run.status
  if (typeof run.exitCode === 'number') summary.exitCode = run.exitCode
  if (run.startedAt) summary.startedAt = run.startedAt
  if (run.endedAt) summary.endedAt = run.endedAt
  const started = parseTime(run.startedAt)
  const ended = parseTime(run.endedAt)
  if (Number.isFinite(started) && Number.isFinite(ended) && ended >= started) {
    summary.durationMs = ended - started
  }
  // `stats` is loosely typed; pull a token total if one is exposed.
  const stats = run.stats as Record<string, unknown> | undefined
  if (stats) {
    const candidates = ['totalTokens', 'total_tokens', 'tokens']
    for (const key of candidates) {
      const v = stats[key]
      if (typeof v === 'number' && Number.isFinite(v)) {
        summary.totalTokens = v
        break
      }
    }
  }
  const fileChanges = summarizeRunFileChanges(run)
  if (fileChanges) summary.fileChanges = fileChanges
  return summary
}

function summarizeRunFileChanges(run: ChatRun): RemoteRunSummary['fileChanges'] | undefined {
  const workspaces: RemoteRunWorkspaceFileChanges[] = []
  const primaryPath = primaryRunDiffWorkspacePath(run)
  if (isRunDiffResult(run.runDiff)) {
    workspaces.push(summarizeRunDiffFiles(run.runDiff, primaryPath))
  }
  const byPath = run.runDiffByPath ?? {}
  for (const [workspacePath, files] of Object.entries(byPath)) {
    if (!Array.isArray(files)) continue
    if (primaryPath && workspacePath === primaryPath) continue
    workspaces.push(summarizeDiffFileList(files, workspacePath))
  }
  if (workspaces.length > 0) {
    const total = workspaces.reduce<RemoteRunFileChangeCounts>(
      (acc, workspace) => {
        acc.filesChanged += workspace.filesChanged
        acc.additions += workspace.additions
        acc.deletions += workspace.deletions
        acc.createdFiles = (acc.createdFiles ?? 0) + (workspace.createdFiles ?? 0)
        acc.modifiedFiles = (acc.modifiedFiles ?? 0) + (workspace.modifiedFiles ?? 0)
        acc.deletedFiles = (acc.deletedFiles ?? 0) + (workspace.deletedFiles ?? 0)
        acc.preExistingFiles = (acc.preExistingFiles ?? 0) + (workspace.preExistingFiles ?? 0)
        return acc
      },
      {
        filesChanged: 0,
        additions: 0,
        deletions: 0,
        createdFiles: 0,
        modifiedFiles: 0,
        deletedFiles: 0,
        preExistingFiles: 0
      } satisfies RemoteRunFileChangeCounts
    )
    total.workspaceCount = workspaces.length
    total.workspaces = workspaces
    return total
  }

  // Legacy records from before RunDiffResult used aggregate fields.
  const legacy = run.runDiff as
    | { filesChanged?: number; additions?: number; deletions?: number; files?: unknown[] }
    | undefined
  if (!legacy) return undefined
  const filesChanged =
    typeof legacy.filesChanged === 'number'
      ? legacy.filesChanged
      : Array.isArray(legacy.files)
        ? legacy.files.length
        : 0
  return {
    filesChanged,
    additions: typeof legacy.additions === 'number' ? legacy.additions : 0,
    deletions: typeof legacy.deletions === 'number' ? legacy.deletions : 0
  }
}

function isRunDiffResult(value: ChatRun['runDiff']): value is NonNullable<ChatRun['runDiff']> {
  return Boolean(
    value &&
    Array.isArray(value.createdFiles) &&
    Array.isArray(value.modifiedFiles) &&
    Array.isArray(value.deletedFiles) &&
    Array.isArray(value.preExistingFiles)
  )
}

function summarizeRunDiffFiles(
  runDiff: NonNullable<ChatRun['runDiff']>,
  workspacePath: string | undefined
): RemoteRunWorkspaceFileChanges {
  const changedFiles = [
    ...safeDiffList(runDiff.createdFiles),
    ...safeDiffList(runDiff.modifiedFiles),
    ...safeDiffList(runDiff.deletedFiles)
  ]
  const summary: RemoteRunWorkspaceFileChanges = {
    filesChanged: changedFiles.length,
    additions: sumDiffFiles(changedFiles, 'additions'),
    deletions: sumDiffFiles(changedFiles, 'deletions'),
    createdFiles: safeDiffList(runDiff.createdFiles).length,
    modifiedFiles: safeDiffList(runDiff.modifiedFiles).length,
    deletedFiles: safeDiffList(runDiff.deletedFiles).length,
    preExistingFiles: safeDiffList(runDiff.preExistingFiles).length
  }
  if (workspacePath) summary.workspacePath = workspacePath
  return summary
}

function summarizeDiffFileList(
  files: DiffFileSummary[],
  workspacePath: string
): RemoteRunWorkspaceFileChanges {
  let createdFiles = 0
  let modifiedFiles = 0
  let deletedFiles = 0
  for (const file of files) {
    if (file.status === 'created' || file.status === 'untracked') createdFiles++
    else if (file.status === 'deleted') deletedFiles++
    else modifiedFiles++
  }
  const summary: RemoteRunWorkspaceFileChanges = {
    filesChanged: files.length,
    additions: sumDiffFiles(files, 'additions'),
    deletions: sumDiffFiles(files, 'deletions'),
    createdFiles,
    modifiedFiles,
    deletedFiles,
    preExistingFiles: 0
  }
  if (workspacePath) summary.workspacePath = workspacePath
  return summary
}

function safeDiffList(files: DiffFileSummary[] | undefined): DiffFileSummary[] {
  return Array.isArray(files) ? files : []
}

function sumDiffFiles(files: DiffFileSummary[], key: 'additions' | 'deletions'): number {
  return files.reduce((total, file) => total + (file[key] ?? 0), 0)
}

function primaryRunDiffWorkspacePath(run: ChatRun): string | undefined {
  return (
    run.runDiff?.postSnapshot?.workspacePath ||
    run.runDiff?.preSnapshot?.workspacePath ||
    run.effectiveWorkspacePath
  )
}

function clampIndex(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo
  return Math.min(hi, Math.max(lo, Math.floor(value)))
}

/**
 * Project a thread's messages + runs into a bounded snapshot for the
 * Remote Console. Pure: same inputs → same output (pass `generatedAt`
 * for determinism). Never returns more rows than the mode allows.
 */
export function projectRemoteThread(
  messages: ChatMessage[],
  runs: ChatRun[] | undefined,
  opts: RemoteProjectionOptions
): RemoteThreadSnapshot {
  const all = Array.isArray(messages) ? messages.filter((m) => m && typeof m.id === 'string') : []
  const totalRows = all.length
  const previewMax = opts.previewMaxChars ?? DEFAULT_PREVIEW_MAX
  const generatedAt = opts.generatedAt ?? new Date().toISOString()
  const runSummary = buildRunSummary(runs)

  const attentionFor = (message: ChatMessage): RemoteAttentionKind | null => {
    const detected = detectMessageAttention(message)
    if (detected) return detected
    if (opts.attentionRowIds?.has(message.id)) return 'agentQuestion'
    return null
  }

  const base = {
    threadId: opts.threadId,
    schemaVersion: 1 as const,
    mode: opts.mode,
    totalRows,
    generatedAt,
    ...(runSummary ? { runSummary } : {})
  }

  if (opts.mode.kind === 'summaryOnly') {
    return {
      ...base,
      rows: [],
      windowStartIndex: totalRows,
      hasMoreAbove: totalRows > 0,
      hasMoreBelow: false
    }
  }

  if (opts.mode.kind === 'attention') {
    const cap = opts.maxAttentionRows ?? DEFAULT_MAX_ATTENTION_ROWS
    const rows: RemoteThreadRow[] = []
    let matched = 0
    for (const message of all) {
      const att = attentionFor(message)
      if (!att) continue
      matched++
      if (rows.length < cap) rows.push(buildRow(message, previewMax, att))
    }
    return {
      ...base,
      rows,
      windowStartIndex: 0,
      hasMoreAbove: false,
      hasMoreBelow: matched > rows.length
    }
  }

  if (opts.mode.kind === 'aroundRow') {
    const { rowId, radius: rawRadius } = opts.mode
    const radius = clampIndex(rawRadius, 0, totalRows)
    const targetIndex = all.findIndex((m) => m.id === rowId)
    if (targetIndex < 0) {
      // Unknown row → empty window anchored at the end; the caller can
      // fall back to latestN.
      return {
        ...base,
        rows: [],
        windowStartIndex: totalRows,
        hasMoreAbove: totalRows > 0,
        hasMoreBelow: false
      }
    }
    const start = clampIndex(targetIndex - radius, 0, totalRows)
    const end = clampIndex(targetIndex + radius + 1, start, totalRows)
    const slice = all.slice(start, end)
    return {
      ...base,
      rows: slice.map((m) => buildRow(m, previewMax, attentionFor(m))),
      windowStartIndex: start,
      hasMoreAbove: start > 0,
      hasMoreBelow: end < totalRows
    }
  }

  // latestN
  const n = clampIndex(opts.mode.n, 0, totalRows)
  const start = Math.max(0, totalRows - n)
  const slice = all.slice(start)
  return {
    ...base,
    rows: slice.map((m) => buildRow(m, previewMax, attentionFor(m))),
    windowStartIndex: start,
    hasMoreAbove: start > 0,
    hasMoreBelow: false
  }
}
