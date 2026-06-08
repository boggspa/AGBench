import {
  MESSAGE_CHANNEL_ADAPTERS,
  type InboundMessageChannelEnvelope,
  type MessageChannelAdapterDescriptor,
  type MessageChannelKind
} from './MessageChannelTypes'

export interface MessageChannelAdapterPollParams {
  channel?: MessageChannelKind
  accountId?: string
  chatGuid?: string
  allConversations?: boolean
  afterRowId?: number
  limit?: number
  includeFromMe?: boolean
  latestFirst?: boolean
}

export interface MessageChannelPolledMessage extends InboundMessageChannelEnvelope {
  rowId: number
}

export interface MessageChannelAdapterPollResult {
  ok: boolean
  channel: MessageChannelKind
  accountId: string
  databasePath: string
  messages: MessageChannelPolledMessage[]
}

export interface MessageChannelAdapterSendTextParams {
  channel?: MessageChannelKind
  accountId?: string
  chatGuid?: string
  recipientHandle: string
  text: string
}

export interface MessageChannelAdapterSendAttachmentParams {
  channel?: MessageChannelKind
  accountId?: string
  chatGuid?: string
  recipientHandle: string
  filePath: string
}

export interface MessageChannelAdapterRuntimeStatus extends MessageChannelAdapterDescriptor {
  configured: boolean
  available: boolean
  reason?: string
}

export interface MessageChannelAdapter {
  readonly channel: MessageChannelKind
  readonly label: string
  status(): MessageChannelAdapterRuntimeStatus
  poll(params: MessageChannelAdapterPollParams): Promise<MessageChannelAdapterPollResult>
  sendText?(params: MessageChannelAdapterSendTextParams): Promise<unknown>
  sendAttachment?(params: MessageChannelAdapterSendAttachmentParams): Promise<unknown>
}

export class MessageChannelAdapterRegistry {
  private readonly adapters = new Map<MessageChannelKind, MessageChannelAdapter>()
  private readonly descriptors: MessageChannelAdapterDescriptor[]

  constructor(descriptors: MessageChannelAdapterDescriptor[] = MESSAGE_CHANNEL_ADAPTERS) {
    this.descriptors = descriptors
  }

  register(adapter: MessageChannelAdapter): void {
    this.adapters.set(adapter.channel, adapter)
  }

  get(channel: MessageChannelKind): MessageChannelAdapter | null {
    return this.adapters.get(channel) || null
  }

  listStatuses(): MessageChannelAdapterRuntimeStatus[] {
    return this.descriptors.map((descriptor) => {
      const adapter = this.adapters.get(descriptor.channel)
      if (adapter) return adapter.status()
      return {
        ...descriptor,
        configured: false,
        available: false,
        reason:
          descriptor.status === 'active'
            ? `${descriptor.label} is not configured.`
            : `${descriptor.label} is planned but not implemented yet.`
      }
    })
  }

  async poll(
    channel: MessageChannelKind,
    params: MessageChannelAdapterPollParams
  ): Promise<MessageChannelAdapterPollResult> {
    const adapter = this.requireAdapter(channel)
    return adapter.poll({ ...params, channel })
  }

  async sendText(params: MessageChannelAdapterSendTextParams): Promise<unknown> {
    const adapter = this.requireAdapter(params.channel || 'imessage')
    if (!adapter.sendText) {
      throw new Error(`${adapter.label} does not support outbound text.`)
    }
    return adapter.sendText(params)
  }

  async sendAttachment(params: MessageChannelAdapterSendAttachmentParams): Promise<unknown> {
    const adapter = this.requireAdapter(params.channel || 'imessage')
    if (!adapter.sendAttachment) {
      throw new Error(`${adapter.label} does not support outbound files.`)
    }
    return adapter.sendAttachment(params)
  }

  private requireAdapter(channel: MessageChannelKind): MessageChannelAdapter {
    const adapter = this.adapters.get(channel)
    if (!adapter) {
      throw new Error(`No configured channel adapter for ${channel}.`)
    }
    return adapter
  }
}
