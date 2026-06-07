import type { RunEvent, RunEventSink } from '../RunEventBus'
import { extractProviderText } from '../providers/ProviderEventText'
import type { MessageChannelAuditStore } from './MessageChannelAuditStore'
import type { MessageChannelKind } from './MessageChannelTypes'

export interface MessageChannelRunTarget {
  appRunId: string
  channel: MessageChannelKind
  bindingId: string
  accountId: string
  chatGuid: string
  appChatId: string
  recipientHandle: string
  attachmentPaths?: string[]
}

export interface MessageChannelDirectReplyTarget {
  channel: MessageChannelKind
  bindingId: string
  accountId: string
  chatGuid: string
  appChatId: string
  recipientHandle: string
  text: string
  attachmentPaths?: string[]
  appRunId?: string
  command?: string
}

export interface MessageChannelDirectReplyResult {
  attempted: boolean
  sent: boolean
  reason?: 'empty' | 'not-allowlisted' | 'send-failed'
  error?: string
}

export interface MessageChannelSendTextParams {
  accountId?: string
  chatGuid?: string
  recipientHandle: string
  text: string
}

export interface MessageChannelSendAttachmentParams {
  accountId?: string
  chatGuid?: string
  recipientHandle: string
  filePath: string
}

export interface MessageChannelSendTargetCheck {
  channel: MessageChannelKind
  bindingId: string
  accountId: string
  chatGuid: string
  recipientHandle: string
}

export interface MessageChannelDeliveryDeps {
  sendText: (params: MessageChannelSendTextParams) => Promise<unknown>
  sendAttachment?: (params: MessageChannelSendAttachmentParams) => Promise<unknown>
  canSendToTarget?: (target: MessageChannelSendTargetCheck) => boolean
  auditStore?: Pick<MessageChannelAuditStore, 'append'>
  log?: (line: string) => void
}

interface PendingDelivery extends MessageChannelRunTarget {
  content: string
  attachmentPaths: string[]
  sending?: boolean
}

export const TASKWRAITH_MESSAGE_LABEL = 'TaskWraith:'

export function labelTaskWraithOutboundText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (/^TaskWraith:/i.test(trimmed)) return trimmed
  return `${TASKWRAITH_MESSAGE_LABEL} ${trimmed}`
}

export class MessageChannelDeliveryService implements RunEventSink {
  readonly id = 'message-channel-delivery'
  private readonly deps: MessageChannelDeliveryDeps
  private readonly pending = new Map<string, PendingDelivery>()

  constructor(deps: MessageChannelDeliveryDeps) {
    this.deps = deps
  }

  registerRunTarget(target: MessageChannelRunTarget): void {
    if (!target.appRunId || !target.recipientHandle.trim()) return
    const recipientHandle = target.recipientHandle.trim()
    if (
      !this.canSendToTarget({
        channel: target.channel,
        bindingId: target.bindingId,
        accountId: target.accountId,
        chatGuid: target.chatGuid,
        recipientHandle
      })
    ) {
      this.auditFailed({
        channel: target.channel,
        bindingId: target.bindingId,
        accountId: target.accountId,
        chatGuid: target.chatGuid,
        appChatId: target.appChatId,
        recipientHandle,
        text: '',
        attachmentPaths: target.attachmentPaths,
        appRunId: target.appRunId,
        error: new Error('Recipient is not allowlisted for this iMessage binding.')
      })
      return
    }
    this.pending.set(target.appRunId, {
      ...target,
      recipientHandle,
      attachmentPaths: normalizeAttachmentPaths(target.attachmentPaths),
      content: ''
    })
  }

  async sendDirectReply(
    target: MessageChannelDirectReplyTarget
  ): Promise<MessageChannelDirectReplyResult> {
    const recipientHandle = target.recipientHandle.trim()
    const rawText = target.text.trim()
    const text = labelTaskWraithOutboundText(rawText)
    const attachmentPaths = normalizeAttachmentPaths(target.attachmentPaths)
    if (!recipientHandle || (!rawText && attachmentPaths.length === 0)) {
      return { attempted: false, sent: false, reason: 'empty' }
    }
    if (
      !this.canSendToTarget({
        channel: target.channel,
        bindingId: target.bindingId,
        accountId: target.accountId,
        chatGuid: target.chatGuid,
        recipientHandle
      })
    ) {
      this.auditFailed({
        channel: target.channel,
        bindingId: target.bindingId,
        accountId: target.accountId,
        chatGuid: target.chatGuid,
        appChatId: target.appChatId,
        recipientHandle,
        text,
        attachmentPaths,
        appRunId: target.appRunId,
        command: target.command,
        error: new Error('Recipient is not allowlisted for this iMessage binding.')
      })
      return { attempted: false, sent: false, reason: 'not-allowlisted' }
    }
    try {
      await this.sendReplyParts(
        target.accountId,
        target.chatGuid,
        recipientHandle,
        text,
        attachmentPaths
      )
      this.auditSent({
        channel: target.channel,
        bindingId: target.bindingId,
        accountId: target.accountId,
        chatGuid: target.chatGuid,
        appChatId: target.appChatId,
        recipientHandle,
        text,
        attachmentPaths,
        appRunId: target.appRunId,
        command: target.command
      })
      return { attempted: true, sent: true }
    } catch (err) {
      this.auditFailed({
        channel: target.channel,
        bindingId: target.bindingId,
        accountId: target.accountId,
        chatGuid: target.chatGuid,
        appChatId: target.appChatId,
        recipientHandle,
        text,
        attachmentPaths,
        appRunId: target.appRunId,
        command: target.command,
        error: err,
        ...partialSendStatsFromError(err)
      })
      this.deps.log?.(
        `[MessageChannelDelivery] failed to send iMessage direct reply${
          target.command ? ` for command ${target.command}` : ''
        }: ${err instanceof Error ? err.message : String(err)}`
      )
      return {
        attempted: true,
        sent: false,
        reason: 'send-failed',
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  handle(event: RunEvent): void {
    if (event.channel === 'agent-output') {
      this.handleOutput(event.payload)
      return
    }
    if (event.channel === 'agent-exit') {
      void this.handleExit(event.payload)
    }
  }

  size(): number {
    return this.pending.size
  }

  private canSendToTarget(target: MessageChannelSendTargetCheck): boolean {
    return this.deps.canSendToTarget?.(target) === true
  }

  private handleOutput(payload: unknown): void {
    const appRunId = appRunIdFromPayload(payload)
    if (!appRunId) return
    const target = this.pending.get(appRunId)
    if (!target) return

    const providerEvent = providerEventFromOutputPayload(payload)
    const text = extractProviderText(providerEvent)
    if (!text) return
    target.content = appendProviderText(target.content, text, providerEvent)
  }

  private async handleExit(payload: unknown): Promise<void> {
    const appRunId = appRunIdFromPayload(payload)
    if (!appRunId) return
    const target = this.pending.get(appRunId)
    if (!target || target.sending) return
    this.pending.delete(appRunId)

    const code = exitCodeFromPayload(payload)
    const rawText = target.content.trim()
    const text = labelTaskWraithOutboundText(rawText)
    if (code !== 0 || (!rawText && target.attachmentPaths.length === 0)) return
    if (
      !this.canSendToTarget({
        channel: target.channel,
        bindingId: target.bindingId,
        accountId: target.accountId,
        chatGuid: target.chatGuid,
        recipientHandle: target.recipientHandle
      })
    ) {
      this.auditFailed({
        channel: target.channel,
        bindingId: target.bindingId,
        accountId: target.accountId,
        chatGuid: target.chatGuid,
        appChatId: target.appChatId,
        appRunId,
        recipientHandle: target.recipientHandle,
        text,
        attachmentPaths: target.attachmentPaths,
        error: new Error('Recipient is no longer allowlisted for this iMessage binding.')
      })
      return
    }
    target.sending = true
    try {
      await this.sendReplyParts(
        target.accountId,
        target.chatGuid,
        target.recipientHandle,
        text,
        target.attachmentPaths
      )
      this.auditSent({
        channel: target.channel,
        bindingId: target.bindingId,
        accountId: target.accountId,
        chatGuid: target.chatGuid,
        appChatId: target.appChatId,
        appRunId,
        recipientHandle: target.recipientHandle,
        text,
        attachmentPaths: target.attachmentPaths
      })
    } catch (err) {
      this.auditFailed({
        channel: target.channel,
        bindingId: target.bindingId,
        accountId: target.accountId,
        chatGuid: target.chatGuid,
        appChatId: target.appChatId,
        appRunId,
        recipientHandle: target.recipientHandle,
        text,
        attachmentPaths: target.attachmentPaths,
        error: err,
        ...partialSendStatsFromError(err)
      })
      this.deps.log?.(
        `[MessageChannelDelivery] failed to send iMessage reply for run ${appRunId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  }

  private async sendReplyParts(
    accountId: string | undefined,
    chatGuid: string | undefined,
    recipientHandle: string,
    text: string,
    attachmentPaths: string[]
  ): Promise<void> {
    let sentAttachmentCount = 0
    for (const filePath of attachmentPaths) {
      if (!this.deps.sendAttachment) {
        throw new MessageChannelPartialSendError(
          new Error('Messages.app attachment sending is not available.'),
          {
            sentText: false,
            sentAttachmentCount
          }
        )
      }
      try {
        await this.deps.sendAttachment({ accountId, chatGuid, recipientHandle, filePath })
        sentAttachmentCount += 1
      } catch (err) {
        throw new MessageChannelPartialSendError(err, {
          sentText: false,
          sentAttachmentCount
        })
      }
    }
    if (!text) return
    try {
      await this.deps.sendText({ accountId, chatGuid, recipientHandle, text })
    } catch (err) {
      throw new MessageChannelPartialSendError(err, {
        sentText: false,
        sentAttachmentCount
      })
    }
  }

  private auditSent(input: {
    channel: MessageChannelKind
    bindingId: string
    accountId: string
    chatGuid: string
    appChatId: string
    recipientHandle: string
    text: string
    attachmentPaths?: string[]
    appRunId?: string
    command?: string
  }): void {
    const attachmentPaths = normalizeAttachmentPaths(input.attachmentPaths)
    this.deps.auditStore?.append({
      kind: 'outbound_sent',
      channel: input.channel,
      accountId: input.accountId,
      chatGuid: input.chatGuid,
      bindingId: input.bindingId,
      appChatId: input.appChatId,
      ...(input.appRunId ? { appRunId: input.appRunId } : {}),
      senderHandle: input.recipientHandle,
      summary: input.command
        ? `Sent iMessage command reply: ${input.command}.`
        : 'Sent assistant reply through Messages.app.',
      payload: {
        textPreview: preview(input.text),
        ...(attachmentPaths.length
          ? {
              attachmentCount: attachmentPaths.length,
              attachmentNames: attachmentPaths.map(fileNameFromPath)
            }
          : {}),
        ...(input.command ? { command: input.command } : {})
      }
    })
  }

  private auditFailed(input: {
    channel: MessageChannelKind
    bindingId: string
    accountId: string
    chatGuid: string
    appChatId: string
    recipientHandle: string
    text: string
    attachmentPaths?: string[]
    error: unknown
    appRunId?: string
    command?: string
    sentText?: boolean
    sentAttachmentCount?: number
  }): void {
    const attachmentPaths = normalizeAttachmentPaths(input.attachmentPaths)
    this.deps.auditStore?.append({
      kind: 'outbound_failed',
      channel: input.channel,
      accountId: input.accountId,
      chatGuid: input.chatGuid,
      bindingId: input.bindingId,
      appChatId: input.appChatId,
      ...(input.appRunId ? { appRunId: input.appRunId } : {}),
      senderHandle: input.recipientHandle,
      summary: input.command
        ? `Failed to send iMessage command reply: ${input.command}.`
        : 'Failed to send assistant reply through Messages.app.',
      payload: {
        error: input.error instanceof Error ? input.error.message : String(input.error),
        textPreview: preview(input.text),
        ...(attachmentPaths.length
          ? {
              attachmentCount: attachmentPaths.length,
              attachmentNames: attachmentPaths.map(fileNameFromPath)
            }
          : {}),
        ...partialDeliveryPayload(input),
        ...(input.command ? { command: input.command } : {})
      }
    })
  }
}

interface PartialSendStats {
  sentText: boolean
  sentAttachmentCount: number
}

class MessageChannelPartialSendError extends Error {
  readonly stats: PartialSendStats

  constructor(error: unknown, stats: PartialSendStats) {
    super(error instanceof Error ? error.message : String(error))
    this.name = 'MessageChannelPartialSendError'
    this.stats = stats
  }
}

function partialSendStatsFromError(error: unknown): Partial<PartialSendStats> {
  if (error instanceof MessageChannelPartialSendError) {
    return error.stats
  }
  return {}
}

function partialDeliveryPayload(input: {
  sentText?: boolean
  sentAttachmentCount?: number
}): Record<string, unknown> {
  if (!input.sentText && !input.sentAttachmentCount) return {}
  return {
    partialDelivery: {
      textSent: Boolean(input.sentText),
      attachmentCountSent: input.sentAttachmentCount || 0
    }
  }
}

function providerEventFromOutputPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const record = payload as Record<string, unknown>
  if (typeof record.data !== 'string') return payload
  try {
    return JSON.parse(record.data)
  } catch {
    return payload
  }
}

function appRunIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (typeof record.appRunId === 'string' && record.appRunId) return record.appRunId
  const data = record.data
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>
      if (typeof parsed.appRunId === 'string' && parsed.appRunId) return parsed.appRunId
    } catch {
      return null
    }
  }
  return null
}

function exitCodeFromPayload(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  return typeof record.code === 'number' ? record.code : null
}

function appendProviderText(current: string, next: string, event: unknown): string {
  if (!current) return next
  if (next === current) return current
  if (next.startsWith(current)) return `${current}${next.slice(current.length)}`
  if (isCumulativeAssistantEvent(event)) return current
  return `${current}${next}`
}

function isCumulativeAssistantEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false
  const type = (event as Record<string, unknown>).type
  return type === 'assistant' || type === 'message'
}

function preview(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length <= 160 ? collapsed : `${collapsed.slice(0, 157)}...`
}

function normalizeAttachmentPaths(paths: string[] | undefined): string[] {
  if (!Array.isArray(paths)) return []
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of paths) {
    if (typeof raw !== 'string') continue
    const path = raw.trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    normalized.push(path)
  }
  return normalized
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}
