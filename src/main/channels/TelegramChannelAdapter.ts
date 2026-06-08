import type {
  MessageChannelAdapter,
  MessageChannelAdapterPollParams,
  MessageChannelAdapterPollResult,
  MessageChannelAdapterRuntimeStatus,
  MessageChannelAdapterSendTextParams,
  MessageChannelPolledMessage
} from './MessageChannelAdapter'
import type { MessageChannelAttachment } from './MessageChannelTypes'

type FetchResponseLike = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

type FetchLike = (
  input: string,
  init: {
    method: 'POST'
    headers: Record<string, string>
    body: string
  }
) => Promise<FetchResponseLike>

interface TelegramApiEnvelope<T> {
  ok: boolean
  result?: T
  description?: string
}

interface TelegramUser {
  id?: number
  is_bot?: boolean
  username?: string
  first_name?: string
  last_name?: string
}

interface TelegramChat {
  id?: number | string
  type?: string
  username?: string
  title?: string
}

interface TelegramMediaAttachment {
  file_id?: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

interface TelegramMessage {
  message_id?: number
  date?: number
  chat?: TelegramChat
  from?: TelegramUser
  text?: string
  caption?: string
  document?: {
    file_id?: string
    file_name?: string
    mime_type?: string
    file_size?: number
  }
  photo?: Array<{
    file_id?: string
    file_size?: number
    width?: number
    height?: number
  }>
  audio?: TelegramMediaAttachment
  video?: TelegramMediaAttachment
  voice?: TelegramMediaAttachment
}

interface TelegramUpdate {
  update_id?: number
  message?: TelegramMessage
  edited_message?: TelegramMessage
}

export interface TelegramChannelAdapterOptions {
  botToken: string
  accountId?: string
  baseUrl?: string
  fetchImpl?: FetchLike
  nowIso?: () => string
}

export class TelegramChannelAdapter implements MessageChannelAdapter {
  readonly channel = 'telegram' as const
  readonly label = 'Telegram bot'
  private readonly botToken: string
  private readonly accountId: string
  private readonly baseUrl: string
  private readonly fetchImpl: FetchLike
  private readonly nowIso: () => string

  constructor(options: TelegramChannelAdapterOptions) {
    this.botToken = options.botToken.trim()
    this.accountId = options.accountId?.trim() || 'telegram-bot'
    this.baseUrl = (options.baseUrl || 'https://api.telegram.org').replace(/\/+$/, '')
    const fetchImpl = options.fetchImpl || (globalThis.fetch as unknown as FetchLike | undefined)
    if (!fetchImpl) {
      throw new Error('Telegram adapter requires fetch support.')
    }
    this.fetchImpl = fetchImpl
    this.nowIso = options.nowIso || (() => new Date().toISOString())
  }

  status(): MessageChannelAdapterRuntimeStatus {
    const configured = Boolean(this.botToken)
    return {
      channel: 'telegram',
      label: this.label,
      status: 'active',
      transport: 'byo_token',
      summary: 'Bot API long polling with a user-provided token; no TaskWraith-hosted relay.',
      capabilities: {
        polling: true,
        outboundText: true,
        outboundFiles: false,
        richActions: true
      },
      configured,
      available: configured,
      ...(configured ? {} : { reason: 'Set TASKWRAITH_TELEGRAM_BOT_TOKEN to enable Telegram.' })
    }
  }

  async poll(params: MessageChannelAdapterPollParams): Promise<MessageChannelAdapterPollResult> {
    if (!this.botToken) {
      throw new Error('Telegram bot token is not configured.')
    }
    if (params.accountId && params.accountId !== this.accountId) {
      return this.emptyPollResult()
    }
    const payload: Record<string, unknown> = {
      timeout: 0,
      allowed_updates: ['message', 'edited_message']
    }
    if (typeof params.afterRowId === 'number' && Number.isFinite(params.afterRowId)) {
      payload.offset = Math.max(0, Math.floor(params.afterRowId)) + 1
    }
    if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
      payload.limit = Math.max(1, Math.min(100, Math.floor(params.limit)))
    }

    const updates = await this.request<TelegramUpdate[]>('getUpdates', payload)
    const messages = updates
      .map((update) => this.updateToPolledMessage(update))
      .filter((message): message is MessageChannelPolledMessage => Boolean(message))
      .filter(
        (message) =>
          params.allConversations || !params.chatGuid || message.chatGuid === params.chatGuid
      )
      .sort((a, b) => a.rowId - b.rowId)
    if (params.latestFirst) messages.reverse()
    return {
      ok: true,
      channel: 'telegram',
      accountId: this.accountId,
      databasePath: 'telegram:getUpdates',
      messages
    }
  }

  async sendText(params: MessageChannelAdapterSendTextParams): Promise<unknown> {
    if (!this.botToken) {
      throw new Error('Telegram bot token is not configured.')
    }
    const chatId = telegramChatIdFromGuid(params.chatGuid) || telegramChatIdFromHandle(params.recipientHandle)
    if (!chatId) {
      throw new Error('Telegram chat id is required for outbound text.')
    }
    return this.request('sendMessage', {
      chat_id: chatId,
      text: params.text
    })
  }

  private emptyPollResult(): MessageChannelAdapterPollResult {
    return {
      ok: true,
      channel: 'telegram',
      accountId: this.accountId,
      databasePath: 'telegram:getUpdates',
      messages: []
    }
  }

  private updateToPolledMessage(update: TelegramUpdate): MessageChannelPolledMessage | null {
    if (typeof update.update_id !== 'number') return null
    const message = update.message || update.edited_message
    if (!message || typeof message.message_id !== 'number') return null
    const chatId = message.chat?.id
    if (chatId === undefined || chatId === null || chatId === '') return null
    const text = message.text ?? message.caption ?? ''
    const timestamp =
      typeof message.date === 'number' && Number.isFinite(message.date)
        ? new Date(message.date * 1000).toISOString()
        : this.nowIso()
    return {
      rowId: update.update_id,
      channel: 'telegram',
      accountId: this.accountId,
      chatGuid: telegramChatGuid(chatId),
      messageGuid: `telegram:${update.update_id}:${message.message_id}`,
      senderHandle: telegramSenderHandle(message.from),
      text,
      timestamp,
      isFromMe: Boolean(message.from?.is_bot),
      attachments: telegramAttachments(message)
    }
  }

  private async request<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}/bot${this.botToken}/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    const json = (await response.json()) as TelegramApiEnvelope<T>
    if (!response.ok || !json.ok) {
      throw new Error(
        json.description || `Telegram Bot API ${method} failed with HTTP ${response.status}`
      )
    }
    if (json.result === undefined) {
      throw new Error(`Telegram Bot API ${method} returned no result.`)
    }
    return json.result
  }
}

export function telegramChatGuid(chatId: string | number): string {
  return `telegram:${String(chatId).trim()}`
}

export function telegramChatIdFromGuid(chatGuid: string | undefined): string | number | null {
  const trimmed = chatGuid?.trim()
  if (!trimmed) return null
  const value = trimmed.startsWith('telegram:') ? trimmed.slice('telegram:'.length) : trimmed
  if (!value) return null
  const numeric = Number(value)
  return Number.isInteger(numeric) && String(numeric) === value ? numeric : value
}

function telegramChatIdFromHandle(handle: string): string | number | null {
  const trimmed = handle.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('telegram-chat:')) return trimmed.slice('telegram-chat:'.length)
  return null
}

function telegramSenderHandle(user: TelegramUser | undefined): string {
  if (typeof user?.id === 'number' && Number.isFinite(user.id)) return `telegram-user:${user.id}`
  if (user?.username?.trim()) return `@${user.username.trim()}`
  return 'telegram-user:unknown'
}

function telegramAttachments(message: TelegramMessage): MessageChannelAttachment[] {
  const attachments: MessageChannelAttachment[] = []
  if (message.document?.file_id) {
    attachments.push({
      id: message.document.file_id,
      ...(message.document.file_name ? { filename: message.document.file_name } : {}),
      ...(message.document.mime_type ? { mimeType: message.document.mime_type } : {}),
      ...(typeof message.document.file_size === 'number'
        ? { byteCount: message.document.file_size }
        : {})
    })
  }
  const largestPhoto = Array.isArray(message.photo) ? message.photo.at(-1) : undefined
  if (largestPhoto?.file_id) {
    attachments.push({
      id: largestPhoto.file_id,
      filename: 'telegram-photo',
      mimeType: 'image/jpeg',
      ...(typeof largestPhoto.file_size === 'number' ? { byteCount: largestPhoto.file_size } : {})
    })
  }
  for (const media of [message.audio, message.video, message.voice]) {
    if (!media?.file_id) continue
    attachments.push({
      id: media.file_id,
      ...(media.file_name ? { filename: media.file_name } : {}),
      ...(media.mime_type ? { mimeType: media.mime_type } : {}),
      ...(typeof media.file_size === 'number' ? { byteCount: media.file_size } : {})
    })
  }
  return attachments
}
