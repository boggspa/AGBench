import type { MessageChannelBinding } from '../../../main/channels/MessageChannelTypes'
import type { MessageChannelAuditRecord } from '../../../main/channels/MessageChannelAuditStore'
import type { MessagesBridgeInboundMessage } from '../../../main/channels/MessageChannelGatewayService'

export type MessagesBridgeStatus = {
  ok: boolean
  platform: string
  databasePath?: string
  databaseExists?: boolean
  databaseReadable?: boolean
  pollSupported: boolean
  sendTextSupported: boolean
  sendAttachmentSupported?: boolean
  automationRequiresUserConsent?: boolean
  reason?: string
  note?: string
  [key: string]: unknown
}

export type MessagesBridgePollDiagnosticSummary = {
  polled: number
  accepted: number
  dispatched: number
  commands: number
  rejected: Record<string, number>
}

export function messagesBridgePanelErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (
    /No IPC schema registered for messages-bridge:/.test(message) ||
    /No IPC schema registered for message-channels:/.test(message)
  ) {
    return 'Channel gateway IPC is not loaded in the running TaskWraith process. Restart TaskWraith, then reopen Settings -> Channels.'
  }
  return message
}

export function isMessagesBridgeMacPlatform(platform: string | undefined): boolean {
  return platform === undefined || platform === '' || platform === 'darwin' || platform === 'macos'
}

export function messagesBridgeDatabaseBlocker(status: MessagesBridgeStatus | null): string | null {
  if (!status) return 'Refresh bridge status before scanning conversations.'
  if (!isMessagesBridgeMacPlatform(status.platform)) return 'The iMessage local adapter is macOS-only.'
  if (!status.pollSupported) {
    return status.reason || 'Messages database polling is unavailable.'
  }
  if (!status.databaseReadable) {
    return 'Grant Full Disk Access, restart TaskWraith if needed, then recheck.'
  }
  return null
}

export function messageBridgeSendBlocker(
  status: MessagesBridgeStatus | null,
  binding: MessageChannelBinding | null
): string | null {
  if (!binding) return 'Save an operator link first.'
  if (binding.channel !== 'imessage') return null
  const databaseBlocker = messagesBridgeDatabaseBlocker(status)
  if (databaseBlocker) return databaseBlocker
  if (!status?.sendTextSupported) {
    return status?.reason || 'Messages.app text sending is unavailable for the iMessage adapter.'
  }
  return null
}

export function messageBridgeBindingPollBlocker(
  status: MessagesBridgeStatus | null,
  binding: MessageChannelBinding | null
): string | null {
  if (!binding) return 'Save an operator link first.'
  if (binding.channel !== 'imessage') return null
  return messagesBridgeDatabaseBlocker(status)
}

export function messageBridgePollOnceBlocker(
  status: MessagesBridgeStatus | null,
  activeBindingCount: number
): string | null {
  if (activeBindingCount <= 0) return 'Save an operator link first.'
  return messagesBridgeDatabaseBlocker(status)
}

export function messagesBridgePollDiagnostic(
  summary: MessagesBridgePollDiagnosticSummary | null | undefined,
  triggerPrefix: string = 'tw'
): string | null {
  if (!summary) return null
  const command = `${triggerPrefix.trim() || 'tw'} status`
  if (summary.polled <= 0) {
    return `No new channel rows were found. Send "${command}" to the TaskWraith contact, then poll again; if you already sent it, reset the cursor.`
  }
  if (summary.commands > 0) {
    return 'TaskWraith handled a channel command. If the reply is not visible yet, refresh the audit and check the adapter delivery status.'
  }
  if (summary.dispatched > 0) {
    return 'TaskWraith dispatched the channel prompt to the selected provider.'
  }

  const rejected = summary.rejected || {}
  const firstReason = rejectionPriority.find((reason) => (rejected[reason] || 0) > 0)
  if (!firstReason) return null

  switch (firstReason) {
    case 'trigger-required':
      return `A message was found, but it did not start with the trigger. Send exactly "${command}".`
    case 'empty-prompt':
      return `The trigger was present with no command. Send "${command}".`
    case 'sender-not-allowed':
      return 'A message was found from a different sender handle. Check the Allowed handles field for this TaskWraith contact link.'
    case 'from-self':
      return 'Messages reported the row as sent from this Mac. Send from your iPhone, or use a dedicated TaskWraith Apple Account signed into Messages.app.'
    case 'outbound-echo':
      return `Only TaskWraith's own outgoing message was seen. Send "${command}" from your iPhone and poll again.`
    case 'rate-limited':
      return 'Channel input was rate-limited before it reached a provider run. Wait briefly or raise the local gateway limit in development settings.'
    case 'duplicate-message':
      return `That message was already handled. Send a new "${command}" or reset the cursor before polling.`
    case 'no-binding':
      return 'No saved TaskWraith contact link matched this conversation. Save the channel binding again.'
    case 'binding-archived':
      return 'The matching TaskWraith contact link is archived. Restore or recreate the link before polling.'
    case 'unsupported-mode':
      return 'This bridge MVP only supports operator-channel links. Recreate the link as an operator channel.'
    case 'no-chat':
      return 'The linked TaskWraith chat is missing. Create/select an operator channel and save the link again.'
    case 'dispatch-failed':
      return 'The provider run failed to start. Check the selected provider/runtime, then poll again after fixing it.'
    case 'dispatch-not-started':
      return 'The provider did not start a run. Check the selected provider/runtime, then poll again.'
    default:
      return `Channel rows were rejected: ${Object.entries(rejected)
        .filter(([, count]) => count > 0)
        .map(([reason, count]) => `${reason} ${count}`)
        .join(', ')}.`
  }
}

export function messagesBridgePollObservation(
  summary: MessagesBridgePollDiagnosticSummary | null | undefined
): string {
  if (!summary) return 'No TaskWraith poll has run in this panel yet.'
  const rejectedCount = Object.values(summary.rejected || {}).reduce((total, count) => {
    return total + (Number.isFinite(count) ? Math.max(0, count) : 0)
  }, 0)
  return [
    `${summary.polled} channel row${summary.polled === 1 ? '' : 's'} scanned`,
    `${summary.accepted} accepted`,
    `${summary.commands} command${summary.commands === 1 ? '' : 's'} handled`,
    `${summary.dispatched} provider run${summary.dispatched === 1 ? '' : 's'} dispatched`,
    `${rejectedCount} rejected`
  ].join(', ')
}

export function messagesBridgeStatusCommandState(
  summary: MessagesBridgePollDiagnosticSummary | null | undefined,
  hasHandledStatusCommand: boolean,
  hasSentStatusReply: boolean
): string {
  if (hasSentStatusReply) return 'Reply sent through Messages.app.'
  if (hasHandledStatusCommand) return 'Status command accepted by TaskWraith.'
  if (summary?.commands) return 'Command accepted; waiting for reply audit.'
  if (summary?.accepted) return 'Message accepted; command parser did not see status yet.'
  if (summary?.polled) return 'Channel rows were seen but not accepted. Read the diagnostic below.'
  return 'Waiting for TaskWraith to see a new channel row.'
}

export function messagesBridgePeekRowPreview(row: MessagesBridgeInboundMessage): string {
  const text = row.text?.replace(/\s+/g, ' ').trim()
  if (text) return text.length > 90 ? `${text.slice(0, 87)}...` : text
  const attachmentCount = Array.isArray(row.attachments) ? row.attachments.length : 0
  if (attachmentCount > 0) {
    return `${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`
  }
  return 'No text'
}

export function messagesBridgePeekRowStatus(
  row: MessagesBridgeInboundMessage,
  binding: MessageChannelBinding,
  statusCommandText: string
): string {
  if (row.isFromMe) {
    return 'Outgoing or self-synced row; TaskWraith waits for an operator-sent row.'
  }
  const senderAllowed = binding.allowedHandles.some((handle) => sameBridgeHandle(handle, row.senderHandle))
  if (!senderAllowed) {
    return 'Sender does not match the saved allowed handle.'
  }
  const text = row.text?.trim().toLowerCase() || ''
  const expected = statusCommandText.trim().toLowerCase()
  if (text === expected) return 'Allowed sender + status command text.'
  const prefix = (binding.triggerPrefix || 'tw').trim().toLowerCase()
  if (prefix && text.startsWith(`${prefix} `)) return 'Allowed sender + trigger text.'
  return `Allowed sender, but text is not "${statusCommandText}".`
}

export function messagesBridgeAuditRecordMatchesBinding(
  record: MessageChannelAuditRecord,
  binding: MessageChannelBinding | null
): boolean {
  if (!binding) return false
  if (record.bindingId && record.bindingId !== binding.id) return false
  if (record.accountId && record.accountId !== binding.accountId) return false
  if (record.chatGuid && record.chatGuid !== binding.chatGuid) return false
  if (
    record.senderHandle &&
    !binding.allowedHandles.some((handle) => sameBridgeHandle(handle, record.senderHandle || ''))
  ) {
    return false
  }
  return Boolean(record.bindingId || record.accountId || record.chatGuid)
}

function sameBridgeHandle(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

const rejectionPriority = [
  'trigger-required',
  'empty-prompt',
  'sender-not-allowed',
  'from-self',
  'outbound-echo',
  'rate-limited',
  'duplicate-message',
  'no-binding',
  'binding-archived',
  'unsupported-mode',
  'no-chat',
  'dispatch-failed',
  'dispatch-not-started'
]
