import { describe, expect, it } from 'vitest'
import { LocalWebChannelAdapter } from './LocalWebChannelAdapter'

describe('LocalWebChannelAdapter', () => {
  it('normalizes submitted local web messages into pollable channel rows', async () => {
    const adapter = new LocalWebChannelAdapter({
      nowIso: () => '2026-06-08T10:00:00.000Z'
    })

    const submitted = adapter.submitMessage({
      chatGuid: 'web:operator',
      senderHandle: 'web-user:operator',
      text: 'tw status',
      attachments: [
        {
          filename: ' screenshot.png ',
          mimeType: ' image/png ',
          path: ' /tmp/screenshot.png '
        },
        {}
      ]
    })

    expect(submitted).toMatchObject({
      rowId: 1,
      channel: 'web',
      accountId: 'local-web',
      chatGuid: 'web:operator',
      messageGuid: 'web:1',
      senderHandle: 'web-user:operator',
      text: 'tw status',
      timestamp: '2026-06-08T10:00:00.000Z',
      isFromMe: false,
      attachments: [
        {
          filename: 'screenshot.png',
          mimeType: 'image/png',
          path: '/tmp/screenshot.png'
        }
      ]
    })

    await expect(
      adapter.poll({
        accountId: 'local-web',
        chatGuid: 'web:operator',
        afterRowId: 0
      })
    ).resolves.toMatchObject({
      ok: true,
      channel: 'web',
      accountId: 'local-web',
      databasePath: 'local-web:memory',
      messages: [expect.objectContaining({ rowId: 1, text: 'tw status' })]
    })
  })

  it('supports cursor-style polling and latest-first peeks', async () => {
    const adapter = new LocalWebChannelAdapter()
    adapter.submitMessage({
      chatGuid: 'web:operator',
      senderHandle: 'web-user:operator',
      text: 'tw one'
    })
    adapter.submitMessage({
      chatGuid: 'web:operator',
      senderHandle: 'web-user:operator',
      text: 'tw two'
    })

    await expect(
      adapter.poll({ accountId: 'local-web', chatGuid: 'web:operator', afterRowId: 1 })
    ).resolves.toMatchObject({
      messages: [expect.objectContaining({ rowId: 2, text: 'tw two' })]
    })
    await expect(
      adapter.poll({
        accountId: 'local-web',
        chatGuid: 'web:operator',
        afterRowId: 0,
        latestFirst: true,
        limit: 1
      })
    ).resolves.toMatchObject({
      messages: [expect.objectContaining({ rowId: 2, text: 'tw two' })]
    })
  })

  it('records outbound text and file replies for a local web client to drain', async () => {
    const adapter = new LocalWebChannelAdapter({
      nowIso: () => '2026-06-08T10:05:00.000Z'
    })

    await adapter.sendText({
      channel: 'web',
      accountId: 'local-web',
      chatGuid: 'web:operator',
      recipientHandle: 'web-user:operator',
      text: 'TaskWraith: online'
    })
    await adapter.sendAttachment({
      channel: 'web',
      accountId: 'local-web',
      chatGuid: 'web:operator',
      recipientHandle: 'web-user:operator',
      filePath: '/tmp/report.txt'
    })

    expect(adapter.listOutbound({ chatGuid: 'web:operator' })).toEqual([
      {
        id: 'web-out:1',
        accountId: 'local-web',
        chatGuid: 'web:operator',
        recipientHandle: 'web-user:operator',
        text: 'TaskWraith: online',
        sentAt: '2026-06-08T10:05:00.000Z'
      },
      {
        id: 'web-out:2',
        accountId: 'local-web',
        chatGuid: 'web:operator',
        recipientHandle: 'web-user:operator',
        attachmentPath: '/tmp/report.txt',
        sentAt: '2026-06-08T10:05:00.000Z'
      }
    ])
    expect(adapter.drainOutbound({ chatGuid: 'web:operator' })).toHaveLength(2)
    expect(adapter.listOutbound({ chatGuid: 'web:operator' })).toEqual([])
  })
})
