import type { MessageChannelBindingStore } from './MessageChannelBindingStore'
import type {
  InboundMessageChannelEnvelope,
  MessageChannelBinding,
  MessageChannelRouteDecision
} from './MessageChannelTypes'
import {
  defaultTriggerPrefix,
  normalizeChannelHandle,
  normalizeChannelKey
} from './MessageChannelTypes'

export interface MessageChannelRouterOptions {
  bindingStore: Pick<MessageChannelBindingStore, 'findByConversation'>
}

export class MessageChannelRouter {
  private readonly bindingStore: Pick<MessageChannelBindingStore, 'findByConversation'>
  private readonly seenMessageGuids = new Set<string>()

  constructor(options: MessageChannelRouterOptions) {
    this.bindingStore = options.bindingStore
  }

  routeInbound(envelope: InboundMessageChannelEnvelope): MessageChannelRouteDecision {
    const messageKey = messageDedupeKey(envelope)
    if (this.seenMessageGuids.has(messageKey)) {
      return { accepted: false, reason: 'duplicate-message' }
    }

    const bindings = this.bindingStore.findByConversation({
      channel: envelope.channel,
      accountId: normalizeChannelKey(envelope.accountId),
      chatGuid: normalizeChannelKey(envelope.chatGuid),
      includeArchived: true
    })
    if (bindings.length === 0) {
      return { accepted: false, reason: 'no-binding' }
    }

    const senderHandle = normalizeChannelHandle(envelope.senderHandle)
    const allowedBindings = bindings.filter(
      (candidate) =>
        isSenderAllowed(candidate, senderHandle) ||
        isSelfSyncedOperatorMessage(envelope, candidate, senderHandle)
    )
    const binding = allowedBindings.find((candidate) => !candidate.archived)
    if (!binding) {
      const archivedBinding = allowedBindings.find((candidate) => candidate.archived)
      if (archivedBinding) {
        return { accepted: false, reason: 'binding-archived', binding: archivedBinding }
      }
      return { accepted: false, reason: 'sender-not-allowed', binding: bindings[0] }
    }
    if (binding.mode !== 'operator') {
      return { accepted: false, reason: 'unsupported-mode', binding }
    }

    const prompt = extractPrompt(envelope.text || '', binding)
    if (
      envelope.isFromMe &&
      !isSelfSyncedOperatorMessage(envelope, binding, senderHandle, prompt)
    ) {
      return { accepted: false, reason: 'from-self', binding }
    }
    if (prompt === null) {
      return { accepted: false, reason: 'trigger-required', binding }
    }
    if (!prompt.trim()) {
      return { accepted: false, reason: 'empty-prompt', binding }
    }

    this.seenMessageGuids.add(messageKey)
    const attachments = normalizeAttachments(envelope.attachments)
    const imagePaths = imageAttachmentPaths(attachments)
    return {
      accepted: true,
      turn: {
        binding,
        appChatId: binding.appChatId,
        workspaceId: binding.workspaceId,
        provider: binding.provider,
        prompt: prompt.trim(),
        source: envelope,
        metadata: {
          kind: 'channelInbound',
          channel: envelope.channel,
          accountId: binding.accountId,
          bindingId: binding.id,
          chatGuid: binding.chatGuid,
          messageGuid: envelope.messageGuid,
          senderHandle: envelope.senderHandle,
          attachmentCount: attachments.length,
          sourceTrust: 'external_untrusted',
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(imagePaths.length > 0 ? { imagePaths } : {})
        }
      }
    }
  }

  forgetMessage(envelope: InboundMessageChannelEnvelope): void {
    this.seenMessageGuids.delete(messageDedupeKey(envelope))
  }
}

function isSenderAllowed(binding: MessageChannelBinding, senderHandle: string): boolean {
  return binding.allowedHandles.includes(senderHandle)
}

function isSelfSyncedOperatorMessage(
  envelope: InboundMessageChannelEnvelope,
  binding: MessageChannelBinding,
  senderHandle: string,
  prompt: string | null = extractPrompt(envelope.text || '', binding)
): boolean {
  if (!envelope.isFromMe || binding.mode !== 'operator' || binding.allowedHandles.length !== 1) {
    return false
  }
  if (senderHandle && !isSenderAllowed(binding, senderHandle)) return false
  return prompt !== null
}

function extractPrompt(text: string, binding: MessageChannelBinding): string | null {
  const trimmed = text.trim()
  const trigger = defaultTriggerPrefix(binding.triggerPrefix).toLowerCase()
  const lower = trimmed.toLowerCase()
  if (lower === trigger) return ''
  if (lower.startsWith(`${trigger} `)) return trimmed.slice(trigger.length + 1)
  if (lower.startsWith(`${trigger}:`)) return trimmed.slice(trigger.length + 1)
  return null
}

function messageDedupeKey(envelope: InboundMessageChannelEnvelope): string {
  return [
    envelope.channel,
    normalizeChannelKey(envelope.accountId),
    normalizeChannelKey(envelope.chatGuid),
    normalizeChannelKey(envelope.messageGuid)
  ].join(':')
}

function normalizeAttachments(
  attachments: InboundMessageChannelEnvelope['attachments']
): NonNullable<InboundMessageChannelEnvelope['attachments']> {
  if (!Array.isArray(attachments)) return []
  return attachments
    .map((attachment) => {
      const rawFilename =
        typeof attachment.filename === 'string' && attachment.filename.trim()
          ? attachment.filename.trim()
          : undefined
      const path =
        typeof attachment.path === 'string' && attachment.path.trim()
          ? attachment.path.trim()
          : rawFilename?.startsWith('/')
            ? rawFilename
            : undefined
      const filename = rawFilename?.startsWith('/') ? lastPathComponent(rawFilename) : rawFilename
      return {
        ...(typeof attachment.id === 'string' && attachment.id ? { id: attachment.id } : {}),
        ...(filename ? { filename } : {}),
        ...(typeof attachment.mimeType === 'string' && attachment.mimeType
          ? { mimeType: attachment.mimeType }
          : {}),
        ...(typeof attachment.uti === 'string' && attachment.uti ? { uti: attachment.uti } : {}),
        ...(path ? { path } : {}),
        ...(typeof attachment.byteCount === 'number' && Number.isFinite(attachment.byteCount)
          ? { byteCount: attachment.byteCount }
          : {})
      }
    })
    .filter((attachment) => Boolean(attachment.id || attachment.filename || attachment.path))
}

function imageAttachmentPaths(
  attachments: NonNullable<InboundMessageChannelEnvelope['attachments']>
): string[] {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const attachment of attachments) {
    if (!attachment.path || !isImageAttachment(attachment)) continue
    if (seen.has(attachment.path)) continue
    seen.add(attachment.path)
    paths.push(attachment.path)
  }
  return paths
}

function isImageAttachment(
  attachment: NonNullable<InboundMessageChannelEnvelope['attachments']>[number]
): boolean {
  const mime = attachment.mimeType?.toLowerCase() || ''
  if (mime.startsWith('image/')) return true
  const uti = attachment.uti?.toLowerCase() || ''
  if (uti === 'public.image' || (uti.startsWith('public.') && uti.includes('image'))) return true
  const candidate = `${attachment.filename || ''} ${attachment.path || ''}`.toLowerCase()
  return /\.(png|jpe?g|gif|heic|heif|webp|tiff?|bmp)$/i.test(candidate)
}

function lastPathComponent(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() || value
}
