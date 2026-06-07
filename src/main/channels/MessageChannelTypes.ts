import type { ProviderId } from '../store/types'

export type MessageChannelKind =
  | 'imessage'
  | 'telegram'
  | 'signal'
  | 'matrix'
  | 'discord'
  | 'slack'
  | 'email'
  | 'web'
export type MessageChannelMode = 'operator' | 'dm' | 'group'
export type MessageChannelAdapterStatus = 'active' | 'planned'
export type MessageChannelAuthState = 'allowlisted_contact' | 'unmatched_contact' | 'blocked_contact'
export type MessageChannelRouteTarget =
  | 'existing_chat'
  | 'new_provider_thread'
  | 'ensemble'
  | 'approval_status'
  | 'status_endpoint'

export const ACTIVE_MESSAGE_CHANNEL_KINDS = ['imessage'] as const
export const MESSAGE_CHANNEL_KIND_LABELS: Record<MessageChannelKind, string> = {
  imessage: 'iMessage',
  telegram: 'Telegram',
  signal: 'Signal',
  matrix: 'Matrix',
  discord: 'Discord',
  slack: 'Slack',
  email: 'Email',
  web: 'Local web chat'
}

export interface MessageChannelAdapterDescriptor {
  channel: MessageChannelKind
  label: string
  status: MessageChannelAdapterStatus
  transport: 'local' | 'byo_token' | 'self_hosted'
  summary: string
  capabilities: {
    polling: boolean
    outboundText: boolean
    outboundFiles: boolean
    richActions: boolean
  }
}

export const MESSAGE_CHANNEL_ADAPTERS: MessageChannelAdapterDescriptor[] = [
  {
    channel: 'imessage',
    label: 'iMessage local experimental',
    status: 'active',
    transport: 'local',
    summary: 'macOS Messages.app bridge using local database polling and AppleScript sends.',
    capabilities: {
      polling: true,
      outboundText: true,
      outboundFiles: true,
      richActions: false
    }
  },
  {
    channel: 'telegram',
    label: 'Telegram bot',
    status: 'planned',
    transport: 'byo_token',
    summary: 'Bot API long polling with a user-provided token; no TaskWraith-hosted relay.',
    capabilities: {
      polling: true,
      outboundText: true,
      outboundFiles: true,
      richActions: true
    }
  },
  {
    channel: 'matrix',
    label: 'Matrix',
    status: 'planned',
    transport: 'self_hosted',
    summary: 'Self-hosted or BYO homeserver adapter for durable room-based agent control.',
    capabilities: {
      polling: true,
      outboundText: true,
      outboundFiles: true,
      richActions: false
    }
  },
  {
    channel: 'signal',
    label: 'Signal CLI',
    status: 'planned',
    transport: 'local',
    summary: 'Local signal-cli adapter for users who already run Signal automation.',
    capabilities: {
      polling: true,
      outboundText: true,
      outboundFiles: true,
      richActions: false
    }
  },
  {
    channel: 'email',
    label: 'Email',
    status: 'planned',
    transport: 'byo_token',
    summary: 'BYO IMAP/SMTP mailbox for low-cost remote prompts and approvals.',
    capabilities: {
      polling: true,
      outboundText: true,
      outboundFiles: true,
      richActions: false
    }
  },
  {
    channel: 'web',
    label: 'Local web chat',
    status: 'planned',
    transport: 'self_hosted',
    summary: 'Local/PWA channel suitable for Tailscale or an optional user-managed tunnel.',
    capabilities: {
      polling: false,
      outboundText: true,
      outboundFiles: true,
      richActions: true
    }
  },
  {
    channel: 'discord',
    label: 'Discord',
    status: 'planned',
    transport: 'byo_token',
    summary: 'BYO bot token adapter for private Discord control channels.',
    capabilities: {
      polling: true,
      outboundText: true,
      outboundFiles: true,
      richActions: true
    }
  },
  {
    channel: 'slack',
    label: 'Slack',
    status: 'planned',
    transport: 'byo_token',
    summary: 'Workspace app adapter for teams that already have Slack infrastructure.',
    capabilities: {
      polling: true,
      outboundText: true,
      outboundFiles: true,
      richActions: true
    }
  }
]

export type MessageChannelInteractionPrimitiveName =
  | 'approve'
  | 'deny'
  | 'status'
  | 'pause'
  | 'resume'
  | 'show_diff'
  | 'open_thread'
  | 'send_file'
  | 'handoff_provider'

export interface MessageChannelInteractionPrimitive {
  name: MessageChannelInteractionPrimitiveName
  state: 'implemented' | 'planned'
  aliases: string[]
  summary: string
}

export const MESSAGE_CHANNEL_INTERACTION_PRIMITIVES: MessageChannelInteractionPrimitive[] = [
  {
    name: 'approve',
    state: 'implemented',
    aliases: ['approve <code>', 'accept <code>'],
    summary: 'Resolve a pending TaskWraith approval request through the approval ledger.'
  },
  {
    name: 'deny',
    state: 'implemented',
    aliases: ['deny <code>', 'decline <code>', 'reject <code>'],
    summary: 'Decline a pending TaskWraith approval request through the approval ledger.'
  },
  {
    name: 'status',
    state: 'implemented',
    aliases: ['status', 'bridge status', 'channel status'],
    summary: 'Return the current channel binding and provider target state.'
  },
  {
    name: 'pause',
    state: 'implemented',
    aliases: ['pause', 'stop', 'cancel'],
    summary: 'Cancel active runs tied to the bound TaskWraith chat.'
  },
  {
    name: 'resume',
    state: 'planned',
    aliases: ['resume'],
    summary: 'Resume a paused or cancelled channel-routed task once run checkpoints are exposed.'
  },
  {
    name: 'show_diff',
    state: 'planned',
    aliases: ['show diff', 'diff'],
    summary: 'Send a compact file-change summary back through the channel.'
  },
  {
    name: 'open_thread',
    state: 'planned',
    aliases: ['open thread', 'thread'],
    summary: 'Return or open the TaskWraith thread associated with this channel conversation.'
  },
  {
    name: 'send_file',
    state: 'planned',
    aliases: ['send file <path>'],
    summary: 'Attach an allowlisted workspace file after TaskWraith path and policy checks.'
  },
  {
    name: 'handoff_provider',
    state: 'planned',
    aliases: ['handoff to codex', 'handoff to gemini', 'handoff to claude', 'handoff to kimi'],
    summary: 'Route the next channel turn to a specific provider or ensemble participant.'
  }
]

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

export interface CanonicalMessageChannelEvent {
  channel: MessageChannelKind
  conversationId: string
  accountId: string
  chatGuid: string
  messageId: string
  sender: {
    handle: string
    authState: MessageChannelAuthState
  }
  text?: string
  attachments: MessageChannelAttachment[]
  replyTo?: string
  workspaceId?: string
  workspacePath?: string
  appChatId?: string
  routeTarget?: MessageChannelRouteTarget
  provider?: ProviderId
  receivedAt: string
  isFromMe: boolean
}

export interface ChannelInboundMetadata {
  kind: 'channelInbound'
  channel: MessageChannelKind
  accountId: string
  bindingId: string
  chatGuid: string
  messageGuid: string
  senderHandle: string
  authState: MessageChannelAuthState
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

export function isActiveMessageChannelKind(value: MessageChannelKind): boolean {
  return (ACTIVE_MESSAGE_CHANNEL_KINDS as readonly MessageChannelKind[]).includes(value)
}

export function messageChannelConversationId(input: {
  channel: MessageChannelKind
  accountId: string
  chatGuid: string
}): string {
  return [
    input.channel,
    normalizeChannelKey(input.accountId),
    normalizeChannelKey(input.chatGuid)
  ].join(':')
}

export function toCanonicalMessageChannelEvent(
  envelope: InboundMessageChannelEnvelope,
  options: {
    authState: MessageChannelAuthState
    binding?: Pick<
      MessageChannelBinding,
      'appChatId' | 'workspaceId' | 'provider'
    > & { workspacePath?: string }
    routeTarget?: MessageChannelRouteTarget
  }
): CanonicalMessageChannelEvent {
  return {
    channel: envelope.channel,
    conversationId: messageChannelConversationId(envelope),
    accountId: normalizeChannelKey(envelope.accountId),
    chatGuid: normalizeChannelKey(envelope.chatGuid),
    messageId: envelope.messageGuid,
    sender: {
      handle: envelope.senderHandle,
      authState: options.authState
    },
    ...(envelope.text !== undefined ? { text: envelope.text } : {}),
    attachments: Array.isArray(envelope.attachments) ? envelope.attachments : [],
    ...(options.binding?.workspaceId ? { workspaceId: options.binding.workspaceId } : {}),
    ...(options.binding?.workspacePath ? { workspacePath: options.binding.workspacePath } : {}),
    ...(options.binding?.appChatId ? { appChatId: options.binding.appChatId } : {}),
    ...(options.routeTarget ? { routeTarget: options.routeTarget } : {}),
    ...(options.binding?.provider ? { provider: options.binding.provider } : {}),
    receivedAt: envelope.timestamp,
    isFromMe: Boolean(envelope.isFromMe)
  }
}
