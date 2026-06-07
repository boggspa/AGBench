import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import type { MessageChannelKind } from './MessageChannelTypes'

export type MessageChannelAuditKind =
  | 'poll'
  | 'inbound_received'
  | 'inbound_rejected'
  | 'inbound_dispatched'
  | 'inbound_failed'
  | 'outbound_sent'
  | 'outbound_failed'
  | 'binding_upserted'
  | 'binding_archived'
  | 'cursor_cleared'

export interface MessageChannelAuditRecord {
  id: string
  timestamp: string
  kind: MessageChannelAuditKind
  channel: MessageChannelKind
  accountId?: string
  chatGuid?: string
  bindingId?: string
  appChatId?: string
  appRunId?: string
  messageGuid?: string
  senderHandle?: string
  summary: string
  payload?: Record<string, unknown>
}

export interface MessageChannelAuditInput {
  kind: MessageChannelAuditKind
  channel: MessageChannelKind
  accountId?: string
  chatGuid?: string
  bindingId?: string
  appChatId?: string
  appRunId?: string
  messageGuid?: string
  senderHandle?: string
  summary: string
  payload?: Record<string, unknown>
}

export interface MessageChannelAuditStoreOptions {
  storagePath: string
  now?: () => Date
  createId?: () => string
}

export class MessageChannelAuditStore {
  private readonly storagePath: string
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(options: MessageChannelAuditStoreOptions) {
    this.storagePath = options.storagePath
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? (() => randomUUID())
  }

  append(input: MessageChannelAuditInput): MessageChannelAuditRecord {
    const record: MessageChannelAuditRecord = {
      id: this.createId(),
      timestamp: this.now().toISOString(),
      kind: input.kind,
      channel: input.channel,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.chatGuid ? { chatGuid: input.chatGuid } : {}),
      ...(input.bindingId ? { bindingId: input.bindingId } : {}),
      ...(input.appChatId ? { appChatId: input.appChatId } : {}),
      ...(input.appRunId ? { appRunId: input.appRunId } : {}),
      ...(input.messageGuid ? { messageGuid: input.messageGuid } : {}),
      ...(input.senderHandle ? { senderHandle: input.senderHandle } : {}),
      summary: input.summary,
      ...(input.payload ? { payload: input.payload } : {})
    }
    mkdirSync(dirname(this.storagePath), { recursive: true })
    appendFileSync(this.storagePath, `${JSON.stringify(record)}\n`, 'utf8')
    return record
  }

  list(options: { limit?: number } = {}): MessageChannelAuditRecord[] {
    if (!existsSync(this.storagePath)) return []
    const limit =
      Number.isFinite(options.limit) && options.limit! > 0 ? Math.floor(options.limit!) : 200
    const lines = readFileSync(this.storagePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    return lines
      .slice(Math.max(0, lines.length - limit))
      .map((line) => parseRecord(line))
      .filter((record): record is MessageChannelAuditRecord => Boolean(record))
  }
}

function parseRecord(line: string): MessageChannelAuditRecord | null {
  try {
    const record = JSON.parse(line) as Partial<MessageChannelAuditRecord>
    if (
      typeof record.id !== 'string' ||
      typeof record.timestamp !== 'string' ||
      record.channel !== 'imessage' ||
      typeof record.kind !== 'string' ||
      typeof record.summary !== 'string'
    ) {
      return null
    }
    return record as MessageChannelAuditRecord
  } catch {
    return null
  }
}
