import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalWebChannelAdapter } from './LocalWebChannelAdapter'
import { LocalWebChannelServer } from './LocalWebChannelServer'
import type { MessageChannelPollSummary } from './MessageChannelGatewayService'

const servers: LocalWebChannelServer[] = []

type LocalWebPollOnce = (params: {
  channel: 'web'
  accountId: string
  chatGuid: string
  afterRowId: number
  includeFromMe: boolean
}) => Promise<MessageChannelPollSummary>

describe('LocalWebChannelServer', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()))
  })

  it('submits local web messages through the channel gateway policy path', async () => {
    const adapter = new LocalWebChannelAdapter({
      nowIso: () => '2026-06-08T12:00:00.000Z'
    })
    const pollOnce = vi.fn<LocalWebPollOnce>(async () => ({
      polled: 1,
      accepted: 1,
      dispatched: 1,
      commands: 0,
      rejected: {},
      lastRowId: 1
    }))
    const server = await startServer(adapter, pollOnce, { authToken: 'secret' })

    const response = await fetch(`${server.url}/messages`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        chatGuid: 'web:operator',
        senderHandle: 'web-user:operator',
        text: 'tw handoff to grok inspect this',
        isFromMe: true,
        attachments: [{ filename: ' note.txt ', path: ' /tmp/note.txt ' }]
      })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      message: {
        rowId: 1,
        channel: 'web',
        accountId: 'local-web',
        chatGuid: 'web:operator',
        senderHandle: 'web-user:operator',
        text: 'tw handoff to grok inspect this',
        isFromMe: false,
        attachments: [{ filename: 'note.txt', path: '/tmp/note.txt' }]
      },
      summary: {
        accepted: 1,
        dispatched: 1
      }
    })
    expect(pollOnce).toHaveBeenCalledWith({
      channel: 'web',
      accountId: 'local-web',
      chatGuid: 'web:operator',
      afterRowId: 0,
      includeFromMe: true
    })
  })

  it('requires bearer auth when configured and when binding outside loopback', async () => {
    const adapter = new LocalWebChannelAdapter()
    const pollOnce = vi.fn<LocalWebPollOnce>(emptyPollSummary)
    const server = await startServer(adapter, pollOnce, { authToken: 'secret' })

    await expect(fetch(`${server.url}/health`)).resolves.toMatchObject({
      status: 401
    })
    await expect(
      fetch(`${server.url}/health`, {
        headers: { authorization: 'Bearer wrong' }
      })
    ).resolves.toMatchObject({ status: 401 })
    await expect(
      fetch(`${server.url}/health`, {
        headers: { authorization: 'Bearer secret' }
      })
    ).resolves.toMatchObject({ status: 200 })
    expect(
      () =>
        new LocalWebChannelServer({
          adapter,
          gateway: { pollOnce },
          host: '0.0.0.0'
        })
    ).toThrow(/requires an authToken/)
  })

  it('lists and drains outbound local web replies', async () => {
    const adapter = new LocalWebChannelAdapter({
      nowIso: () => '2026-06-08T12:05:00.000Z'
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
      chatGuid: 'web:other',
      recipientHandle: 'web-user:operator',
      filePath: '/tmp/other.txt'
    })
    const server = await startServer(adapter, vi.fn<LocalWebPollOnce>(emptyPollSummary), {
      authToken: 'secret'
    })

    const listResponse = await fetch(`${server.url}/outbox?chatGuid=web:operator`, {
      headers: { authorization: 'Bearer secret' }
    })
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toMatchObject({
      ok: true,
      messages: [
        {
          id: 'web-out:1',
          chatGuid: 'web:operator',
          text: 'TaskWraith: online'
        }
      ]
    })

    const drainResponse = await fetch(`${server.url}/outbox/drain`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ chatGuid: 'web:operator' })
    })
    expect(drainResponse.status).toBe(200)
    await expect(drainResponse.json()).resolves.toMatchObject({
      ok: true,
      messages: [{ id: 'web-out:1' }]
    })
    expect(adapter.listOutbound()).toEqual([
      expect.objectContaining({
        id: 'web-out:2',
        chatGuid: 'web:other'
      })
    ])
  })

  it('returns structured client errors for bad JSON and missing routes', async () => {
    const server = await startServer(
      new LocalWebChannelAdapter(),
      vi.fn<LocalWebPollOnce>(emptyPollSummary)
    )
    const badJsonResponse = await fetch(`${server.url}/messages`, {
      method: 'POST',
      body: '{'
    })
    expect(badJsonResponse.status).toBe(400)
    await expect(badJsonResponse.json()).resolves.toEqual({
      ok: false,
      error: 'Request body must be valid JSON.'
    })

    const missingRouteResponse = await fetch(`${server.url}/missing`)
    expect(missingRouteResponse.status).toBe(404)
    await expect(missingRouteResponse.json()).resolves.toEqual({
      ok: false,
      error: 'Not found.'
    })
  })
})

async function startServer(
  adapter: LocalWebChannelAdapter,
  pollOnce: LocalWebPollOnce,
  options: { authToken?: string } = {}
): Promise<{ url: string }> {
  const server = new LocalWebChannelServer({
    adapter,
    gateway: { pollOnce },
    authToken: options.authToken
  })
  servers.push(server)
  return server.start()
}

async function emptyPollSummary(): Promise<MessageChannelPollSummary> {
  return {
    polled: 0,
    accepted: 0,
    dispatched: 0,
    commands: 0,
    rejected: {}
  }
}
