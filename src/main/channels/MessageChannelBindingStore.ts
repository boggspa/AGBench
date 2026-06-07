import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import type {
  MessageChannelAdapterDescriptor,
  MessageChannelBinding,
  MessageChannelBindingInput,
  MessageChannelKind
} from './MessageChannelTypes'
import {
  MESSAGE_CHANNEL_ADAPTERS,
  defaultTriggerPrefix,
  isActiveMessageChannelKind,
  normalizeChannelHandle,
  normalizeChannelKey
} from './MessageChannelTypes'

const MESSAGE_CHANNEL_PROVIDERS = new Set(['gemini', 'codex', 'claude', 'kimi', 'grok', 'cursor'])

interface BindingStoreFile {
  version: 1
  bindings: MessageChannelBinding[]
}

export interface MessageChannelBindingStoreOptions {
  storagePath: string
  now?: () => Date
  createId?: () => string
}

export interface MessageChannelConversationLookup {
  channel: MessageChannelKind
  accountId: string
  chatGuid: string
  includeArchived?: boolean
}

export class MessageChannelBindingStore {
  private readonly storagePath: string
  private readonly now: () => Date
  private readonly createId: () => string
  private loaded = false
  private bindings: MessageChannelBinding[] = []

  constructor(options: MessageChannelBindingStoreOptions) {
    this.storagePath = options.storagePath
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? (() => randomUUID())
  }

  list(options: { includeArchived?: boolean } = {}): MessageChannelBinding[] {
    this.ensureLoaded()
    return this.bindings
      .filter((binding) => options.includeArchived || !binding.archived)
      .map((binding) => ({ ...binding, allowedHandles: [...binding.allowedHandles] }))
  }

  get(id: string): MessageChannelBinding | null {
    this.ensureLoaded()
    const binding = this.bindings.find((candidate) => candidate.id === id)
    return binding ? { ...binding, allowedHandles: [...binding.allowedHandles] } : null
  }

  findByConversation(lookup: MessageChannelConversationLookup): MessageChannelBinding[] {
    this.ensureLoaded()
    const accountId = normalizeChannelKey(lookup.accountId)
    const chatGuid = normalizeChannelKey(lookup.chatGuid)
    return this.bindings
      .filter(
        (binding) =>
          binding.channel === lookup.channel &&
          binding.accountId === accountId &&
          binding.chatGuid === chatGuid &&
          (lookup.includeArchived || !binding.archived)
      )
      .map((binding) => ({ ...binding, allowedHandles: [...binding.allowedHandles] }))
  }

  upsert(input: MessageChannelBindingInput): MessageChannelBinding {
    this.ensureLoaded()
    const normalized = this.normalizeInput(input)
    const index = normalized.id
      ? this.bindings.findIndex((binding) => binding.id === normalized.id)
      : -1
    const nowIso = this.now().toISOString()
    const binding: MessageChannelBinding =
      index >= 0
        ? {
            ...this.bindings[index],
            ...normalized,
            id: this.bindings[index].id,
            createdAt: this.bindings[index].createdAt,
            updatedAt: nowIso
          }
        : {
            ...normalized,
            id: normalized.id || this.createId(),
            createdAt: nowIso,
            updatedAt: nowIso
          }

    if (index >= 0) {
      this.bindings[index] = binding
    } else {
      this.bindings.push(binding)
    }
    this.persist()
    return { ...binding, allowedHandles: [...binding.allowedHandles] }
  }

  archive(id: string): MessageChannelBinding | null {
    this.ensureLoaded()
    const index = this.bindings.findIndex((binding) => binding.id === id)
    if (index < 0) return null
    const updated: MessageChannelBinding = {
      ...this.bindings[index],
      archived: true,
      updatedAt: this.now().toISOString()
    }
    this.bindings[index] = updated
    this.persist()
    return { ...updated, allowedHandles: [...updated.allowedHandles] }
  }

  delete(id: string): boolean {
    this.ensureLoaded()
    const next = this.bindings.filter((binding) => binding.id !== id)
    if (next.length === this.bindings.length) return false
    this.bindings = next
    this.persist()
    return true
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    if (!existsSync(this.storagePath)) {
      this.bindings = []
      return
    }
    try {
      const raw = JSON.parse(readFileSync(this.storagePath, 'utf8')) as Partial<BindingStoreFile>
      this.bindings = Array.isArray(raw.bindings)
        ? raw.bindings
            .map((binding) => normalizeStoredBinding(binding))
            .filter((binding): binding is MessageChannelBinding => Boolean(binding))
        : []
    } catch {
      this.bindings = []
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.storagePath), { recursive: true })
    const payload: BindingStoreFile = {
      version: 1,
      bindings: this.bindings
    }
    writeFileSync(this.storagePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }

  private normalizeInput(input: MessageChannelBindingInput): MessageChannelBinding {
    const channel = requireMessageChannelKind(input.channel)
    const accountId = requireNonEmpty(normalizeChannelKey(input.accountId), 'accountId')
    const chatGuid = requireDirectOperatorChatGuid(
      requireNonEmpty(normalizeChannelKey(input.chatGuid), 'chatGuid')
    )
    const appChatId = requireNonEmpty(input.appChatId.trim(), 'appChatId')
    const allowedHandles = normalizeAllowedHandles(input.allowedHandles)
    const provider = requireMessageChannelProvider(input.provider)
    if (input.mode && input.mode !== 'operator') {
      throw new Error('Channel gateway currently supports operator channel bindings only')
    }
    if (input.requireTrigger === false) {
      throw new Error('Channel gateway currently requires trigger-gated bindings')
    }
    return {
      id: input.id?.trim() || '',
      channel,
      accountId,
      chatGuid,
      allowedHandles,
      appChatId,
      ...(input.workspaceId?.trim() ? { workspaceId: input.workspaceId.trim() } : {}),
      provider,
      mode: 'operator',
      requireTrigger: true,
      triggerPrefix: defaultTriggerPrefix(input.triggerPrefix),
      ...(input.label?.trim() ? { label: input.label.trim() } : {}),
      ...(input.archived ? { archived: true } : {}),
      createdAt: '',
      updatedAt: ''
    }
  }
}

function normalizeStoredBinding(value: unknown): MessageChannelBinding | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<MessageChannelBinding>
  if (record.channel !== 'imessage') return null
  if (
    typeof record.id !== 'string' ||
    typeof record.accountId !== 'string' ||
    typeof record.chatGuid !== 'string' ||
    typeof record.appChatId !== 'string' ||
    typeof record.provider !== 'string'
  ) {
    return null
  }
  try {
    const nowIso = new Date(0).toISOString()
    const provider = requireMessageChannelProvider(record.provider)
    if (record.mode && record.mode !== 'operator') return null
    return {
      id: record.id,
      channel: record.channel,
      accountId: requireNonEmpty(normalizeChannelKey(record.accountId), 'accountId'),
      chatGuid: requireDirectOperatorChatGuid(
        requireNonEmpty(normalizeChannelKey(record.chatGuid), 'chatGuid')
      ),
      allowedHandles: normalizeAllowedHandles(record.allowedHandles || []),
      appChatId: requireNonEmpty(record.appChatId.trim(), 'appChatId'),
      ...(record.workspaceId?.trim() ? { workspaceId: record.workspaceId.trim() } : {}),
      provider,
      mode: 'operator',
      requireTrigger: true,
      triggerPrefix: defaultTriggerPrefix(record.triggerPrefix),
      ...(record.label?.trim() ? { label: record.label.trim() } : {}),
      ...(record.archived ? { archived: true } : {}),
      createdAt: record.createdAt || nowIso,
      updatedAt: record.updatedAt || record.createdAt || nowIso
    }
  } catch {
    return null
  }
}

function requireMessageChannelKind(value: unknown): MessageChannelKind {
  const channel = value as MessageChannelKind
  if (typeof value === 'string' && isActiveMessageChannelKind(channel)) {
    return channel
  }
  const planned = MESSAGE_CHANNEL_ADAPTERS.find(
    (adapter: MessageChannelAdapterDescriptor) => adapter.channel === value
  )
  if (planned) {
    throw new Error(`${planned.label} is planned but not enabled in the channel gateway yet`)
  }
  throw new Error('Message channel binding uses an unknown channel adapter')
}

function requireMessageChannelProvider(value: unknown): MessageChannelBinding['provider'] {
  if (typeof value === 'string' && MESSAGE_CHANNEL_PROVIDERS.has(value)) {
    return value as MessageChannelBinding['provider']
  }
  throw new Error('Message channel provider is invalid')
}

function requireDirectOperatorChatGuid(chatGuid: string): string {
  if (/^imessage;\+;/i.test(chatGuid)) {
    throw new Error('iMessage local adapter currently supports one-to-one operator conversations')
  }
  return chatGuid
}

function normalizeAllowedHandles(handles: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of handles) {
    if (typeof raw !== 'string') continue
    if (raw.trim() === '*') {
      throw new Error('allowedHandles must name exact iMessage handles; wildcard is not supported')
    }
    const handle = normalizeChannelHandle(raw)
    if (!handle || seen.has(handle)) continue
    seen.add(handle)
    normalized.push(handle)
  }
  if (normalized.length === 0) {
    throw new Error('allowedHandles must contain at least one handle')
  }
  if (normalized.length > 1) {
    throw new Error('Channel gateway currently supports exactly one operator handle per binding')
  }
  return normalized
}

function requireNonEmpty(value: string, field: string): string {
  if (!value) {
    throw new Error(`${field} is required`)
  }
  return value
}
