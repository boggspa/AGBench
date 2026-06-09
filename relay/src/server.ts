/*
 * taskwraith-relay — a dumb, ciphertext-only WebSocket forwarder.
 *
 * Self-hostable (Tailscale / VPS / reverse-proxy). It knows NOTHING about the
 * taskwraith-e2ee-v1 payloads: it keeps one room per sessionId with at most one
 * `mac` and one `iphone` socket, and forwards every frame from one role to the
 * other VERBATIM. Plaintext handshake metadata + ciphertext both pass through
 * opaquely; the relay holds no key material. See src/shared/e2ee for the
 * protocol the endpoints speak across this pipe.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { handleResolve } from './resolve'

type Role = 'mac' | 'iphone'

interface Room {
  mac?: WebSocket
  iphone?: WebSocket
  lastActivity: number
}

export interface RelayOptions {
  port?: number
  /** Max frame size; a frame larger than this closes the socket. */
  maxFrameBytes?: number
  /** Drop an idle room after this long with no traffic. */
  idleTtlMs?: number
}

export interface RelayServerHandle {
  port: number
  roomCount: () => number
  close: () => Promise<void>
}

const ROLE_HEADER = 'x-taskwraith-role'
const SESSION_PATH = /^\/v1\/session\/([A-Za-z0-9._-]+)$/

export function createRelayServer(options: RelayOptions = {}): Promise<RelayServerHandle> {
  const maxFrameBytes = options.maxFrameBytes ?? 256 * 1024
  const idleTtlMs = options.idleTtlMs ?? 5 * 60 * 1000
  const rooms = new Map<string, Room>()

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && (req.url || '').startsWith('/v1/resolve')) {
      handleResolve(req, res)
      return
    }
    res.statusCode = 404
    res.end('not found')
  })

  const wss = new WebSocketServer({ server: http, maxPayload: maxFrameBytes })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const path = (req.url || '').split('?')[0]
    const match = SESSION_PATH.exec(path)
    const role = String(req.headers[ROLE_HEADER] || '') as Role
    if (!match || (role !== 'mac' && role !== 'iphone')) {
      ws.close(4001, 'bad session or role')
      return
    }
    const sessionId = match[1]
    let room = rooms.get(sessionId)
    if (!room) {
      room = { lastActivity: Date.now() }
      rooms.set(sessionId, room)
    }
    if (room[role]) {
      // Anti-hijack: a role slot in a room is single-occupant.
      ws.close(4002, 'role already connected')
      return
    }
    room[role] = ws
    const peerRole: Role = role === 'mac' ? 'iphone' : 'mac'

    ws.on('message', (data: RawData) => {
      const r = rooms.get(sessionId)
      if (!r) return
      r.lastActivity = Date.now()
      const peer = r[peerRole]
      if (peer && peer.readyState === WebSocket.OPEN) {
        // Forward bytes verbatim — the relay never parses or decrypts.
        peer.send(data)
      }
    })

    const cleanup = (): void => {
      const r = rooms.get(sessionId)
      if (!r) return
      if (r[role] === ws) r[role] = undefined
      if (!r.mac && !r.iphone) rooms.delete(sessionId)
    }
    ws.on('close', cleanup)
    ws.on('error', cleanup)
  })

  const sweeper = setInterval(() => {
    const now = Date.now()
    for (const [id, room] of rooms) {
      if (now - room.lastActivity > idleTtlMs) {
        room.mac?.close(4003, 'idle')
        room.iphone?.close(4003, 'idle')
        rooms.delete(id)
      }
    }
  }, Math.max(1000, Math.floor(idleTtlMs / 4)))
  sweeper.unref?.()

  return new Promise<RelayServerHandle>((resolve) => {
    http.listen(options.port ?? 0, () => {
      const addr = http.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        port,
        roomCount: () => rooms.size,
        close: () =>
          new Promise<void>((res) => {
            clearInterval(sweeper)
            for (const room of rooms.values()) {
              room.mac?.terminate()
              room.iphone?.terminate()
            }
            rooms.clear()
            wss.close(() => http.close(() => res()))
          })
      })
    })
  })
}

// Allow `node relay/dist/server.js` (or tsx) to run a standalone relay.
if (require.main === module) {
  const port = Number(process.env.PORT || 8787)
  void createRelayServer({ port }).then((handle) => {
    // eslint-disable-next-line no-console
    console.log(`[taskwraith-relay] listening on :${handle.port}`)
  })
}
