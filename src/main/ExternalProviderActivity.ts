import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import os from 'os'
import type { ProviderId, UsageRecord } from './store/types'
import { loadCursorIdeUsageEvents } from './cursor/CursorExternalActivity'

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
const MAX_CODEX_SESSION_FILES = 2_400
const MAX_CLAUDE_SESSION_FILES = 1_200
const MAX_GEMINI_SESSION_FILES = 1_200
const MAX_TEXT_BYTES = 8 * 1024 * 1024
const MAX_EXPANDED_SESSION_TEXT_BYTES = 128 * 1024 * 1024
const MAX_CODEX_SQLITE_MARKERS_PER_BUCKET = 8

// ── Cached front door ───────────────────────────────────────────────────────
// A full load re-scans up to ~5k provider session files (multi-second on a
// busy machine) — far too heavy to run on every heatmap mount, and the data
// only meaningfully changes over hours. Serve-stale-while-revalidate with a
// 2h freshness window; index.ts prewarms at startup so the FIRST open is
// hydrated too.

const EXTERNAL_USAGE_CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000

export interface ExternalUsageRollup {
  providers: Array<{ provider: string; h24: number; d7: number; d90: number }>
  totals: { h24: number; d7: number; d90: number }
}

/** Token totals per provider for the 24h/7d/90d chips — computed off the
 * cached usage records so paired devices get the same numbers the desktop
 * External Activity header shows. */
export function buildExternalUsageRollup(
  records: UsageRecord[],
  now: number = Date.now()
): ExternalUsageRollup {
  const h24 = now - 24 * 60 * 60 * 1000
  const d7 = now - 7 * 24 * 60 * 60 * 1000
  const d90 = now - 90 * 24 * 60 * 60 * 1000
  const byProvider = new Map<string, { h24: number; d7: number; d90: number }>()
  const totals = { h24: 0, d7: 0, d90: 0 }
  for (const record of records) {
    if (record.usageKind === 'reset_hint') continue
    const tokens = record.totalTokens || record.inputTokens + record.outputTokens || 0
    if (!tokens || !Number.isFinite(record.timestamp)) continue
    const key = record.provider ?? 'unknown'
    const bucket = byProvider.get(key) ?? { h24: 0, d7: 0, d90: 0 }
    if (record.timestamp >= d90) {
      bucket.d90 += tokens
      totals.d90 += tokens
      if (record.timestamp >= d7) {
        bucket.d7 += tokens
        totals.d7 += tokens
        if (record.timestamp >= h24) {
          bucket.h24 += tokens
          totals.h24 += tokens
        }
      }
    }
    byProvider.set(key, bucket)
  }
  return {
    providers: [...byProvider.entries()]
      .map(([provider, buckets]) => ({ provider, ...buckets }))
      .sort((a, b) => b.d90 - a.d90),
    totals
  }
}

let externalUsageCache: { records: UsageRecord[]; scannedAt: number } | null = null
let externalUsageInFlight: Promise<UsageRecord[]> | null = null

export async function getExternalUsageCached(
  options: ExternalProviderActivityOptions & { maxAgeMs?: number } = {}
): Promise<UsageRecord[]> {
  const maxAgeMs = options.maxAgeMs ?? EXTERNAL_USAGE_CACHE_MAX_AGE_MS
  const now = Date.now()
  const cached = externalUsageCache
  if (cached && now - cached.scannedAt < maxAgeMs) {
    return cached.records
  }
  const refresh = (externalUsageInFlight ??= loadExternalProviderUsageRecords(options)
    .then((records) => {
      externalUsageCache = { records, scannedAt: Date.now() }
      return records
    })
    .finally(() => {
      externalUsageInFlight = null
    }))
  // Stale-while-revalidate: a stale cache answers instantly while the
  // rescan proceeds; only a COLD cache awaits the scan.
  if (cached) return cached.records
  return refresh
}

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

function extractCodexSessionModel(json: Record<string, unknown>): string | null {
  const topType = typeof json.type === 'string' ? json.type : ''
  const payload = json.payload
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (topType !== 'turn_context' && record.type !== 'turn_context') return null

  const direct = typeof record.model === 'string' ? record.model.trim() : ''
  if (direct) return direct

  const collaboration = record.collaboration_mode
  if (collaboration && typeof collaboration === 'object') {
    const settings = (collaboration as Record<string, unknown>).settings
    if (settings && typeof settings === 'object') {
      const settingsRecord = settings as Record<string, unknown>
      const settingsModel = settingsRecord.model
      const nested = typeof settingsModel === 'string' ? settingsModel.trim() : ''
      if (nested) return nested
    }
  }
  return null
}

async function readCodexActivity(homeDir: string, sinceMs: number): Promise<ExternalUsageEvent[]> {
  const codexRoot = join(homeDir, '.codex')
  const files = [
    ...(await collectFiles(
      join(codexRoot, 'sessions'),
      (path) => path.endsWith('.jsonl'),
      sinceMs,
      MAX_CODEX_SESSION_FILES
    )),
    ...(await collectFiles(
      join(codexRoot, 'archived_sessions'),
      (path) => path.endsWith('.jsonl'),
      sinceMs,
      MAX_CODEX_SESSION_FILES
    ))
  ]
  const events: ExternalUsageEvent[] = []
  for (const filePath of files) {
    const text = await readTextTail(filePath)
    let lineIndex = 0
    let sessionModel = ''
    for (const json of parseJsonLines(text)) {
      lineIndex += 1
      const turnModel = extractCodexSessionModel(json)
      if (turnModel) sessionModel = turnModel
      if (json?.payload?.type !== 'token_count') continue
      const timestamp = parseTimestamp(json.timestamp)
      if (!timestamp || timestamp < sinceMs) continue
      const usage = json.payload?.info?.last_token_usage || json.payload?.info?.total_token_usage
      const totalTokens = tokenTotal(usage)
      if (totalTokens <= 0) continue
      events.push({
        provider: 'codex',
        timestamp,
        model: sessionModel || 'codex',
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
  events.push(...(await readCodexSessionIndexActivity(codexRoot, sinceMs)))
  events.push(...(await readCodexSqliteActivity(codexRoot, sinceMs)))
  return events
}

async function readClaudeActivity(homeDir: string, sinceMs: number): Promise<ExternalUsageEvent[]> {
  const root = join(homeDir, '.claude', 'projects')
  const files = await collectFiles(
    root,
    (path) => path.endsWith('.jsonl'),
    sinceMs,
    MAX_CLAUDE_SESSION_FILES
  )
  const events: ExternalUsageEvent[] = []
  const seen = new Set<string>()
  for (const filePath of files) {
    const text = await readTextTail(filePath, MAX_EXPANDED_SESSION_TEXT_BYTES)
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
    (path) => isGeminiSessionActivityPath(path),
    sinceMs,
    MAX_GEMINI_SESSION_FILES
  )
  const events: ExternalUsageEvent[] = []
  const seen = new Set<string>()
  for (const filePath of files) {
    const text = await readTextTail(filePath, MAX_EXPANDED_SESSION_TEXT_BYTES)
    const entries = parseGeminiSessionEntries(text)
    for (const { json, sourceIndex } of entries) {
      const timestamp = parseTimestamp(json?.timestamp)
      if (!timestamp || timestamp < sinceMs) continue
      const tokens = json?.tokens
      if (!tokens || typeof tokens !== 'object') continue
      const inputTokens = numberValue(tokens.input)
      const outputTokens = numberValue(tokens.output)
      const totalTokens = inputTokens + outputTokens || numberValue(tokens.total)
      if (totalTokens <= 0) continue
      const dedupeKey = `${json?.id || ''}|${timestamp}|${totalTokens}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      events.push({
        provider: 'gemini',
        timestamp,
        model: String(json?.model || 'Gemini'),
        inputTokens,
        outputTokens: outputTokens || Math.max(0, totalTokens - inputTokens),
        totalTokens,
        sourceKey: `${filePath}:${sourceIndex}`
      })
    }
  }
  return events
}

async function readCodexSessionIndexActivity(
  codexRoot: string,
  sinceMs: number
): Promise<ExternalUsageEvent[]> {
  const indexPath = join(codexRoot, 'session_index.jsonl')
  try {
    await fs.access(indexPath)
  } catch {
    return []
  }

  const events: ExternalUsageEvent[] = []
  const text = await readTextTail(indexPath)
  let lineIndex = 0
  for (const json of parseJsonLines(text)) {
    lineIndex += 1
    const timestamp =
      parseTimestamp(json?.updated_at) ||
      parseTimestamp(json?.updatedAt) ||
      parseTimestamp(json?.timestamp) ||
      parseTimestamp(json?.created_at) ||
      parseTimestamp(json?.createdAt)
    if (!timestamp || timestamp < sinceMs) continue
    events.push({
      provider: 'codex',
      timestamp,
      model: 'Codex',
      totalTokens: 0,
      sourceKey: `${indexPath}:${lineIndex}`
    })
  }
  return events
}

async function readCodexSqliteActivity(
  codexRoot: string,
  sinceMs: number
): Promise<ExternalUsageEvent[]> {
  const dbPath = join(codexRoot, 'logs_2.sqlite')
  try {
    await fs.access(dbPath)
  } catch {
    return []
  }

  const cutoffSeconds = Math.floor(sinceMs / 1000)
  const query = [
    'SELECT (ts / 7200) * 7200 AS bucket_ts, COUNT(*) AS event_count FROM logs',
    `WHERE ts >= ${cutoffSeconds}`,
    'GROUP BY bucket_ts ORDER BY bucket_ts ASC;'
  ].join(' ')
  const rows = await runSqliteQuery(dbPath, query)
  const events: ExternalUsageEvent[] = []
  for (const row of rows) {
    const [bucketRaw, countRaw] = row.split('|')
    const bucketSeconds = Number(bucketRaw)
    const eventCount = Number(countRaw)
    if (!Number.isFinite(bucketSeconds) || !Number.isFinite(eventCount)) continue
    const markerCount = Math.min(
      MAX_CODEX_SQLITE_MARKERS_PER_BUCKET,
      Math.max(1, Math.ceil(Math.log2(Math.max(1, eventCount) + 1)))
    )
    const spacingSeconds = 7200 / (markerCount + 1)
    for (let index = 0; index < markerCount; index += 1) {
      const timestamp = (bucketSeconds + spacingSeconds * (index + 1)) * 1000
      if (timestamp < sinceMs) continue
      events.push({
        provider: 'codex',
        timestamp,
        model: 'Codex',
        totalTokens: 0,
        sourceKey: `codex-sqlite:${bucketSeconds}:${index}`
      })
    }
  }
  return events
}

async function readKimiActivity(homeDir: string, sinceMs: number): Promise<ExternalUsageEvent[]> {
  const root = join(homeDir, '.kimi', 'sessions')
  const files = await collectFiles(root, isKimiWireActivityPath, sinceMs)
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
  return loadCursorIdeUsageEvents({ homeDir, sinceMs })
}

async function runSqliteQuery(dbPath: string, query: string): Promise<string[]> {
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
        resolve(
          String(stdout || '')
            .split(/\r?\n/)
            .filter(Boolean)
        )
      }
    )
  })
}

async function collectFiles(
  root: string,
  accepts: (path: string) => boolean,
  sinceMs: number,
  maxFiles: number = MAX_FILES_PER_PROVIDER
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
    .slice(0, maxFiles)
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

function parseGeminiSessionEntries(text: string): Array<{ json: any; sourceIndex: number }> {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed?.messages)) {
        return parsed.messages.map((json: any, index: number) => ({
          json,
          sourceIndex: index + 1
        }))
      }
      if (parsed?.tokens && typeof parsed.tokens === 'object') {
        return [{ json: parsed, sourceIndex: 1 }]
      }
    } catch {
      // Modern Gemini sessions are JSONL, so fall through to line parsing.
    }
  }

  const entries: Array<{ json: any; sourceIndex: number }> = []
  let lineIndex = 0
  for (const line of text.split(/\r?\n/)) {
    lineIndex += 1
    const trimmedLine = line.trim()
    if (!trimmedLine || trimmedLine.startsWith('{$set')) continue
    try {
      entries.push({ json: JSON.parse(trimmedLine), sourceIndex: lineIndex })
    } catch {
      continue
    }
  }
  return entries
}

function isGeminiSessionActivityPath(path: string): boolean {
  return /\/chats\/.+\.jsonl?$/.test(toPortablePath(path))
}

function isKimiWireActivityPath(path: string): boolean {
  return toPortablePath(path).endsWith('/wire.jsonl')
}

function toPortablePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
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
