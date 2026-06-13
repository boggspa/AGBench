import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { cursorStateDbCandidates } from './CursorUsage'

export interface CursorExternalUsageEvent {
  provider: 'cursor'
  timestamp: number
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  sourceKey: string
}

export interface CursorExternalActivityOptions {
  homeDir: string
  sinceMs: number
  /** Injectable for tests. */
  readTextFile?: (path: string) => Promise<string>
  statMtimeMs?: (path: string) => Promise<number>
  listTranscriptFiles?: (homeDir: string, sinceMs: number) => Promise<string[]>
  querySqlite?: (dbPath: string, query: string) => Promise<string[]>
}

const MAX_TRANSCRIPT_FILES = 400
const MAX_TRANSCRIPT_BYTES = 12 * 1024 * 1024
const TOKENS_PER_CHAR = 0.25
/** Rough tokens-per-line fallback when only dailyStats line counts exist. */
const TOKENS_PER_COMPOSER_LINE = 40

const CURSOR_SANDBOX_PROJECT_PREFIXES = ['tmp-', 'private-tmp-', 'var-folders-']

export function normalizeCursorExternalModelId(raw: string | undefined | null): string {
  const trimmed = String(raw || '').trim()
  const key = trimmed.toLowerCase()
  if (!key || key === 'cursor' || key === 'composer') return 'composer-2.5-fast'
  if (key === 'composer 2.5 fast' || key === 'composer-2.5-fast') return 'composer-2.5-fast'
  if (key === 'composer 2.5' || key === 'composer-2.5') return 'composer-2.5'
  if (key.startsWith('composer-')) return key
  if (key.includes('fast')) return 'composer-2.5-fast'
  if (key.includes('composer')) return 'composer-2.5'
  return 'composer-2.5-fast'
}

export function isCursorSandboxProjectDir(projectDirName: string): boolean {
  const name = projectDirName.replace(/\\/g, '/').split('/').pop() || projectDirName
  return CURSOR_SANDBOX_PROJECT_PREFIXES.some((prefix) => name.startsWith(prefix))
}

export function estimateTokensFromText(text: string): number {
  const len = text.length
  if (len <= 0) return 0
  return Math.max(1, Math.round(len * TOKENS_PER_CHAR))
}

export function extractTranscriptMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') {
      parts.push(record.text)
    }
  }
  return parts.join('\n')
}

export function inferCursorModelFromText(text: string): string {
  const haystack = text.toLowerCase()
  if (haystack.includes('composer-2.5-fast') || haystack.includes('composer 2.5 fast')) {
    return 'composer-2.5-fast'
  }
  if (haystack.includes('composer-2.5') || haystack.includes('composer 2.5')) {
    return 'composer-2.5'
  }
  return 'composer-2.5-fast'
}

export interface ParsedCursorAgentTranscript {
  composerId: string
  inputTokens: number
  outputTokens: number
  model: string
  timestamp: number
  sourceKey: string
}

/** Parse one Cursor IDE agent-transcript JSONL file into a single usage event. */
export function parseCursorAgentTranscript(
  filePath: string,
  text: string,
  mtimeMs: number,
  modelHint?: string
): ParsedCursorAgentTranscript | null {
  const normalizedPath = filePath.replace(/\\/g, '/')
  if (normalizedPath.includes('/subagents/')) return null

  const projectDir = normalizedPath.split('/projects/')[1]?.split('/')[0] || ''
  if (projectDir && isCursorSandboxProjectDir(projectDir)) return null

  const composerId =
    normalizedPath.match(/agent-transcripts\/([^/]+)\/[^/]+\.jsonl$/)?.[1] ||
    normalizedPath.match(/agent-transcripts\/([^/]+)\.jsonl$/)?.[1] ||
    'unknown'

  let inputTokens = 0
  let outputTokens = 0
  let model = modelHint ? normalizeCursorExternalModelId(modelHint) : ''
  let lastTimestamp = 0

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }

    const role = typeof parsed.role === 'string' ? parsed.role : ''
    if (role !== 'user' && role !== 'assistant') continue

    const message =
      parsed.message && typeof parsed.message === 'object'
        ? (parsed.message as Record<string, unknown>)
        : null
    const contentText = extractTranscriptMessageText(message?.content)
    if (!contentText) continue

    const tokens = estimateTokensFromText(contentText)
    if (role === 'user') inputTokens += tokens
    else outputTokens += tokens

    if (!model) model = inferCursorModelFromText(contentText)
    const createdAt = parseTimestamp(message?.createdAt ?? parsed.timestamp)
    if (createdAt && createdAt > lastTimestamp) lastTimestamp = createdAt
  }

  const totalTokens = inputTokens + outputTokens
  if (totalTokens <= 0) return null

  return {
    composerId,
    inputTokens,
    outputTokens,
    model: normalizeCursorExternalModelId(model),
    timestamp: lastTimestamp > 0 ? lastTimestamp : mtimeMs,
    sourceKey: `cursor-ide-transcript:${composerId}:${normalizedPath}`
  }
}

export function parseCursorDailyStatsValue(
  parsed: Record<string, unknown>,
  sourceKey: string
): CursorExternalUsageEvent | null {
  const timestamp = parseCursorDailyStatTimestamp(parsed)
  if (!timestamp) return null
  const suggested = numberValue(parsed.composerSuggestedLines)
  const accepted = numberValue(parsed.composerAcceptedLines)
  const lines = suggested + accepted
  if (lines <= 0) return null
  const totalTokens = Math.max(1, Math.round(lines * TOKENS_PER_COMPOSER_LINE))
  return {
    provider: 'cursor',
    timestamp,
    model: 'composer-2.5-fast',
    inputTokens: Math.round(totalTokens * 0.35),
    outputTokens: Math.round(totalTokens * 0.65),
    totalTokens,
    sourceKey
  }
}

export function parseCursorBubbleValue(
  parsed: Record<string, unknown>,
  sourceKey: string
): CursorExternalUsageEvent | null {
  const tokenCount =
    parsed.tokenCount && typeof parsed.tokenCount === 'object'
      ? (parsed.tokenCount as Record<string, unknown>)
      : null
  const inputTokens = numberValue(tokenCount?.inputTokens)
  const outputTokens = numberValue(tokenCount?.outputTokens)
  const totalTokens = inputTokens + outputTokens
  if (totalTokens <= 0) return null

  const timestamp =
    parseTimestamp(parsed.createdAt) ||
    parseTimestamp(parsed.timingInfo && typeof parsed.timingInfo === 'object'
      ? (parsed.timingInfo as Record<string, unknown>).startTime
      : undefined)
  if (!timestamp) return null

  const modelInfo =
    parsed.modelInfo && typeof parsed.modelInfo === 'object'
      ? (parsed.modelInfo as Record<string, unknown>)
      : null
  const model = normalizeCursorExternalModelId(
    typeof modelInfo?.modelName === 'string' ? modelInfo.modelName : undefined
  )

  return {
    provider: 'cursor',
    timestamp,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    sourceKey
  }
}

export async function loadCursorIdeUsageEvents(
  options: CursorExternalActivityOptions
): Promise<CursorExternalUsageEvent[]> {
  const readTextFile = options.readTextFile ?? ((path: string) => fs.readFile(path, 'utf8'))
  const statMtimeMs =
    options.statMtimeMs ??
    (async (path: string) => {
      const stat = await fs.stat(path)
      return stat.mtimeMs
    })
  const listTranscriptFiles =
    options.listTranscriptFiles ?? ((homeDir, sinceMs) => collectAgentTranscriptFiles(homeDir, sinceMs))
  const querySqlite = options.querySqlite ?? runSqliteQuery

  const modelHints = await loadCursorConversationModelHints(options.homeDir, querySqlite)
  const events: CursorExternalUsageEvent[] = []
  const seen = new Set<string>()

  const push = (event: CursorExternalUsageEvent | null): void => {
    if (!event || event.timestamp < options.sinceMs) return
    if (seen.has(event.sourceKey)) return
    seen.add(event.sourceKey)
    events.push(event)
  }

  const transcriptFiles = await listTranscriptFiles(options.homeDir, options.sinceMs)
  for (const filePath of transcriptFiles) {
    try {
      const [text, mtimeMs] = await Promise.all([
        readTextFile(filePath),
        statMtimeMs(filePath)
      ])
      if (text.length > MAX_TRANSCRIPT_BYTES) continue
      const composerId =
        filePath
          .replace(/\\/g, '/')
          .match(/agent-transcripts\/([^/]+)\//)?.[1] || ''
      const parsed = parseCursorAgentTranscript(
        filePath,
        text,
        mtimeMs,
        composerId ? modelHints.get(composerId) : undefined
      )
      if (!parsed) continue
      push({
        provider: 'cursor',
        timestamp: parsed.timestamp,
        model: parsed.model,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        totalTokens: parsed.inputTokens + parsed.outputTokens,
        sourceKey: parsed.sourceKey
      })
    } catch {
      continue
    }
  }

  for (const dbPath of cursorStateDbCandidates(options.homeDir)) {
    try {
      await fs.access(dbPath)
    } catch {
      continue
    }

    const bubbleRows = await querySqlite(
      dbPath,
      "SELECT key || char(9) || value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' ORDER BY key ASC;"
    )
    for (const row of bubbleRows) {
      const tab = row.indexOf('\t')
      const key = tab >= 0 ? row.slice(0, tab) : row
      const rawValue = tab >= 0 ? row.slice(tab + 1) : ''
      try {
        push(parseCursorBubbleValue(JSON.parse(rawValue), `cursor-ide-bubble:${key}`))
      } catch {
        continue
      }
    }

    const dailyRows = await querySqlite(
      dbPath,
      "SELECT key || char(9) || value FROM ItemTable WHERE key LIKE 'aiCodeTracking.dailyStats.%' ORDER BY key ASC;"
    )
    for (const row of dailyRows) {
      const tab = row.indexOf('\t')
      const key = tab >= 0 ? row.slice(0, tab) : row
      const rawValue = tab >= 0 ? row.slice(tab + 1) : ''
      try {
        push(parseCursorDailyStatsValue(JSON.parse(rawValue), `cursor-ide-daily:${key}`))
      } catch {
        continue
      }
    }

    if (bubbleRows.length > 0 || dailyRows.length > 0) break
  }

  return events.sort((a, b) => b.timestamp - a.timestamp)
}

async function loadCursorConversationModelHints(
  homeDir: string,
  querySqlite: (dbPath: string, query: string) => Promise<string[]>
): Promise<Map<string, string>> {
  const hints = new Map<string, string>()
  const trackingDb = join(homeDir, '.cursor', 'ai-tracking', 'ai-code-tracking.db')
  try {
    await fs.access(trackingDb)
  } catch {
    return hints
  }

  const rows = await querySqlite(
    trackingDb,
    'SELECT conversationId, model FROM conversation_summaries WHERE model IS NOT NULL AND model != "";'
  )
  for (const row of rows) {
    const tab = row.indexOf('|')
    if (tab < 0) continue
    const conversationId = row.slice(0, tab).trim()
    const model = row.slice(tab + 1).trim()
    if (conversationId && model) hints.set(conversationId, model)
  }

  if (hints.size > 0) return hints

  const hashRows = await querySqlite(
    trackingDb,
    `SELECT conversationId, model
     FROM (
       SELECT conversationId, model, MAX(createdAt) AS latest
       FROM ai_code_hashes
       WHERE source = 'composer' AND conversationId IS NOT NULL AND model IS NOT NULL
       GROUP BY conversationId
     )
     ORDER BY latest DESC
     LIMIT 500;`
  )
  for (const row of hashRows) {
    const tab = row.indexOf('|')
    if (tab < 0) continue
    const conversationId = row.slice(0, tab).trim()
    const model = row.slice(tab + 1).trim()
    if (conversationId && model && !hints.has(conversationId)) hints.set(conversationId, model)
  }

  return hints
}

async function collectAgentTranscriptFiles(homeDir: string, sinceMs: number): Promise<string[]> {
  const root = join(homeDir, '.cursor', 'projects')
  const files: Array<{ path: string; mtimeMs: number }> = []
  const stack = [root]

  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const entryPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'subagents') continue
        stack.push(entryPath)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      if (!entryPath.replace(/\\/g, '/').includes('/agent-transcripts/')) continue
      try {
        const stat = await fs.stat(entryPath)
        if (stat.mtimeMs < sinceMs) continue
        files.push({ path: entryPath, mtimeMs: stat.mtimeMs })
      } catch {
        continue
      }
    }
  }

  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_TRANSCRIPT_FILES)
    .map((file) => file.path)
}

async function runSqliteQuery(dbPath: string, query: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/sqlite3',
      ['-readonly', '-separator', '|', dbPath, query],
      { timeout: 8_000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([])
          return
        }
        resolve(
          String(stdout || '')
            .split(/\r?\n/)
            .filter(Boolean)
        )
      }
    )
  })
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseCursorDailyStatTimestamp(value: Record<string, unknown>): number | null {
  if (typeof value.date !== 'string' || !value.date.trim()) return null
  const parsed = Date.parse(`${value.date.trim()}T12:00:00`)
  return Number.isFinite(parsed) ? parsed : null
}

function numberValue(value: unknown): number {
  const num = typeof value === 'string' ? Number(value) : Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}
