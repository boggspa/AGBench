import { describe, expect, it, vi } from 'vitest'
import {
  MessageChannelAdapterRegistry,
  type MessageChannelAdapter,
  type MessageChannelAdapterRuntimeStatus
} from './MessageChannelAdapter'

function status(channel: MessageChannelAdapter['channel']): MessageChannelAdapterRuntimeStatus {
  return {
    channel,
    label: channel,
    status: 'active',
    transport: 'local',
    summary: `${channel} test adapter`,
    capabilities: {
      polling: true,
      outboundText: true,
      outboundFiles: false,
      richActions: false
    },
    configured: true,
    available: true
  }
}

describe('MessageChannelAdapterRegistry', () => {
  it('reports active adapters that are not configured', () => {
    const registry = new MessageChannelAdapterRegistry()

    expect(registry.listStatuses()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'telegram',
          configured: false,
          available: false
        }),
        expect.objectContaining({
          channel: 'web',
          configured: false,
          available: false
        })
      ])
    )
  })

  it('routes poll and outbound text through the registered adapter', async () => {
    const poll = vi.fn(async () => ({
      ok: true,
      channel: 'telegram' as const,
      accountId: 'telegram-bot',
      databasePath: 'telegram:getUpdates',
      messages: []
    }))
    const sendText = vi.fn(async () => ({ ok: true }))
    const registry = new MessageChannelAdapterRegistry()
    registry.register({
      channel: 'telegram',
      label: 'Telegram bot',
      status: () => status('telegram'),
      poll,
      sendText
    })

    await expect(registry.poll('telegram', { limit: 5 })).resolves.toMatchObject({
      channel: 'telegram'
    })
    await expect(
      registry.sendText({
        channel: 'telegram',
        chatGuid: 'telegram:123',
        recipientHandle: 'telegram-user:42',
        text: 'hello'
      })
    ).resolves.toEqual({ ok: true })
    expect(poll).toHaveBeenCalledWith({ channel: 'telegram', limit: 5 })
    expect(sendText).toHaveBeenCalledWith({
      channel: 'telegram',
      chatGuid: 'telegram:123',
      recipientHandle: 'telegram-user:42',
      text: 'hello'
    })
  })
})
