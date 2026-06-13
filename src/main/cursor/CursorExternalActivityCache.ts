import { promises as fs } from 'fs'
import { dirname } from 'path'
import type { CursorExternalUsageEvent } from './CursorExternalActivity'

export const CURSOR_EXTERNAL_ACTIVITY_CACHE_VERSION = 1
export const CURSOR_SQLITE_RESCAN_MAX_AGE_MS = 6 * 60 * 60 * 1000
export const CURSOR_MODEL_HINTS_MAX_AGE_MS = 30 * 60 * 1000
export const CURSOR_TRANSCRIPT_CHUNK_SIZE = 24

export interface CursorTranscriptCacheEntry {
  filePath: string
  mtimeMs: number
  size: number
  event: CursorExternalUsageEvent
}

export interface CursorSqliteCacheSnapshot {
  dbPath: string
  dbMtimeMs: number
  scannedAt: number
  events: CursorExternalUsageEvent[]
}

export interface CursorExternalActivityDiskCache {
  version: number
  updatedAt: number
  sinceMs: number
  transcriptEntries: Record<string, CursorTranscriptCacheEntry>
  pendingTranscriptPaths: string[]
  sqliteSnapshot: CursorSqliteCacheSnapshot | null
  modelHints: Record<string, string>
  modelHintsFetchedAt: number
}

export function emptyCursorExternalActivityDiskCache(sinceMs: number): CursorExternalActivityDiskCache {
  return {
    version: CURSOR_EXTERNAL_ACTIVITY_CACHE_VERSION,
    updatedAt: 0,
    sinceMs,
    transcriptEntries: {},
    pendingTranscriptPaths: [],
    sqliteSnapshot: null,
    modelHints: {},
    modelHintsFetchedAt: 0
  }
}

export function mergeCursorDiskCacheEvents(
  cache: CursorExternalActivityDiskCache,
  sinceMs: number
): CursorExternalUsageEvent[] {
  const events: CursorExternalUsageEvent[] = []
  const seen = new Set<string>()

  const push = (event: CursorExternalUsageEvent | null | undefined): void => {
    if (!event || event.timestamp < sinceMs) return
    if (seen.has(event.sourceKey)) return
    seen.add(event.sourceKey)
    events.push(event)
  }

  for (const entry of Object.values(cache.transcriptEntries)) {
    push(entry.event)
  }
  for (const event of cache.sqliteSnapshot?.events || []) {
    push(event)
  }

  return events.sort((a, b) => b.timestamp - a.timestamp)
}

export function cursorTranscriptNeedsParsing(
  cache: CursorExternalActivityDiskCache,
  filePath: string,
  mtimeMs: number,
  size: number
): boolean {
  const entry = cache.transcriptEntries[filePath]
  return !entry || entry.mtimeMs !== mtimeMs || entry.size !== size
}

export function cursorSqliteNeedsRescan(
  cache: CursorExternalActivityDiskCache,
  dbPath: string,
  dbMtimeMs: number,
  now: number,
  force: boolean
): boolean {
  if (force) return true
  const snapshot = cache.sqliteSnapshot
  if (!snapshot) return true
  if (snapshot.dbPath !== dbPath || snapshot.dbMtimeMs !== dbMtimeMs) return true
  return now - snapshot.scannedAt >= CURSOR_SQLITE_RESCAN_MAX_AGE_MS
}

export function cursorModelHintsNeedRefresh(
  cache: CursorExternalActivityDiskCache,
  now: number,
  force: boolean
): boolean {
  if (force) return true
  if (!cache.modelHintsFetchedAt) return true
  return now - cache.modelHintsFetchedAt >= CURSOR_MODEL_HINTS_MAX_AGE_MS
}

export function pruneCursorTranscriptCache(
  cache: CursorExternalActivityDiskCache,
  activePaths: Set<string>,
  sinceMs: number
): void {
  for (const filePath of Object.keys(cache.transcriptEntries)) {
    const entry = cache.transcriptEntries[filePath]
    if (!activePaths.has(filePath) || entry.event.timestamp < sinceMs) {
      delete cache.transcriptEntries[filePath]
    }
  }
}

export async function readCursorExternalActivityDiskCache(
  cachePath: string
): Promise<CursorExternalActivityDiskCache | null> {
  try {
    const raw = await fs.readFile(cachePath, 'utf8')
    const parsed = JSON.parse(raw) as CursorExternalActivityDiskCache
    if (parsed?.version !== CURSOR_EXTERNAL_ACTIVITY_CACHE_VERSION) return null
    if (!parsed.transcriptEntries || typeof parsed.transcriptEntries !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

export async function writeCursorExternalActivityDiskCache(
  cachePath: string,
  cache: CursorExternalActivityDiskCache
): Promise<void> {
  try {
    await fs.mkdir(dirname(cachePath), { recursive: true })
    await fs.writeFile(cachePath, JSON.stringify(cache), 'utf8')
  } catch {
    // Best-effort persistence — a failed write must not break usage surfaces.
  }
}
