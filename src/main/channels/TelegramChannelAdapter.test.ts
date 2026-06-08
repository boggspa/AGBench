import { describe, expect, it, vi } from 'vitest'
import { TelegramChannelAdapter, telegramChatGuid, telegramChatIdFromGuid } from './TelegramChannelAdapter'

function okJson(result: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, result })
  }
}

describe('TelegramChannelAdapter', () => {
  it('maps Bot API updates into canonical channel poll messages', async () => {
    const fetchImpl = vi.fn(async () =>
      okJson([
        {
          update_id: 100,
          message: {
            message_id: 7,
            date: 1780840000,
            chat: { id: 123456, type: 'private' },
            from: { id: 42, username: 'operator' },
            text: 'tw status',
            document: {
              file_id: 'file-1',
              file_name: 'notes.txt',
              mime_type: 'text/plain',
              file_size: 12
            }
          }
        }
      ])
    )
    const adapter = new TelegramChannelAdapter({
      botToken: 'token',
      fetchImpl,
      nowIso: () => '2026-06-07T12:00:00.000Z'
    })

    const result = await adapter.poll({ afterRowId: 99, limit: 10 })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.telegram.org/bottoken/getUpdates',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          timeout: 0,
          allowed_updates: ['message', 'edited_message'],
          offset: 100,
          limit: 10
        })
      })
    )
    expect(result).toMatchObject({
      ok: true,
      channel: 'telegram',
      accountId: 'telegram-bot',
      databasePath: 'telegram:getUpdates',
      messages: [
        {
          rowId: 100,
          channel: 'telegram',
          accountId: 'telegram-bot',
          chatGuid: 'telegram:123456',
          messageGuid: 'telegram:100:7',
          senderHandle: 'telegram-user:42',
          text: 'tw status',
          timestamp: '2026-06-07T13:46:40.000Z',
          attachments: [
            {
              id: 'file-1',
              filename: 'notes.txt',
              mimeType: 'text/plain',
              byteCount: 12
            }
          ]
        }
      ]
    })
  })

  it('filters updates to the requested Telegram chat binding', async () => {
    const fetchImpl = vi.fn(async () =>
      okJson([
        {
          update_id: 1,
          message: {
            message_id: 10,
            date: 1780840000,
            chat: { id: 111 },
            from: { id: 1 },
            text: 'tw ignored'
          }
        },
        {
          update_id: 2,
          message: {
            message_id: 11,
            date: 1780840001,
            chat: { id: 222 },
            from: { id: 2 },
            text: 'tw accepted'
          }
        }
      ])
    )
    const adapter = new TelegramChannelAdapter({ botToken: 'token', fetchImpl })

    const result = await adapter.poll({ chatGuid: telegramChatGuid(222) })

    expect(result.messages.map((message) => message.text)).toEqual(['tw accepted'])
  })

  it('sends outbound text through sendMessage using the bound chat id', async () => {
    const fetchImpl = vi.fn(async () => okJson({ message_id: 12 }))
    const adapter = new TelegramChannelAdapter({ botToken: 'token', fetchImpl })

    await adapter.sendText({
      chatGuid: 'telegram:123456',
      recipientHandle: 'telegram-user:42',
      text: 'TaskWraith: ready'
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.telegram.org/bottoken/sendMessage',
      expect.objectContaining({
        body: JSON.stringify({
          chat_id: 123456,
          text: 'TaskWraith: ready'
        })
      })
    )
  })

  it('parses Telegram chat ids from channel GUIDs', () => {
    expect(telegramChatIdFromGuid('telegram:123456')).toBe(123456)
    expect(telegramChatIdFromGuid('telegram:@taskwraith_dev')).toBe('@taskwraith_dev')
    expect(telegramChatIdFromGuid('')).toBeNull()
  })

  it('surfaces Bot API failures without leaking tokens', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, description: 'Unauthorized' })
    }))
    const adapter = new TelegramChannelAdapter({ botToken: 'secret-token', fetchImpl })

    await expect(adapter.poll({})).rejects.toThrow('Unauthorized')
  })
})
