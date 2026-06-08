import type {
  MessageChannelAdapter,
  MessageChannelAdapterPollParams,
  MessageChannelAdapterPollResult,
  MessageChannelAdapterRuntimeStatus,
  MessageChannelAdapterSendAttachmentParams,
  MessageChannelAdapterSendTextParams,
  MessageChannelPolledMessage
} from './MessageChannelAdapter'
import type { MessageChannelAttachment } from './MessageChannelTypes'

export interface LocalWebChannelSubmitInput {
  accountId?: string
  chatGuid: string
  senderHandle: string
  text?: string
  timestamp?: string
  messageGuid?: string
  isFromMe?: boolean
  attachments?: MessageChannelAttachment[]
}

export interface LocalWebChannelOutboundMessage {
  id: string
  accountId: string
  chatGuid?: string
  recipientHandle: string
  text?: string
  attachmentPath?: string
  sentAt: string
}

export interface LocalWebChannelAdapterOptions {
  accountId?: string
  nowIso?: () => string
}

export class LocalWebChannelAdapter implements MessageChannelAdapter {
  readonly channel = 'web' as const
  readonly label = 'Local web chat'
  private readonly accountId: string
  private readonly nowIso: () => string
  private nextRowId = 1
  private nextOutboundId = 1
  private readonly inbound: MessageChannelPolledMessage[] = []
  private readonly outbound: LocalWebChannelOutboundMessage[] = []

  constructor(options: LocalWebChannelAdapterOptions = {}) {
    this.accountId = options.accountId?.trim() || 'local-web'
    this.nowIso = options.nowIso || (() => new Date().toISOString())
  }

  status(): MessageChannelAdapterRuntimeStatus {
    return {
      channel: 'web',
      label: this.label,
      status: 'active',
      transport: 'self_hosted',
      summary: 'In-process local/PWA channel suitable for Tailscale or a user-managed tunnel.',
      capabilities: {
        polling: true,
        outboundText: true,
        outboundFiles: true,
        richActions: true
      },
      configured: true,
      available: true
    }
  }

  submitMessage(input: LocalWebChannelSubmitInput): MessageChannelPolledMessage {
    const chatGuid = input.chatGuid.trim()
    if (!chatGuid) throw new Error('Local web channel chatGuid is required.')
    const senderHandle = input.senderHandle.trim()
    if (!senderHandle) throw new Error('Local web channel senderHandle is required.')
    const rowId = this.nextRowId++
    const message: MessageChannelPolledMessage = {
      rowId,
      channel: 'web',
      accountId: input.accountId?.trim() || this.accountId,
      chatGuid,
      messageGuid: input.messageGuid?.trim() || `web:${rowId}`,
      senderHandle,
      text: input.text || '',
      timestamp: input.timestamp || this.nowIso(),
      isFromMe: Boolean(input.isFromMe),
      attachments: normalizeLocalWebAttachments(input.attachments)
    }
    this.inbound.push(message)
    return clonePolledMessage(message)
  }

  async poll(params: MessageChannelAdapterPollParams): Promise<MessageChannelAdapterPollResult> {
    const accountId = params.accountId?.trim() || this.accountId
    const afterRowId =
      typeof params.afterRowId === 'number' && Number.isFinite(params.afterRowId)
        ? params.afterRowId
        : 0
    let messages = this.inbound
      .filter((message) => message.accountId === accountId)
      .filter((message) => params.allConversations || !params.chatGuid || message.chatGuid === params.chatGuid)
      .filter((message) => message.rowId > afterRowId)
      .sort((a, b) => a.rowId - b.rowId)
    if (params.latestFirst) messages = messages.reverse()
    if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
      messages = messages.slice(0, Math.max(0, Math.trunc(params.limit)))
    }
    return {
      ok: true,
      channel: 'web',
      accountId,
      databasePath: 'local-web:memory',
      messages: messages.map(clonePolledMessage)
    }
  }

  async sendText(params: MessageChannelAdapterSendTextParams): Promise<LocalWebChannelOutboundMessage> {
    return this.recordOutbound({
      accountId: params.accountId?.trim() || this.accountId,
      chatGuid: params.chatGuid?.trim(),
      recipientHandle: params.recipientHandle,
      text: params.text
    })
  }

  async sendAttachment(
    params: MessageChannelAdapterSendAttachmentParams
  ): Promise<LocalWebChannelOutboundMessage> {
    return this.recordOutbound({
      accountId: params.accountId?.trim() || this.accountId,
      chatGuid: params.chatGuid?.trim(),
      recipientHandle: params.recipientHandle,
      attachmentPath: params.filePath
    })
  }

  listOutbound(params: { accountId?: string; chatGuid?: string } = {}): LocalWebChannelOutboundMessage[] {
    return this.outbound
      .filter((message) => !params.accountId || message.accountId === params.accountId)
      .filter((message) => !params.chatGuid || message.chatGuid === params.chatGuid)
      .map(cloneOutboundMessage)
  }

  drainOutbound(params: { accountId?: string; chatGuid?: string } = {}): LocalWebChannelOutboundMessage[] {
    const drained: LocalWebChannelOutboundMessage[] = []
    const kept: LocalWebChannelOutboundMessage[] = []
    for (const message of this.outbound) {
      const matchesAccount = !params.accountId || message.accountId === params.accountId
      const matchesChat = !params.chatGuid || message.chatGuid === params.chatGuid
      if (matchesAccount && matchesChat) drained.push(message)
      else kept.push(message)
    }
    this.outbound.length = 0
    this.outbound.push(...kept)
    return drained.map(cloneOutboundMessage)
  }

  private recordOutbound(input: {
    accountId: string
    chatGuid?: string
    recipientHandle: string
    text?: string
    attachmentPath?: string
  }): LocalWebChannelOutboundMessage {
    const recipientHandle = input.recipientHandle.trim()
    if (!recipientHandle) throw new Error('Local web channel recipientHandle is required.')
    const message: LocalWebChannelOutboundMessage = {
      id: `web-out:${this.nextOutboundId++}`,
      accountId: input.accountId,
      ...(input.chatGuid ? { chatGuid: input.chatGuid } : {}),
      recipientHandle,
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.attachmentPath ? { attachmentPath: input.attachmentPath } : {}),
      sentAt: this.nowIso()
    }
    this.outbound.push(message)
    return cloneOutboundMessage(message)
  }
}

function normalizeLocalWebAttachments(
  attachments: MessageChannelAttachment[] | undefined
): MessageChannelAttachment[] {
  if (!Array.isArray(attachments)) return []
  return attachments
    .map((attachment) => ({
      ...(typeof attachment.id === 'string' && attachment.id.trim()
        ? { id: attachment.id.trim() }
        : {}),
      ...(typeof attachment.filename === 'string' && attachment.filename.trim()
        ? { filename: attachment.filename.trim() }
        : {}),
      ...(typeof attachment.mimeType === 'string' && attachment.mimeType.trim()
        ? { mimeType: attachment.mimeType.trim() }
        : {}),
      ...(typeof attachment.uti === 'string' && attachment.uti.trim()
        ? { uti: attachment.uti.trim() }
        : {}),
      ...(typeof attachment.path === 'string' && attachment.path.trim()
        ? { path: attachment.path.trim() }
        : {}),
      ...(typeof attachment.byteCount === 'number' && Number.isFinite(attachment.byteCount)
        ? { byteCount: attachment.byteCount }
        : {})
    }))
    .filter((attachment) => Boolean(attachment.id || attachment.filename || attachment.path))
}

function clonePolledMessage(message: MessageChannelPolledMessage): MessageChannelPolledMessage {
  return {
    ...message,
    attachments: normalizeLocalWebAttachments(message.attachments)
  }
}

function cloneOutboundMessage(message: LocalWebChannelOutboundMessage): LocalWebChannelOutboundMessage {
  return { ...message }
}
