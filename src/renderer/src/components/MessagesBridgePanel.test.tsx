import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MessageChannelAuditRecord } from '../../../main/channels/MessageChannelAuditStore'
import type { MessageChannelBinding } from '../../../main/channels/MessageChannelTypes'
import type { MessagesBridgeInboundMessage } from '../../../main/channels/MessageChannelGatewayService'
import { MessagesBridgePanel } from './MessagesBridgePanel'
import {
  messageBridgeBindingPollBlocker,
  messageBridgePollOnceBlocker,
  messageBridgeSendBlocker,
  messagesBridgeAuditRecordMatchesBinding,
  messagesBridgePollDiagnostic,
  messagesBridgePollObservation,
  messagesBridgePanelErrorMessage,
  messagesBridgePeekRowPreview,
  messagesBridgePeekRowStatus,
  messagesBridgeStatusCommandState,
  messagesBridgeDatabaseBlocker,
  type MessagesBridgeStatus
} from './MessagesBridgePanelLogic'

const readyStatus: MessagesBridgeStatus = {
  ok: true,
  platform: 'darwin',
  databaseExists: true,
  databaseReadable: true,
  pollSupported: true,
  sendTextSupported: true,
  sendAttachmentSupported: true
}

const binding: MessageChannelBinding = {
  id: 'binding-1',
  channel: 'imessage',
  accountId: 'mac-default',
  chatGuid: 'iMessage;-;+15555550100',
  allowedHandles: ['+15555550100'],
  appChatId: 'chat-1',
  provider: 'codex',
  mode: 'operator',
  requireTrigger: true,
  triggerPrefix: 'tw',
  createdAt: '2026-06-06T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z'
}

describe('MessagesBridgePanel setup blockers', () => {
  it('blocks conversation scanning until bridge status proves Messages DB access', () => {
    expect(messagesBridgeDatabaseBlocker(null)).toBe(
      'Refresh bridge status before scanning conversations.'
    )
    expect(messagesBridgeDatabaseBlocker({ ...readyStatus, platform: 'macos' })).toBeNull()
    expect(messagesBridgeDatabaseBlocker({ ...readyStatus, platform: 'win32' })).toBe(
      'The iMessage local adapter is macOS-only.'
    )
    expect(messagesBridgeDatabaseBlocker({ ...readyStatus, pollSupported: false })).toBe(
      'Messages database polling is unavailable.'
    )
    expect(messagesBridgeDatabaseBlocker({ ...readyStatus, databaseReadable: false })).toBe(
      'Grant Full Disk Access, restart TaskWraith if needed, then recheck.'
    )
    expect(messagesBridgeDatabaseBlocker(readyStatus)).toBeNull()
  })

  it('blocks test sends until a binding and readable Messages database are present', () => {
    expect(messageBridgeSendBlocker(readyStatus, null)).toBe('Save an operator link first.')
    expect(messageBridgeSendBlocker({ ...readyStatus, databaseReadable: false }, binding)).toBe(
      'Grant Full Disk Access, restart TaskWraith if needed, then recheck.'
    )
    expect(messageBridgeSendBlocker({ ...readyStatus, sendTextSupported: false }, binding)).toBe(
      'Messages.app text sending is unavailable for the iMessage adapter.'
    )
    expect(messageBridgeSendBlocker(readyStatus, binding)).toBeNull()
  })

  it('blocks polling until a binding and readable Messages database are present', () => {
    expect(messageBridgeBindingPollBlocker(readyStatus, null)).toBe('Save an operator link first.')
    expect(messageBridgePollOnceBlocker(readyStatus, 0)).toBe('Save an operator link first.')
    expect(
      messageBridgeBindingPollBlocker({ ...readyStatus, databaseReadable: false }, binding)
    ).toBe('Grant Full Disk Access, restart TaskWraith if needed, then recheck.')
    expect(messageBridgePollOnceBlocker(readyStatus, 1)).toBeNull()
  })

  it('turns stale Messages IPC schema errors into restart guidance', () => {
    expect(
      messagesBridgePanelErrorMessage(
        new Error(
          "Error invoking remote method 'messages-bridge:status': Error: No IPC schema registered for messages-bridge:status."
        )
      )
    ).toBe(
      'Channel gateway IPC is not loaded in the running TaskWraith process. Restart TaskWraith, then reopen Settings -> Channels.'
    )
  })

  it('warns that group iMessage conversations are outside the operator MVP', () => {
    const html = renderToStaticMarkup(<MessagesBridgePanel />)

    expect(html).toContain('Avoid random human chats and groups.')
  })

  it('renders dedicated bridge identity guidance', () => {
    const html = renderToStaticMarkup(<MessagesBridgePanel />)

    expect(html).toContain('Channels gateway')
    expect(html).toContain('iMessage local experimental')
    expect(html).toContain('Telegram, Matrix, Signal, email, and')
    expect(html).toContain('iMessage local identity')
    expect(html).toContain('This Mac will receive as:')
    expect(html).toContain('Open Messages.app, then choose Settings')
    expect(html).toContain('do not add that address to your primary Apple Account')
    expect(html).toContain('Add this address to Contacts as TaskWraith.')
    expect(html).toContain('TaskWraith cannot spoof another iMessage sender.')
    expect(html).toContain('Open Messages.app')
    expect(html).toContain('Mac Messages identity')
  })

  it('explains that Messages automation is validated by the bridge test send', () => {
    const html = renderToStaticMarkup(<MessagesBridgePanel />)

    expect(html).toContain('Automation permission')
    expect(html).toContain('Save the TaskWraith contact link first')
    expect(html).toContain('then send a test to trigger macOS Messages automation consent')
    expect(html).toContain('Open helper')
    expect(html).toContain('Automation helper')
    expect(html).toContain('Send test')
  })

  it('renders a binding-scoped cursor reset action for setup retries', () => {
    const html = renderToStaticMarkup(<MessagesBridgePanel />)

    expect(html).toContain('Start over')
    expect(html).toContain('Reset cursor')
    expect(html).toContain('Inspect rows')
    expect(html).toContain('reset the cursor and poll again')
  })

  it('renders the first-run wizard with scan disabled before status has loaded', () => {
    const html = renderToStaticMarkup(<MessagesBridgePanel />)

    expect(html).toContain('Refresh bridge status before scanning conversations.')
    expect(html).toContain('disabled')
    expect(html).toContain('Scan')
  })

  it('explains common manual poll outcomes in plain language', () => {
    expect(
      messagesBridgePollDiagnostic({
        polled: 0,
        accepted: 0,
        dispatched: 0,
        commands: 0,
        rejected: {}
      })
    ).toContain('No new Messages rows were found')
    expect(
      messagesBridgePollDiagnostic({
        polled: 1,
        accepted: 0,
        dispatched: 0,
        commands: 0,
        rejected: { 'trigger-required': 1 }
      })
    ).toBe('A message was found, but it did not start with the trigger. Send exactly "tw status".')
    expect(
      messagesBridgePollDiagnostic({
        polled: 1,
        accepted: 0,
        dispatched: 0,
        commands: 0,
        rejected: { 'sender-not-allowed': 1 }
      })
    ).toContain('Allowed handles')
  })

  it('summarizes what the last poll saw for step-five diagnostics', () => {
    expect(messagesBridgePollObservation(null)).toBe(
      'No TaskWraith poll has run in this panel yet.'
    )
    expect(
      messagesBridgePollObservation({
        polled: 1,
        accepted: 1,
        dispatched: 0,
        commands: 1,
        rejected: {}
      })
    ).toBe(
      '1 Messages row scanned, 1 accepted, 1 command handled, 0 provider runs dispatched, 0 rejected'
    )
    expect(
      messagesBridgeStatusCommandState(
        { polled: 1, accepted: 0, dispatched: 0, commands: 0, rejected: { 'from-self': 1 } },
        false,
        false
      )
    ).toBe('Messages rows were seen but not accepted. Read the diagnostic below.')
    expect(messagesBridgeStatusCommandState(null, true, false)).toBe(
      'Status command accepted by TaskWraith.'
    )
    expect(messagesBridgeStatusCommandState(null, true, true)).toBe(
      'Reply sent through Messages.app.'
    )
  })

  it('scopes setup completion audit rows to the active binding', () => {
    const matchingRecord = auditRecord({
      bindingId: binding.id,
      accountId: binding.accountId,
      chatGuid: binding.chatGuid,
      senderHandle: '+15555550100'
    })
    const previousEmailRecord = auditRecord({
      bindingId: 'old-binding',
      accountId: 'old-taskwraith@example.com',
      chatGuid: binding.chatGuid,
      senderHandle: '+15555550100'
    })
    const previousSenderRecord = auditRecord({
      bindingId: binding.id,
      accountId: binding.accountId,
      chatGuid: binding.chatGuid,
      senderHandle: 'old-iphone@example.com'
    })

    expect(messagesBridgeAuditRecordMatchesBinding(matchingRecord, binding)).toBe(true)
    expect(messagesBridgeAuditRecordMatchesBinding(previousEmailRecord, binding)).toBe(false)
    expect(messagesBridgeAuditRecordMatchesBinding(previousSenderRecord, binding)).toBe(false)
    expect(messagesBridgeAuditRecordMatchesBinding(matchingRecord, null)).toBe(false)
  })

  it('classifies inspected raw Messages rows for binding setup diagnosis', () => {
    const allowed = inboundRow({
      senderHandle: '+15555550100',
      text: 'tw status',
      isFromMe: false
    })
    const wrongSender = inboundRow({
      senderHandle: 'boggspa@example.com',
      text: 'tw status',
      isFromMe: false
    })
    const fromMac = inboundRow({
      senderHandle: '+15555550100',
      text: 'tw status',
      isFromMe: true
    })
    const attachmentOnly = inboundRow({
      senderHandle: '+15555550100',
      text: undefined,
      isFromMe: false,
      attachments: [
        {
          id: 'attachment-1',
          filename: 'image.png',
          path: '/tmp/image.png',
          mimeType: 'image/png'
        }
      ]
    })

    expect(messagesBridgePeekRowStatus(allowed, binding, 'tw status')).toBe(
      'Allowed sender + status command text.'
    )
    expect(messagesBridgePeekRowStatus(wrongSender, binding, 'tw status')).toBe(
      'Sender does not match the saved allowed handle.'
    )
    expect(messagesBridgePeekRowStatus(fromMac, binding, 'tw status')).toBe(
      'Outgoing or self-synced row; TaskWraith waits for an operator-sent row.'
    )
    expect(messagesBridgePeekRowPreview(attachmentOnly)).toBe('1 attachment')
  })
})

function auditRecord(partial: Partial<MessageChannelAuditRecord>): MessageChannelAuditRecord {
  return {
    id: 'audit-1',
    timestamp: '2026-06-06T00:00:00.000Z',
    kind: 'outbound_sent',
    channel: 'imessage',
    summary: 'Sent test.',
    ...partial
  }
}

function inboundRow(partial: Partial<MessagesBridgeInboundMessage>): MessagesBridgeInboundMessage {
  return {
    channel: 'imessage',
    accountId: 'mac-default',
    chatGuid: 'iMessage;-;+15555550100',
    messageGuid: 'message-1',
    senderHandle: '+15555550100',
    text: 'tw status',
    timestamp: '2026-06-06T00:00:00.000Z',
    isFromMe: false,
    rowId: 1,
    attachments: [],
    ...partial
  }
}
