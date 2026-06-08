import { describe, expect, it, vi } from 'vitest'
import { MessageChannelDeliveryService } from './MessageChannelDeliveryService'

function output(appRunId: string, event: object) {
  return {
    channel: 'agent-output' as const,
    provider: 'codex' as const,
    payload: {
      appRunId,
      data: `${JSON.stringify({ ...event, appRunId })}\n`
    },
    publishedAt: '2026-06-06T10:00:00.000Z'
  }
}

function exit(appRunId: string, code: number) {
  return {
    channel: 'agent-exit' as const,
    provider: 'codex' as const,
    payload: {
      appRunId,
      code
    },
    publishedAt: '2026-06-06T10:00:01.000Z'
  }
}

const allowSendTarget = () => true
const operatorTarget = {
  accountId: 'mac-default',
  chatGuid: 'iMessage;-;operator-chat'
}
const operatorSendTarget = {
  channel: 'imessage' as const,
  ...operatorTarget
}
const operatorBindingTarget = {
  ...operatorTarget,
  appChatId: 'chat-1'
}

describe('MessageChannelDeliveryService', () => {
  it('sends accumulated assistant text on successful exit', async () => {
    const sendText = vi.fn(async () => undefined)
    const auditStore = { append: vi.fn((record) => record as never) }
    const service = new MessageChannelDeliveryService({
      sendText,
      auditStore,
      canSendToTarget: allowSendTarget
    })
    service.registerRunTarget({
      appRunId: 'run-1',
      channel: 'imessage',
      bindingId: 'binding-1',
      ...operatorBindingTarget,
      recipientHandle: 'user@example.com'
    })

    service.handle(output('run-1', { type: 'message_delta', delta: { text: 'Hello' } }))
    service.handle(output('run-1', { type: 'message_delta', delta: { text: ' world' } }))
    service.handle(exit('run-1', 0))

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledWith({
        ...operatorSendTarget,
        recipientHandle: 'user@example.com',
        text: 'TaskWraith: Hello world'
      })
    })
    await vi.waitFor(() => {
      expect(auditStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'outbound_sent',
          channel: 'imessage',
          bindingId: 'binding-1',
          ...operatorBindingTarget,
          appRunId: 'run-1'
        })
      )
    })
  })

  it('fails closed when no send-target allowlist checker is configured', () => {
    const sendText = vi.fn(async () => undefined)
    const auditStore = { append: vi.fn((record) => record as never) }
    const service = new MessageChannelDeliveryService({ sendText, auditStore })

    service.registerRunTarget({
      appRunId: 'run-no-checker',
      channel: 'imessage',
      bindingId: 'binding-1',
      ...operatorBindingTarget,
      recipientHandle: 'user@example.com'
    })

    expect(service.size()).toBe(0)
    expect(auditStore.append).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'outbound_failed',
        appRunId: 'run-no-checker',
        ...operatorBindingTarget,
        payload: expect.objectContaining({
          error: 'Recipient is not allowlisted for this channel binding.'
        })
      })
    )
  })

  it('does not register run reply targets for non-allowlisted recipients', () => {
    const sendText = vi.fn(async () => undefined)
    const auditStore = { append: vi.fn((record) => record as never) }
    const service = new MessageChannelDeliveryService({
      sendText,
      auditStore,
      canSendToTarget: () => false
    })

    service.registerRunTarget({
      appRunId: 'run-blocked',
      channel: 'imessage',
      bindingId: 'binding-1',
      ...operatorBindingTarget,
      recipientHandle: 'intruder@example.com'
    })

    expect(service.size()).toBe(0)
    expect(auditStore.append).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'outbound_failed',
        bindingId: 'binding-1',
        ...operatorBindingTarget,
        appRunId: 'run-blocked',
        senderHandle: 'intruder@example.com',
        payload: expect.objectContaining({
          error: 'Recipient is not allowlisted for this channel binding.'
        })
      })
    )
  })

  it('rechecks the send target before sending a completed run reply', async () => {
    let allow = true
    const sendText = vi.fn(async () => undefined)
    const auditStore = { append: vi.fn((record) => record as never) }
    const service = new MessageChannelDeliveryService({
      sendText,
      auditStore,
      canSendToTarget: () => allow
    })
    service.registerRunTarget({
      appRunId: 'run-revoked',
      channel: 'imessage',
      bindingId: 'binding-1',
      ...operatorBindingTarget,
      recipientHandle: 'user@example.com'
    })
    allow = false

    service.handle(output('run-revoked', { type: 'message_delta', delta: { text: 'Done.' } }))
    service.handle(exit('run-revoked', 0))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sendText).not.toHaveBeenCalled()
    expect(auditStore.append).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'outbound_failed',
        bindingId: 'binding-1',
        ...operatorBindingTarget,
        appRunId: 'run-revoked',
        senderHandle: 'user@example.com',
        payload: expect.objectContaining({
          error: 'Recipient is no longer allowlisted for this channel binding.'
        })
      })
    )
  })

  it('sends explicitly registered attachments after a successful run', async () => {
    const sendText = vi.fn(async () => undefined)
    const sendAttachment = vi.fn(async () => undefined)
    const auditStore = { append: vi.fn((record) => record as never) }
    const service = new MessageChannelDeliveryService({
      sendText,
      sendAttachment,
      auditStore,
      canSendToTarget: allowSendTarget
    })
    service.registerRunTarget({
      appRunId: 'run-attachments',
      channel: 'imessage',
      bindingId: 'binding-1',
      ...operatorBindingTarget,
      recipientHandle: 'user@example.com',
      attachmentPaths: ['/tmp/report.pdf', ' /tmp/screenshot.png ', '/tmp/report.pdf']
    })

    service.handle(output('run-attachments', { type: 'message_delta', delta: { text: 'Done.' } }))
    service.handle(exit('run-attachments', 0))

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledWith({
        ...operatorSendTarget,
        recipientHandle: 'user@example.com',
        text: 'TaskWraith: Done.'
      })
      expect(sendAttachment).toHaveBeenCalledTimes(2)
    })
    expect(sendAttachment).toHaveBeenNthCalledWith(1, {
      ...operatorSendTarget,
      recipientHandle: 'user@example.com',
      filePath: '/tmp/report.pdf'
    })
    expect(sendAttachment).toHaveBeenNthCalledWith(2, {
      ...operatorSendTarget,
      recipientHandle: 'user@example.com',
      filePath: '/tmp/screenshot.png'
    })
    expect(auditStore.append).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'outbound_sent',
        ...operatorBindingTarget,
        payload: expect.objectContaining({
          textPreview: 'TaskWraith: Done.',
          attachmentCount: 2,
          attachmentNames: ['report.pdf', 'screenshot.png']
        })
      })
    )
  })

  it('can send explicitly registered attachments without assistant text', async () => {
    const sendText = vi.fn(async () => undefined)
    const sendAttachment = vi.fn(async () => undefined)
    const service = new MessageChannelDeliveryService({
      sendText,
      sendAttachment,
      canSendToTarget: allowSendTarget
    })
    service.registerRunTarget({
      appRunId: 'run-file-only',
      channel: 'imessage',
      bindingId: 'binding-1',
      ...operatorBindingTarget,
      recipientHandle: 'user@example.com',
      attachmentPaths: ['/tmp/report.pdf']
    })

    service.handle(exit('run-file-only', 0))

    await vi.waitFor(() => {
      expect(sendAttachment).toHaveBeenCalledWith({
        ...operatorSendTarget,
        recipientHandle: 'user@example.com',
        filePath: '/tmp/report.pdf'
      })
    })
    expect(sendText).not.toHaveBeenCalled()
  })

  it('sends attachments before text and audits partial attachment delivery on failure', async () => {
    const sendText = vi.fn(async () => undefined)
    const sendAttachment = vi.fn(async ({ filePath }: { filePath: string }) => {
      if (filePath.endsWith('bad.pdf')) {
        throw new Error('Attachment automation denied')
      }
    })
    const auditStore = { append: vi.fn((record) => record as never) }
    const service = new MessageChannelDeliveryService({
      sendText,
      sendAttachment,
      auditStore,
      canSendToTarget: allowSendTarget
    })
    service.registerRunTarget({
      appRunId: 'run-partial-attachment',
      channel: 'imessage',
      bindingId: 'binding-1',
      ...operatorBindingTarget,
      recipientHandle: 'user@example.com',
      attachmentPaths: ['/tmp/ok.pdf', '/tmp/bad.pdf']
    })

    service.handle(
      output('run-partial-attachment', { type: 'message_delta', delta: { text: 'Done.' } })
    )
    service.handle(exit('run-partial-attachment', 0))

    await vi.waitFor(() => {
      expect(sendAttachment).toHaveBeenCalledTimes(2)
      expect(auditStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'outbound_failed',
          appRunId: 'run-partial-attachment',
          ...operatorBindingTarget,
          payload: expect.objectContaining({
            error: 'Attachment automation denied',
            partialDelivery: {
              textSent: false,
              attachmentCountSent: 1
            }
          })
        })
      )
    })
    expect(sendText).not.toHaveBeenCalled()
  })

  it('sends and audits direct command replies', async () => {
    const sendText = vi.fn(async () => undefined)
    const auditStore = { append: vi.fn((record) => record as never) }
    const service = new MessageChannelDeliveryService({
      sendText,
      auditStore,
      canSendToTarget: allowSendTarget
    })

    const result = await service.sendDirectReply({
      channel: 'imessage',
      bindingId: 'binding-1',
      ...operatorBindingTarget,
      recipientHandle: 'user@example.com',
      text: 'iMessage bridge is online.',
      command: 'status'
    })

    expect(result).toEqual({ attempted: true, sent: true })
    expect(sendText).toHaveBeenCalledWith({
      ...operatorSendTarget,
      recipientHandle: 'user@example.com',
      text: 'TaskWraith: iMessage bridge is online.'
    })
    expect(auditStore.append).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'outbound_sent',
        channel: 'imessage',
        bindingId: 'binding-1',
        ...operatorBindingTarget,
        summary: 'Sent iMessage command reply: status.',
        payload: expect.objectContaining({ command: 'status' })
      })
    )
  })

  it('does not duplicate the TaskWraith label on already labeled direct replies', async () => {
    const sendText = vi.fn(async () => undefined)
    const service = new MessageChannelDeliveryService({
      sendText,
      canSendToTarget: allowSendTarget
    })

    const result = await service.sendDirectReply({
      channel: 'imessage',
      bindingId: 'binding-1',
      ...operatorBindingTarget,
      recipientHandle: 'user@example.com',
      text: 'TaskWraith: Already labeled.'
    })

    expect(result).toEqual({ attempted: true, sent: true })
    expect(sendText).toHaveBeenCalledWith({
      ...operatorSendTarget,
      recipientHandle: 'user@example.com',
      text: 'TaskWraith: Already labeled.'
    })
  })

  it('blocks direct replies to non-allowlisted recipients', async () => {
    const sendText = vi.fn(async () => undefined)
    const auditStore = { append: vi.fn((record) => record as never) }
    const service = new MessageChannelDeliveryService({
      sendText,
      auditStore,
      canSendToTarget: () => false
    })

    const result = await service.sendDirectReply({
      channel: 'imessage',
      bindingId: 'binding-1',
      ...operatorBindingTarget,
      recipientHandle: 'intruder@example.com',
      text: 'Blocked.',
      command: 'status'
    })

    expect(result).toEqual({ attempted: false, sent: false, reason: 'not-allowlisted' })
    expect(sendText).not.toHaveBeenCalled()
    expect(auditStore.append).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'outbound_failed',
        ...operatorBindingTarget,
        summary: 'Failed to send iMessage command reply: status.',
        senderHandle: 'intruder@example.com',
        payload: expect.objectContaining({
          command: 'status',
          error: 'Recipient is not allowlisted for this channel binding.'
        })
      })
    )
  })

  it('does not duplicate trailing cumulative assistant messages', async () => {
    const sendText = vi.fn(async () => undefined)
    const service = new MessageChannelDeliveryService({
      sendText,
      canSendToTarget: allowSendTarget
    })
    service.registerRunTarget({
      appRunId: 'run-1',
      channel: 'imessage',
      bindingId: 'binding-1',
      ...operatorBindingTarget,
      recipientHandle: 'user@example.com'
    })

    service.handle(output('run-1', { type: 'message_delta', delta: { text: 'Hello' } }))
    service.handle(output('run-1', { type: 'message_delta', delta: { text: ' world' } }))
    service.handle(output('run-1', { type: 'assistant', content: 'Hello world' }))
    service.handle(exit('run-1', 0))

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledWith({
        ...operatorSendTarget,
        recipientHandle: 'user@example.com',
        text: 'TaskWraith: Hello world'
      })
    })
  })

  it('does not send failed run output', async () => {
    const sendText = vi.fn(async () => undefined)
    const service = new MessageChannelDeliveryService({
      sendText,
      canSendToTarget: allowSendTarget
    })
    service.registerRunTarget({
      appRunId: 'run-1',
      channel: 'imessage',
      bindingId: 'binding-1',
      ...operatorBindingTarget,
      recipientHandle: 'user@example.com'
    })

    service.handle(output('run-1', { type: 'message_delta', delta: { text: 'Partial' } }))
    service.handle(exit('run-1', 1))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sendText).not.toHaveBeenCalled()
  })

  it('audits Messages.app send failures', async () => {
    const sendText = vi.fn(async () => {
      throw new Error('Automation denied')
    })
    const auditStore = { append: vi.fn((record) => record as never) }
    const service = new MessageChannelDeliveryService({
      sendText,
      auditStore,
      canSendToTarget: allowSendTarget
    })
    service.registerRunTarget({
      appRunId: 'run-1',
      channel: 'imessage',
      bindingId: 'binding-1',
      ...operatorBindingTarget,
      recipientHandle: 'user@example.com'
    })

    service.handle(output('run-1', { type: 'message_delta', delta: { text: 'Hello' } }))
    service.handle(exit('run-1', 0))

    await vi.waitFor(() => {
      expect(auditStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'outbound_failed',
          appRunId: 'run-1',
          ...operatorBindingTarget,
          payload: expect.objectContaining({ error: 'Automation denied' })
        })
      )
    })
  })

  it('reports direct reply send failures to callers', async () => {
    const sendText = vi.fn(async () => {
      throw new Error('Automation denied')
    })
    const service = new MessageChannelDeliveryService({
      sendText,
      canSendToTarget: allowSendTarget
    })

    const result = await service.sendDirectReply({
      channel: 'imessage',
      bindingId: 'binding-1',
      ...operatorBindingTarget,
      recipientHandle: 'user@example.com',
      text: 'Status.',
      command: 'status'
    })

    expect(result).toEqual({
      attempted: true,
      sent: false,
      reason: 'send-failed',
      error: 'Automation denied'
    })
  })
})
