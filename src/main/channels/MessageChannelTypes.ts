import type { ProviderId } from '../store/types'

export type MessageChannelKind = 'imessage'
export type MessageChannelMode = 'operator' | 'dm' | 'group'

export interface MessageChannelBinding {
  id: string
  channel: MessageChannelKind
  accountId: string
  chatGuid: string
  allowedHandles: string[]
  appChatId: string
  workspaceId?: string
  provider: ProviderId
  mode: MessageChannelMode
  requireTrigger: boolean
  triggerPrefix?: string
  label?: string
  archived?: boolean
  createdAt: string
  updatedAt: string
}

export interface MessageChannelBindingInput {
  id?: string
  channel: MessageChannelKind
  accountId: string
  chatGuid: string
  allowedHandles: string[]
  appChatId: string
  workspaceId?: string
  provider: ProviderId
  mode?: MessageChannelMode
  requireTrigger?: boolean
  triggerPrefix?: string
  label?: string
  archived?: boolean
}

export interface MessageChannelAttachment {
  id?: string
  filename?: string
  mimeType?: string
  uti?: string
  path?: string
  byteCount?: number
}

export interface InboundMessageChannelEnvelope {
  channel: MessageChannelKind
  accountId: string
  chatGuid: string
  messageGuid: string
  senderHandle: string
  text?: string
  timestamp: string
  isFromMe?: boolean
  attachments?: MessageChannelAttachment[]
}

export interface ChannelInboundMetadata {
  kind: 'channelInbound'
  channel: MessageChannelKind
  accountId: string
  bindingId: string
  chatGuid: string
  messageGuid: string
  senderHandle: string
  attachmentCount: number
  sourceTrust: 'external_untrusted'
  attachments?: MessageChannelAttachment[]
  imagePaths?: string[]
  [key: string]: unknown
}

export interface RoutedMessageChannelTurn {
  binding: MessageChannelBinding
  appChatId: string
  workspaceId?: string
  provider: ProviderId
  prompt: string
  source: InboundMessageChannelEnvelope
  metadata: ChannelInboundMetadata
}

export type MessageChannelRouteRejectReason =
  | 'from-self'
  | 'no-binding'
  | 'binding-archived'
  | 'sender-not-allowed'
  | 'unsupported-mode'
  | 'trigger-required'
  | 'empty-prompt'
  | 'duplicate-message'

export type MessageChannelRouteDecision =
  | { accepted: true; turn: RoutedMessageChannelTurn }
  | { accepted: false; reason: MessageChannelRouteRejectReason; binding?: MessageChannelBinding }

export function normalizeChannelKey(value: string): string {
  return value.trim()
}

export function normalizeChannelHandle(value: string): string {
  return value.trim().toLowerCase()
}

export function defaultTriggerPrefix(prefix?: string): string {
  const trimmed = prefix?.trim()
  return trimmed || 'tw'
}
