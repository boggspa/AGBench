import { describe, expect, it, vi } from 'vitest'
import { MatrixChannelAdapter, matrixRoomGuid, matrixRoomIdFromGuid } from './MatrixChannelAdapter'

function okJson(result: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => result
  }
}

describe('MatrixChannelAdapter', () => {
  it('maps Matrix room messages into canonical channel poll messages', async () => {
    const fetchImpl = vi.fn(async () =>
      okJson({
        chunk: [
          {
            event_id: '$event-1',
            type: 'm.room.message',
            sender: '@operator:example.org',
            origin_server_ts: 1780840000000,
            content: {
              msgtype: 'm.text',
              body: 'tw status'
            }
          },
          {
            event_id: '$file-1',
            type: 'm.room.message',
            sender: '@operator:example.org',
            origin_server_ts: 1780840001000,
            content: {
              msgtype: 'm.file',
              body: 'notes.txt',
              url: 'mxc://example.org/file',
              info: {
                mimetype: 'text/plain',
                size: 12
              }
            }
          },
          {
            event_id: '$topic-1',
            type: 'm.room.topic',
            sender: '@operator:example.org',
            origin_server_ts: 1780840002000,
            content: {
              body: 'ignored'
            }
          }
        ]
      })
    )
    const adapter = new MatrixChannelAdapter({
      homeserverUrl: 'https://matrix.example.org/',
      accessToken: 'token',
      fetchImpl
    })

    const result = await adapter.poll({ chatGuid: 'matrix:!room:example.org', afterRowId: 0, limit: 10 })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://matrix.example.org/_matrix/client/v3/rooms/!room%3Aexample.org/messages?dir=b&limit=10',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          authorization: 'Bearer token'
        })
      })
    )
    expect(result).toMatchObject({
      ok: true,
      channel: 'matrix',
      accountId: 'matrix:matrix.example.org',
      databasePath: 'https://matrix.example.org/rooms/!room:example.org/messages',
      messages: [
        {
          rowId: 1780840000000,
          channel: 'matrix',
          accountId: 'matrix:matrix.example.org',
          chatGuid: 'matrix:!room:example.org',
          messageGuid: 'matrix:$event-1',
          senderHandle: '@operator:example.org',
          text: 'tw status',
          timestamp: '2026-06-07T13:46:40.000Z',
          attachments: []
        },
        {
          rowId: 1780840001000,
          text: 'notes.txt',
          attachments: [
            {
              id: 'mxc://example.org/file',
              filename: 'notes.txt',
              mimeType: 'text/plain',
              byteCount: 12
            }
          ]
        }
      ]
    })
  })

  it('requires a bound room and filters events by the numeric cursor', async () => {
    const fetchImpl = vi.fn(async () =>
      okJson({
        chunk: [
          {
            event_id: '$old',
            type: 'm.room.message',
            sender: '@operator:example.org',
            origin_server_ts: 10,
            content: { msgtype: 'm.text', body: 'old' }
          },
          {
            event_id: '$new',
            type: 'm.room.message',
            sender: '@operator:example.org',
            origin_server_ts: 20,
            content: { msgtype: 'm.text', body: 'new' }
          }
        ]
      })
    )
    const adapter = new MatrixChannelAdapter({
      homeserverUrl: 'https://matrix.example.org',
      accessToken: 'token',
      fetchImpl
    })

    expect((await adapter.poll({})).messages).toEqual([])
    const result = await adapter.poll({ chatGuid: matrixRoomGuid('!room:example.org'), afterRowId: 10 })

    expect(result.messages.map((message) => message.text)).toEqual(['new'])
  })

  it('sends outbound text through the Matrix room send endpoint', async () => {
    const fetchImpl = vi.fn(async () => okJson({ event_id: '$sent' }))
    const adapter = new MatrixChannelAdapter({
      homeserverUrl: 'https://matrix.example.org',
      accessToken: 'token',
      fetchImpl,
      createTxnId: () => 'txn-1'
    })

    await adapter.sendText({
      chatGuid: 'matrix:!room:example.org',
      recipientHandle: '@operator:example.org',
      text: 'TaskWraith: ready'
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://matrix.example.org/_matrix/client/v3/rooms/!room%3Aexample.org/send/m.room.message/txn-1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          msgtype: 'm.text',
          body: 'TaskWraith: ready'
        })
      })
    )
  })

  it('parses Matrix room ids from channel GUIDs', () => {
    expect(matrixRoomIdFromGuid('matrix:!room:example.org')).toBe('!room:example.org')
    expect(matrixRoomIdFromGuid('!room:example.org')).toBe('!room:example.org')
    expect(matrixRoomIdFromGuid('')).toBeNull()
  })

  it('surfaces Matrix API failures without leaking tokens', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ errcode: 'M_FORBIDDEN', error: 'Forbidden' })
    }))
    const adapter = new MatrixChannelAdapter({
      homeserverUrl: 'https://matrix.example.org',
      accessToken: 'secret-token',
      fetchImpl
    })

    await expect(adapter.poll({ chatGuid: 'matrix:!room:example.org' })).rejects.toThrow('Forbidden')
  })
})
