import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { MessageChannelKind } from './MessageChannelTypes'
import { normalizeChannelKey } from './MessageChannelTypes'

export interface MessageChannelCursor {
  channel: MessageChannelKind
  accountId: string
  chatGuid: string
  lastRowId: number
  updatedAt: string
}

export interface MessageChannelCursorKey {
  channel: MessageChannelKind
  accountId: string
  chatGuid: string
}

interface CursorStoreFile {
  version: 1
  cursors: MessageChannelCursor[]
}

export interface MessageChannelCursorStoreOptions {
  storagePath: string
  now?: () => Date
}

export class MessageChannelCursorStore {
  private readonly storagePath: string
  private readonly now: () => Date
  private loaded = false
  private cursors = new Map<string, MessageChannelCursor>()

  constructor(options: MessageChannelCursorStoreOptions) {
    this.storagePath = options.storagePath
    this.now = options.now ?? (() => new Date())
  }

  list(): MessageChannelCursor[] {
    this.ensureLoaded()
    return [...this.cursors.values()].map((cursor) => ({ ...cursor }))
  }

  get(key: MessageChannelCursorKey): MessageChannelCursor | null {
    this.ensureLoaded()
    const cursor = this.cursors.get(cursorKey(key))
    return cursor ? { ...cursor } : null
  }

  update(key: MessageChannelCursorKey, lastRowId: number): MessageChannelCursor {
    this.ensureLoaded()
    const safeRowId = Number.isFinite(lastRowId) && lastRowId > 0 ? Math.floor(lastRowId) : 0
    const normalized = normalizeCursorKey(key)
    const existing = this.cursors.get(cursorKey(normalized))
    const cursor: MessageChannelCursor = {
      ...normalized,
      lastRowId: Math.max(existing?.lastRowId || 0, safeRowId),
      updatedAt: this.now().toISOString()
    }
    this.cursors.set(cursorKey(cursor), cursor)
    this.persist()
    return { ...cursor }
  }

  clear(key?: MessageChannelCursorKey): void {
    this.ensureLoaded()
    if (key) {
      this.cursors.delete(cursorKey(key))
    } else {
      this.cursors.clear()
    }
    this.persist()
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    if (!existsSync(this.storagePath)) return
    try {
      const raw = JSON.parse(readFileSync(this.storagePath, 'utf8')) as Partial<CursorStoreFile>
      if (!Array.isArray(raw.cursors)) return
      for (const cursor of raw.cursors) {
        const normalized = normalizeStoredCursor(cursor)
        if (!normalized) continue
        this.cursors.set(cursorKey(normalized), normalized)
      }
    } catch {
      this.cursors.clear()
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.storagePath), { recursive: true })
    const payload: CursorStoreFile = {
      version: 1,
      cursors: this.list().sort((a, b) => cursorKey(a).localeCompare(cursorKey(b)))
    }
    writeFileSync(this.storagePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }
}

function normalizeStoredCursor(value: unknown): MessageChannelCursor | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<MessageChannelCursor>
  if (record.channel !== 'imessage') return null
  if (
    typeof record.accountId !== 'string' ||
    typeof record.chatGuid !== 'string' ||
    typeof record.lastRowId !== 'number'
  ) {
    return null
  }
  return {
    ...normalizeCursorKey({
      channel: record.channel,
      accountId: record.accountId,
      chatGuid: record.chatGuid
    }),
    lastRowId: Math.max(0, Math.floor(record.lastRowId)),
    updatedAt: record.updatedAt || new Date(0).toISOString()
  }
}

function normalizeCursorKey(key: MessageChannelCursorKey): MessageChannelCursorKey {
  return {
    channel: key.channel,
    accountId: normalizeChannelKey(key.accountId),
    chatGuid: normalizeChannelKey(key.chatGuid)
  }
}

function cursorKey(key: MessageChannelCursorKey): string {
  const normalized = normalizeCursorKey(key)
  return [normalized.channel, normalized.accountId, normalized.chatGuid].join(':')
}
