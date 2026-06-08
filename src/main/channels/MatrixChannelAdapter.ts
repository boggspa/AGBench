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
    method: 'GET' | 'PUT'
    headers: Record<string, string>
    body?: string
  }
) => Promise<FetchResponseLike>

interface MatrixMessagesResponse {
  chunk?: MatrixRoomEvent[]
}

interface MatrixRoomEvent {
  event_id?: string
  type?: string
  sender?: string
  origin_server_ts?: number
  content?: {
    body?: string
    msgtype?: string
    url?: string
    info?: {
      mimetype?: string
      size?: number
    }
  }
}

export interface MatrixChannelAdapterOptions {
  homeserverUrl: string
  accessToken: string
  accountId?: string
  basePath?: string
  fetchImpl?: FetchLike
  nowIso?: () => string
  createTxnId?: () => string
}

export class MatrixChannelAdapter implements MessageChannelAdapter {
  readonly channel = 'matrix' as const
  readonly label = 'Matrix'
  private readonly homeserverUrl: string
  private readonly accessToken: string
  private readonly accountId: string
  private readonly basePath: string
  private readonly fetchImpl: FetchLike
  private readonly nowIso: () => string
  private readonly createTxnId: () => string

  constructor(options: MatrixChannelAdapterOptions) {
    this.homeserverUrl = options.homeserverUrl.trim().replace(/\/+$/, '')
    this.accessToken = options.accessToken.trim()
    this.accountId =
      options.accountId?.trim() || matrixAccountIdFromHomeserver(this.homeserverUrl)
    this.basePath = options.basePath?.trim() || '/_matrix/client/v3'
    const fetchImpl = options.fetchImpl || (globalThis.fetch as unknown as FetchLike | undefined)
    if (!fetchImpl) {
      throw new Error('Matrix adapter requires fetch support.')
    }
    this.fetchImpl = fetchImpl
    this.nowIso = options.nowIso || (() => new Date().toISOString())
    this.createTxnId =
      options.createTxnId || (() => `taskwraith-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  }

  status(): MessageChannelAdapterRuntimeStatus {
    const configured = Boolean(this.homeserverUrl && this.accessToken)
    return {
      channel: 'matrix',
      label: this.label,
      status: 'active',
      transport: 'self_hosted',
      summary: 'BYO Matrix homeserver access token for room-based agent control.',
      capabilities: {
        polling: true,
        outboundText: true,
        outboundFiles: false,
        richActions: false
      },
      configured,
      available: configured,
      ...(configured
        ? {}
        : {
            reason:
              'Set TASKWRAITH_MATRIX_HOMESERVER_URL and TASKWRAITH_MATRIX_ACCESS_TOKEN to enable Matrix.'
          })
    }
  }

  async poll(params: MessageChannelAdapterPollParams): Promise<MessageChannelAdapterPollResult> {
    this.requireConfigured()
    if (params.accountId && params.accountId !== this.accountId) {
      return this.emptyPollResult()
    }
    const roomId = matrixRoomIdFromGuid(params.chatGuid)
    if (!roomId) {
      return this.emptyPollResult()
    }
    const limit =
      typeof params.limit === 'number' && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(100, Math.floor(params.limit)))
        : 50
    const url = this.clientUrl(
      `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=${limit}`
    )
    const response = await this.request<MatrixMessagesResponse>(url, { method: 'GET' })
    let messages = (Array.isArray(response.chunk) ? response.chunk : [])
      .map((event) => this.eventToPolledMessage(roomId, event))
      .filter((message): message is MessageChannelPolledMessage => Boolean(message))
      .filter((message) => {
        if (typeof params.afterRowId !== 'number' || !Number.isFinite(params.afterRowId)) {
          return true
        }
        return message.rowId > params.afterRowId
      })
      .sort((a, b) => a.rowId - b.rowId)
    if (params.latestFirst) messages = messages.reverse()
    return {
      ok: true,
      channel: 'matrix',
      accountId: this.accountId,
      databasePath: `${this.homeserverUrl}/rooms/${roomId}/messages`,
      messages
    }
  }

  async sendText(params: MessageChannelAdapterSendTextParams): Promise<unknown> {
    this.requireConfigured()
    const roomId = matrixRoomIdFromGuid(params.chatGuid) || matrixRoomIdFromHandle(params.recipientHandle)
    if (!roomId) {
      throw new Error('Matrix room id is required for outbound text.')
    }
    return this.request(
      this.clientUrl(
        `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(
          this.createTxnId()
        )}`
      ),
      {
        method: 'PUT',
        body: {
          msgtype: 'm.text',
          body: params.text
        }
      }
    )
  }

  private requireConfigured(): void {
    if (!this.homeserverUrl || !this.accessToken) {
      throw new Error('Matrix homeserver URL and access token are not configured.')
    }
  }

  private emptyPollResult(): MessageChannelAdapterPollResult {
    return {
      ok: true,
      channel: 'matrix',
      accountId: this.accountId,
      databasePath: `${this.homeserverUrl || 'matrix'}:/rooms`,
      messages: []
    }
  }

  private eventToPolledMessage(
    roomId: string,
    event: MatrixRoomEvent
  ): MessageChannelPolledMessage | null {
    if (!event.event_id || event.type !== 'm.room.message') return null
    const timestamp =
      typeof event.origin_server_ts === 'number' && Number.isFinite(event.origin_server_ts)
        ? event.origin_server_ts
        : Date.parse(this.nowIso())
    if (!Number.isFinite(timestamp)) return null
    const body = typeof event.content?.body === 'string' ? event.content.body : ''
    return {
      rowId: Math.max(0, Math.floor(timestamp)),
      channel: 'matrix',
      accountId: this.accountId,
      chatGuid: matrixRoomGuid(roomId),
      messageGuid: `matrix:${event.event_id}`,
      senderHandle: event.sender || 'matrix-user:unknown',
      text: body,
      timestamp: new Date(timestamp).toISOString(),
      isFromMe: false,
      attachments: matrixAttachments(event)
    }
  }

  private clientUrl(path: string): string {
    return `${this.homeserverUrl}${this.basePath}${path}`
  }

  private async request<T>(
    url: string,
    input: { method: 'GET' | 'PUT'; body?: Record<string, unknown> }
  ): Promise<T> {
    const response = await this.fetchImpl(url, {
      method: input.method,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        ...(input.body ? { 'content-type': 'application/json' } : {})
      },
      ...(input.body ? { body: JSON.stringify(input.body) } : {})
    })
    const json = await response.json()
    if (!response.ok) {
      throw new Error(matrixErrorMessage(json, response.status))
    }
    return json as T
  }
}

export function matrixRoomGuid(roomId: string): string {
  return `matrix:${roomId.trim()}`
}

export function matrixRoomIdFromGuid(chatGuid: string | undefined): string | null {
  const trimmed = chatGuid?.trim()
  if (!trimmed) return null
  return trimmed.startsWith('matrix:') ? trimmed.slice('matrix:'.length) || null : trimmed
}

function matrixRoomIdFromHandle(handle: string): string | null {
  const trimmed = handle.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('matrix-room:')) return trimmed.slice('matrix-room:'.length) || null
  if (trimmed.startsWith('!')) return trimmed
  return null
}

function matrixAccountIdFromHomeserver(homeserverUrl: string): string {
  try {
    return `matrix:${new URL(homeserverUrl).host}`
  } catch {
    return 'matrix'
  }
}

function matrixAttachments(event: MatrixRoomEvent): MessageChannelAttachment[] {
  const content = event.content
  if (!content?.url || content.msgtype === 'm.text') return []
  return [
    {
      id: content.url,
      ...(content.body ? { filename: content.body } : {}),
      ...(content.info?.mimetype ? { mimeType: content.info.mimetype } : {}),
      ...(typeof content.info?.size === 'number' && Number.isFinite(content.info.size)
        ? { byteCount: content.info.size }
        : {})
    }
  ]
}

function matrixErrorMessage(json: unknown, status: number): string {
  if (json && typeof json === 'object') {
    const record = json as Record<string, unknown>
    if (typeof record.error === 'string' && record.error.trim()) return record.error
    if (typeof record.errcode === 'string' && record.errcode.trim()) return record.errcode
  }
  return `Matrix API request failed with HTTP ${status}`
}
