import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import os from 'os'
import type { ProviderId, UsageRecord } from './store/types'
import { cursorStateDbCandidates } from './cursor/CursorUsage'

type ExternalActivityProvider = Extract<
  ProviderId,
  'codex' | 'claude' | 'gemini' | 'kimi' | 'cursor'
>

interface ExternalProviderActivityOptions {
  homeDir?: string
  now?: Date
  lookbackDays?: number
}

interface ExternalUsageEvent {
  provider: ExternalActivityProvider
  timestamp: number
  model: string
  inputTokens?: number
  outputTokens?: number
  totalTokens: number
  sourceKey: string
}

const DEFAULT_LOOKBACK_DAYS = 90
const MAX_FILES_PER_PROVIDER = 260
const MAX_TEXT_BYTES = 8 * 1024 * 1024

export async function loadExternalProviderUsageRecords(
  options: ExternalProviderActivityOptions = {}
): Promise<UsageRecord[]> {
  const homeDir = options.homeDir || os.homedir()
  const now = options.now || new Date()
  const lookbackDays = options.lookbackDays || DEFAULT_LOOKBACK_DAYS
  const sinceMs = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000

  const readers = [
    readCodexActivity,
    readClaudeActivity,
    readGeminiActivity,
    readKimiActivity,
    readCursorActivity
  ]
  const nested = await Promise.all(readers.map((reader) => safeRead(reader, homeDir, sinceMs)))
  const byId = new Map<string, UsageRecord>()
  for (const event of nested.flat()) {
    const record = eventToUsageRecord(event)
    if (record) byId.set(record.id, record)
  }
  return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp)
}

async function safeRead(
  reader: (homeDir: string, sinceMs: number) => Promise<ExternalUsageEvent[]>,
  homeDir: string,
  sinceMs: number
): Promise<ExternalUsageEvent[]> {
  try {
    return await reader(homeDir, sinceMs)
  } catch {
    return []
  }
}

function eventToUsageRecord(event: ExternalUsageEvent): UsageRecord | null {
  if (!Number.isFinite(event.timestamp) || event.timestamp <= 0) return null
  const totalTokens = Math.max(0, Math.round(event.totalTokens || 0))
  const inputTokens = Math.max(0, Math.round(event.inputTokens || 0))
  const outputTokens = Math.max(0, Math.round(event.outputTokens ?? totalTokens - inputTokens))
  const id = `external-${event.provider}-${stableHash(
    `${event.timestamp}|${event.model}|${totalTokens}|${event.sourceKey}`
  )}`
  return {
    id,
    provider: event.provider,
    timestamp: event.timestamp,
    workspaceId: 'external',
    chatId: `external-${event.provider}`,
    runId: `external-${event.provider}`,
    usageKind: 'run',
    model: event.model || event.provider,
    inputTokens,
    outputTokens,
    totalTokens,
    durationMs: 0
  }
}

async function readCodexActivity(homeDir: string, sinceMs: number): Promise<ExternalUsageEvent[]> {
  const root = join(homeDir, '.codex', 'sessions')
  const files = await collectFiles(root, (path) => path.endsWith('.jsonl'), sinceMs)
  const events: ExternalUsageEvent[] = []
  for (const filePath of files) {
    const text = await readTextTail(filePath)
    let lineIndex = 0
    for (const json of parseJsonLines(text)) {
      lineIndex += 1
      if (json?.payload?.type !== 'token_count') continue
      const timestamp = parseTimestamp(json.timestamp)
      if (!timestamp || timestamp < sinceMs) continue
      const usage = json.payload?.info?.last_token_usage || json.payload?.info?.total_token_usage
      const totalTokens = tokenTotal(usage)
      if (totalTokens <= 0) continue
      events.push({
        provider: 'codex',
        timestamp,
        model: 'Codex',
        totalTokens,
        inputTokens:
          numberValue(usage?.input_tokens) +
          numberValue(usage?.cached_input_tokens) +
          numberValue(usage?.cache_read_input_tokens) +
          numberValue(usage?.cache_creation_input_tokens),
        outputTokens:
          numberValue(usage?.output_tokens) + numberValue(usage?.reasoning_output_tokens),
        sourceKey: `${filePath}:${lineIndex}`
      })
    }
  }
  return events
}

async function readClaudeActivity(homeDir: string, sinceMs: number): Promise<ExternalUsageEvent[]> {
  const root = join(homeDir, '.claude', 'projects')
  const files = await collectFiles(root, (path) => path.endsWith('.jsonl'), sinceMs)
  const events: ExternalUsageEvent[] = []
  const seen = new Set<string>()
  for (const filePath of files) {
    const text = await readTextTail(filePath)
    let lineIndex = 0
    for (const json of parseJsonLines(text)) {
      lineIndex += 1
      const timestamp = parseTimestamp(json?.timestamp)
      if (!timestamp || timestamp < sinceMs) continue
      const usage = json?.usage || json?.message?.usage
      if (!usage || typeof usage !== 'object') continue
      const inputTokens =
        numberValue(usage.input_tokens) +
        numberValue(usage.cache_creation_input_tokens) +
        numberValue(usage.cache_read_input_tokens) +
        numberValue(usage.input_audio_tokens)
      const outputTokens = numberValue(usage.output_tokens) + numberValue(usage.output_audio_tokens)
      const totalTokens = inputTokens + outputTokens
      if (totalTokens <= 0) continue
      const messageId = String(json?.message?.id || '')
      const requestId = String(json?.requestId || json?.request_id || '')
      const dedupeKey = `${requestId}|${messageId}|${timestamp}|${totalTokens}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      events.push({
        provider: 'claude',
        timestamp,
        model: String(json?.message?.model || json?.model || 'Claude'),
        inputTokens,
        outputTokens,
        totalTokens,
        sourceKey: `${filePath}:${lineIndex}`
      })
    }
  }
  return events
}

async function readGeminiActivity(homeDir: string, sinceMs: number): Promise<ExternalUsageEvent[]> {
  const root = join(homeDir, '.gemini', 'tmp')
  const files = await collectFiles(
    root,
    (path) => /\/chats\/session-.*\.jsonl?$/.test(path),
    sinceMs
  )
  const events: ExternalUsageEvent[] = []
  const seen = new Set<string>()
  for (const filePath of files) {
    const text = await readTextTail(filePath)
    let lineIndex = 0
    for (const json of parseJsonLines(text)) {
      lineIndex += 1
      const timestamp = parseTimestamp(json?.timestamp)
      if (!timestamp || timestamp < sinceMs) continue
      const tokens = json?.tokens
      if (!tokens || typeof tokens !== 'object') continue
      const inputTokens = numberValue(tokens.input)
      const outputTokens = numberValue(tokens.output)
      const totalTokens = inputTokens + outputTokens
      if (totalTokens <= 0) continue
      const dedupeKey = `${json?.id || ''}|${timestamp}|${totalTokens}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      events.push({
        provider: 'gemini',
        timestamp,
        model: String(json?.model || 'Gemini'),
        inputTokens,
        outputTokens,
        totalTokens,
        sourceKey: `${filePath}:${lineIndex}`
      })
    }
  }
  return events
}

async function readKimiActivity(homeDir: string, sinceMs: number): Promise<ExternalUsageEvent[]> {
  const root = join(homeDir, '.kimi', 'sessions')
  const files = await collectFiles(root, (path) => path.endsWith('/wire.jsonl'), sinceMs)
  const events: ExternalUsageEvent[] = []
  for (const filePath of files) {
    const text = await readTextTail(filePath)
    let lineIndex = 0
    for (const json of parseJsonLines(text)) {
      lineIndex += 1
      const timestamp = parseTimestamp(json?.timestamp)
      if (!timestamp || timestamp < sinceMs) continue
      const message = json?.message
      if (message?.type !== 'StatusUpdate') continue
      const usage = message?.payload?.token_usage
      const inputTokens =
        numberValue(usage?.input_other) +
        numberValue(usage?.input_cache_read) +
        numberValue(usage?.input_cache_creation)
      const outputTokens = numberValue(usage?.output)
      const totalTokens = inputTokens + outputTokens
      if (totalTokens <= 0) continue
      events.push({
        provider: 'kimi',
        timestamp,
        model: 'Kimi',
        inputTokens,
        outputTokens,
        totalTokens,
        sourceKey: `${filePath}:${lineIndex}`
      })
    }
  }
  return events
}

async function readCursorActivity(homeDir: string, sinceMs: number): Promise<ExternalUsageEvent[]> {
  const rows: string[] = []
  for (const dbPath of cursorStateDbCandidates(homeDir)) {
    try {
      await fs.access(dbPath)
    } catch {
      continue
    }
    const result = await runSqliteRows(dbPath)
    if (result.length > 0) {
      rows.push(...result)
      break
    }
  }

  const events: ExternalUsageEvent[] = []
  for (const row of rows) {
    const tab = row.indexOf('\t')
    const rawValue = tab >= 0 ? row.slice(tab + 1) : row
    try {
      const parsed = JSON.parse(rawValue)
      const timestamp = parseCursorDailyStatTimestamp(parsed)
      if (!timestamp || timestamp < sinceMs) continue
      events.push({
        provider: 'cursor',
        timestamp,
        model: 'Cursor',
        totalTokens: 0,
        sourceKey: `cursor:${parsed.date || timestamp}`
      })
    } catch {
      continue
    }
  }
  return events
}

async function runSqliteRows(dbPath: string): Promise<string[]> {
  const query =
    "SELECT key || char(9) || value FROM ItemTable WHERE key LIKE 'aiCodeTracking.dailyStats.%' ORDER BY key ASC;"
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/sqlite3',
      ['-readonly', dbPath, query],
      { timeout: 8_000 },
      (err, stdout) => {
        if (err) {
          resolve([])
          return
        }
        resolve(String(stdout || '').split(/\r?\n/).filter(Boolean))
      }
    )
  })
}

async function collectFiles(
  root: string,
  accepts: (path: string) => boolean,
  sinceMs: number
): Promise<string[]> {
  try {
    const rootStat = await fs.stat(root)
    if (!rootStat.isDirectory()) return []
  } catch {
    return []
  }

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
        stack.push(entryPath)
        continue
      }
      if (!entry.isFile() || !accepts(entryPath)) continue
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
    .slice(0, MAX_FILES_PER_PROVIDER)
    .map((file) => file.path)
}

async function readTextTail(filePath: string, maxBytes = MAX_TEXT_BYTES): Promise<string> {
  const handle = await fs.open(filePath, 'r')
  try {
    const stat = await handle.stat()
    const start = Math.max(0, stat.size - maxBytes)
    const length = stat.size - start
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, start)
    let text = buffer.toString('utf8')
    if (start > 0) {
      const firstNewline = text.indexOf('\n')
      if (firstNewline >= 0) text = text.slice(firstNewline + 1)
    }
    return text
  } finally {
    await handle.close()
  }
}

function parseJsonLines(text: string): any[] {
  const parsed: any[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('{$set')) continue
    try {
      parsed.push(JSON.parse(trimmed))
    } catch {
      continue
    }
  }
  return parsed
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseCursorDailyStatTimestamp(value: any): number | null {
  if (typeof value?.date !== 'string' || !value.date.trim()) return null
  const parsed = Date.parse(`${value.date.trim()}T12:00:00`)
  return Number.isFinite(parsed) ? parsed : null
}

function tokenTotal(usage: any): number {
  if (!usage || typeof usage !== 'object') return 0
  const direct = numberValue(usage.total_tokens) || numberValue(usage.totalTokens)
  if (direct > 0) return direct
  return (
    numberValue(usage.input_tokens) +
    numberValue(usage.cached_input_tokens) +
    numberValue(usage.cache_read_input_tokens) +
    numberValue(usage.cache_creation_input_tokens) +
    numberValue(usage.output_tokens) +
    numberValue(usage.reasoning_output_tokens)
  )
}

function numberValue(value: unknown): number {
  const num = typeof value === 'string' ? Number(value) : Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}

function stableHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 16)
}
