import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { URL } from 'url'
import {
  LocalWebChannelAdapter,
  type LocalWebChannelOutboundMessage,
  type LocalWebChannelSubmitInput
} from './LocalWebChannelAdapter'
import type { MessageChannelPollSummary } from './MessageChannelGatewayService'
import type { MessageChannelAttachment } from './MessageChannelTypes'

export interface LocalWebChannelServerOptions {
  adapter: LocalWebChannelAdapter
  gateway: {
    pollOnce: (params: {
      channel: 'web'
      accountId: string
      chatGuid: string
      afterRowId: number
      includeFromMe: boolean
    }) => Promise<MessageChannelPollSummary>
  }
  host?: string
  port?: number
  authToken?: string
  maxBodyBytes?: number
}

export interface LocalWebChannelServerAddress {
  host: string
  port: number
  url: string
}

export class LocalWebChannelServer {
  private readonly adapter: LocalWebChannelAdapter
  private readonly gateway: LocalWebChannelServerOptions['gateway']
  private readonly host: string
  private readonly port: number
  private readonly authToken: string | null
  private readonly maxBodyBytes: number
  private server: Server | null = null

  constructor(options: LocalWebChannelServerOptions) {
    this.adapter = options.adapter
    this.gateway = options.gateway
    this.host = options.host?.trim() || '127.0.0.1'
    this.port =
      typeof options.port === 'number' && Number.isFinite(options.port)
        ? Math.max(0, Math.trunc(options.port))
        : 0
    this.authToken = options.authToken?.trim() || null
    this.maxBodyBytes =
      typeof options.maxBodyBytes === 'number' && Number.isFinite(options.maxBodyBytes)
        ? Math.max(1024, Math.trunc(options.maxBodyBytes))
        : 256 * 1024

    if (!this.authToken && !isLoopbackHost(this.host)) {
      throw new Error('Local web channel server requires an authToken when binding outside loopback.')
    }
  }

  async start(): Promise<LocalWebChannelServerAddress> {
    if (this.server) return this.address()
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response)
    })
    await new Promise<void>((resolve, reject) => {
      const server = this.server
      if (!server) {
        reject(new Error('Local web channel server did not initialize.'))
        return
      }
      const onError = (err: Error): void => {
        server.off('listening', onListening)
        reject(err)
      }
      const onListening = (): void => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.port, this.host)
    })
    return this.address()
  }

  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = null
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  address(): LocalWebChannelServerAddress {
    const serverAddress = this.server?.address()
    if (!serverAddress || typeof serverAddress === 'string') {
      throw new Error('Local web channel server is not listening.')
    }
    const host = normalizeAddressHost(serverAddress, this.host)
    return {
      host,
      port: serverAddress.port,
      url: `http://${host}:${serverAddress.port}`
    }
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    writeCorsHeaders(response, Boolean(this.authToken))
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    if (!this.isAuthorized(request)) {
      writeJson(response, 401, { ok: false, error: 'Unauthorized.' })
      return
    }

    const url = new URL(request.url || '/', `http://${request.headers.host || this.host}`)
    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        writeJson(response, 200, {
          ok: true,
          channel: 'web',
          status: this.adapter.status()
        })
        return
      }
      if (request.method === 'POST' && url.pathname === '/messages') {
        await this.handleSubmitMessage(request, response)
        return
      }
      if (request.method === 'GET' && url.pathname === '/outbox') {
        writeJson(response, 200, {
          ok: true,
          messages: this.listOutboundFromUrl(url)
        })
        return
      }
      if (request.method === 'POST' && url.pathname === '/outbox/drain') {
        const body = await readJsonObject(request, this.maxBodyBytes, true)
        writeJson(response, 200, {
          ok: true,
          messages: this.adapter.drainOutbound(outboxFilterFromBody(body))
        })
        return
      }
      writeJson(response, 404, { ok: false, error: 'Not found.' })
    } catch (err) {
      writeJson(response, statusCodeForError(err), {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  private async handleSubmitMessage(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const body = await readJsonObject(request, this.maxBodyBytes)
    const input = submitInputFromBody(body)
    const message = this.adapter.submitMessage({
      ...input,
      isFromMe: false
    })
    const summary = await this.gateway.pollOnce({
      channel: 'web',
      accountId: message.accountId,
      chatGuid: message.chatGuid,
      afterRowId: Math.max(0, message.rowId - 1),
      includeFromMe: true
    })
    writeJson(response, 200, {
      ok: true,
      message,
      summary
    })
  }

  private listOutboundFromUrl(url: URL): LocalWebChannelOutboundMessage[] {
    return this.adapter.listOutbound({
      ...(url.searchParams.get('accountId')?.trim()
        ? { accountId: url.searchParams.get('accountId')?.trim() }
        : {}),
      ...(url.searchParams.get('chatGuid')?.trim()
        ? { chatGuid: url.searchParams.get('chatGuid')?.trim() }
        : {})
    })
  }

  private isAuthorized(request: IncomingMessage): boolean {
    if (!this.authToken) return true
    return request.headers.authorization === `Bearer ${this.authToken}`
  }
}

function submitInputFromBody(body: Record<string, unknown>): LocalWebChannelSubmitInput {
  return {
    ...(stringFromBody(body, 'accountId') ? { accountId: stringFromBody(body, 'accountId') } : {}),
    chatGuid: requiredStringFromBody(body, 'chatGuid'),
    senderHandle: requiredStringFromBody(body, 'senderHandle'),
    ...(stringFromBody(body, 'text') !== undefined ? { text: stringFromBody(body, 'text') } : {}),
    ...(stringFromBody(body, 'timestamp') ? { timestamp: stringFromBody(body, 'timestamp') } : {}),
    ...(stringFromBody(body, 'messageGuid') ? { messageGuid: stringFromBody(body, 'messageGuid') } : {}),
    ...(Array.isArray(body.attachments)
      ? { attachments: normalizeAttachments(body.attachments) }
      : {})
  }
}

function outboxFilterFromBody(body: Record<string, unknown>): { accountId?: string; chatGuid?: string } {
  return {
    ...(stringFromBody(body, 'accountId') ? { accountId: stringFromBody(body, 'accountId') } : {}),
    ...(stringFromBody(body, 'chatGuid') ? { chatGuid: stringFromBody(body, 'chatGuid') } : {})
  }
}

function normalizeAttachments(value: unknown[]): MessageChannelAttachment[] {
  return value
    .filter((attachment): attachment is Record<string, unknown> =>
      Boolean(attachment && typeof attachment === 'object' && !Array.isArray(attachment))
    )
    .map((attachment) => ({
      ...(stringFromBody(attachment, 'id') ? { id: stringFromBody(attachment, 'id') } : {}),
      ...(stringFromBody(attachment, 'filename')
        ? { filename: stringFromBody(attachment, 'filename') }
        : {}),
      ...(stringFromBody(attachment, 'mimeType')
        ? { mimeType: stringFromBody(attachment, 'mimeType') }
        : {}),
      ...(stringFromBody(attachment, 'uti') ? { uti: stringFromBody(attachment, 'uti') } : {}),
      ...(stringFromBody(attachment, 'path') ? { path: stringFromBody(attachment, 'path') } : {}),
      ...(typeof attachment.byteCount === 'number' && Number.isFinite(attachment.byteCount)
        ? { byteCount: attachment.byteCount }
        : {})
    }))
}

async function readJsonObject(
  request: IncomingMessage,
  maxBodyBytes: number,
  allowEmpty = false
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.byteLength
    if (totalBytes > maxBodyBytes) {
      throw new HttpError(413, 'Request body is too large.')
    }
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw && allowEmpty) return {}
  if (!raw) throw new HttpError(400, 'JSON request body is required.')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'JSON request body must be an object.')
  }
  return parsed as Record<string, unknown>
}

function requiredStringFromBody(body: Record<string, unknown>, key: string): string {
  const value = stringFromBody(body, key)?.trim()
  if (!value) throw new HttpError(400, `${key} is required.`)
  return value
}

function stringFromBody(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  return typeof value === 'string' ? value : undefined
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  response.end(`${JSON.stringify(payload)}\n`)
}

function writeCorsHeaders(response: ServerResponse, enabled: boolean): void {
  if (!enabled) return
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  response.setHeader('access-control-allow-headers', 'authorization,content-type')
}

class HttpError extends Error {
  readonly statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

function statusCodeForError(err: unknown): number {
  if (err instanceof HttpError) return err.statusCode
  return 500
}

function normalizeAddressHost(address: AddressInfo, fallbackHost: string): string {
  if (address.address === '::' || address.address === '0.0.0.0') return fallbackHost
  if (address.family === 'IPv6') return `[${address.address}]`
  return address.address || fallbackHost
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}
