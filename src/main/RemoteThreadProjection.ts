/**
 * 1.0.6-TV6 — RemoteThreadSnapshot projection (the iOS / Remote Console
 * contract).
 *
 * The Mac must project *bounded* transcript windows to a paired
 * iPhone/iPad, never a full chat dump (a long TaskWraith thread is many MB
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

import type { ChatMessage, ChatRun, DiffFileSummary, ProviderId } from './store/types'

/** Bounded preview size for routine iOS snapshot pushes — large enough
 * for most turns on a phone screen without blowing the relay frame budget. */
export const REMOTE_IOS_PREVIEW_MAX = 2400
/** Upper bound when the phone explicitly expands a clipped row. */
export const REMOTE_IOS_ROW_EXPAND_MAX = 32000

const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Gemini',
  codex: 'Codex',
  claude: 'Claude',
  kimi: 'Kimi',
  grok: 'Grok',
  cursor: 'Cursor',
  ollama: 'Ollama'
}

function shortModelLabel(model: string): string {
  const trimmed = model.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 28) return trimmed
  const slash = trimmed.lastIndexOf('/')
  if (slash >= 0 && slash < trimmed.length - 1) {
    const tail = trimmed.slice(slash + 1).trim()
    if (tail.length > 0 && tail.length <= 28) return tail
  }
  return `${trimmed.slice(0, 25).trimEnd()}…`
}

/** Solo-chat speaker label — mirrors the desktop assistant header:
 * `Provider` or `Provider · Model` when the run/message carries one. */
export function soloSpeakerForMessage(
  chatProvider: ProviderId | undefined,
  runs: ChatRun[] | undefined
): (message: ChatMessage) => string | undefined {
  const runById = new Map(
    (Array.isArray(runs) ? runs : [])
      .filter((run) => run && typeof run.runId === 'string')
      .map((run) => [run.runId, run] as const)
  )
  return (message) => {
    if (message.role !== 'assistant' && message.role !== 'tool') return undefined
    if (message.metadata?.ensembleProvider) return undefined
    const provider =
      (message.metadata?.ensembleProvider as ProviderId | undefined) ?? chatProvider
    if (!provider) return undefined
    const label = PROVIDER_LABELS[provider] ?? provider
    const run = typeof message.runId === 'string' ? runById.get(message.runId) : undefined
    const model =
      (typeof message.metadata?.providerModel === 'string'
        ? message.metadata.providerModel
        : undefined) ||
      (typeof message.metadata?.ensembleModel === 'string'
        ? message.metadata.ensembleModel
        : undefined) ||
      run?.actualModel ||
      run?.requestedModel
    if (model) {
      const short = shortModelLabel(model)
      return short ? `${label} · ${short}` : label
    }
    return label
  }
}

export function remoteSpeakerForMessage(
  chat: {
    provider?: ProviderId
    ensemble?: { enabled?: boolean; participants?: unknown }
    runs?: ChatRun[]
  },
  ensembleSpeaker?: (message: ChatMessage) => string | undefined
): (message: ChatMessage) => string | undefined {
  if (chat.ensemble?.enabled && ensembleSpeaker) return ensembleSpeaker
  return soloSpeakerForMessage(chat.provider, chat.runs)
}

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

export interface RemoteToolEntry {
  name: string
  category: 'task' | 'read' | 'write' | 'search' | 'shell' | 'unknown'
  status: 'running' | 'success' | 'error'
  file?: string
  additions?: number
  deletions?: number
  detail?: string
}

export interface RemoteThreadRow {
  /** === desktop `message.id`, so remote deep-links resolve exactly. */
  id: string
  runId?: string
  role: ChatMessage['role']
  kind: RemoteThreadRowKind
  /** Ensemble identity of the authoring participant — the SAME form the
   * desktop transcript tag uses minus the #pN handle:
   * `Provider / Role (Model)`, model included only on same-provider-
   * duplicate panels. Absent for solo chats and user rows, so remote
   * clients render "Agent"/"You" exactly like a solo desktop chat. */
  speaker?: string
  /** Images attached to this message (desktop file-picker or phone
   * uploads — both land in message.metadata.imagePaths). Count only;
   * remote clients render an attachment chip. */
  imageAttachmentCount?: number
  /** Bounded + sanitized one-screen preview of the row body. */
  preview: string
  /** True when `preview` was clipped from a longer body. */
  truncated: boolean
  /** Present for tool rows — compact stand-in for the ActivityStack. */
  toolSummary?: {
    activityCount: number
    status: 'running' | 'success' | 'error' | 'mixed'
    /** Per-tool detail (desktop activity-card parity): name, category,
     * status, the touched file, +/− diff stats for edits, and a clipped
     * result line. Capped at 12 entries; activityCount stays the truth. */
    tools?: RemoteToolEntry[]
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
  tokensIn?: number
  tokensOut?: number
  /** Pre-formatted cost line (e.g. "$0.45") when the run reported one. */
  costText?: string
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
  /** Ensemble speaker labeler — the bridge passes
   * `ensembleSpeakerForMessage(chat.ensemble.participants)` for ensemble
   * chats so each assistant row carries its participant identity. Solo
   * chats omit it (rows stay speaker-less). */
  speakerForMessage?: (message: ChatMessage) => string | undefined
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
  // Replace C0 controls (incl. NUL), DEL, and C1 controls with a space —
  // EXCEPT newlines: line structure is what lets a remote client render
  // markdown blocks (headings/lists/fences/tables). Flattening to one
  // line shipped mashed paragraphs no renderer could recover.
  let cleaned = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    if (raw[i] === '\n') {
      cleaned += '\n'
    } else if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      cleaned += ' '
    } else {
      cleaned += raw[i]
    }
  }
  const collapsed = cleaned
    .replace(/[^\S\n]+/g, ' ') // collapse runs of spaces/tabs, keep newlines
    .replace(/ ?\n ?/g, '\n') // trim spaces hugging line breaks
    .replace(/\n{3,}/g, '\n\n') // cap blank-line runs
    .trim()
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
  if (metaKind === 'guestParticipantReply') return 'tool'
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
  const tools: RemoteToolEntry[] = activities.slice(0, 12).map((activity) => {
    const entry: RemoteToolEntry = {
      name: activity.displayName || activity.toolName,
      category: activity.category ?? 'unknown',
      status:
        activity.status === 'running' || activity.status === 'pending'
          ? 'running'
          : activity.status === 'error'
            ? 'error'
            : 'success'
    }
    if (typeof activity.filePath === 'string' && activity.filePath) {
      entry.file = activity.filePath
    }
    if (typeof activity.diffSummary?.additions === 'number') {
      entry.additions = activity.diffSummary.additions
    }
    if (typeof activity.diffSummary?.deletions === 'number') {
      entry.deletions = activity.diffSummary.deletions
    }
    const detail = activity.resultSummary?.trim()
    if (detail) {
      entry.detail = detail.length > 90 ? `${detail.slice(0, 87).trimEnd()}...` : detail
    }
    return entry
  })
  return { activityCount: activities.length, status, tools }
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
  const imagePaths = (message.metadata as Record<string, unknown> | undefined)?.imagePaths
  if (Array.isArray(imagePaths) && imagePaths.length > 0) {
    row.imageAttachmentCount = imagePaths.length
  }
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
  // `stats` is loosely typed; pull token/cost telemetry where exposed
  // (canonical keys per the desktop usage aggregator: inputTokens /
  // outputTokens / totalTokens; cost via cost_usd / total_cost_usd).
  const stats = run.stats as Record<string, unknown> | undefined
  if (stats) {
    const num = (...keys: string[]): number | undefined => {
      for (const key of keys) {
        const v = stats[key]
        if (typeof v === 'number' && Number.isFinite(v)) return v
        if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
      }
      return undefined
    }
    const tokensIn = num('inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens')
    const tokensOut = num('outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens')
    if (tokensIn !== undefined) summary.tokensIn = tokensIn
    if (tokensOut !== undefined) summary.tokensOut = tokensOut
    const total =
      num('totalTokens', 'total_tokens', 'tokens') ??
      (tokensIn !== undefined || tokensOut !== undefined
        ? (tokensIn ?? 0) + (tokensOut ?? 0)
        : undefined)
    if (total !== undefined) summary.totalTokens = total
    const cost = num('cost_usd', 'total_cost_usd', 'costUsd', 'totalCostUsd')
    if (cost !== undefined && cost > 0) {
      summary.costText = `$${cost >= 1 ? cost.toFixed(2) : cost.toFixed(3)}`
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

  const toRow = (message: ChatMessage, att: RemoteAttentionKind | null): RemoteThreadRow => {
    const row = buildRow(message, previewMax, att)
    const speaker = opts.speakerForMessage?.(message)
    if (speaker) row.speaker = speaker
    return row
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
      if (rows.length < cap) rows.push(toRow(message, att))
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
      rows: slice.map((m) => toRow(m, attentionFor(m))),
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
    rows: slice.map((m) => toRow(m, attentionFor(m))),
    windowStartIndex: start,
    hasMoreAbove: start > 0,
    hasMoreBelow: false
  }
}
