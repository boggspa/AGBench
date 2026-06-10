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
import { createResolveDirectory, type ResolveDirectoryOptions } from './resolve'

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
  /** Trusted-reconnect directory tuning (freshness window, max TTL). */
  resolve?: ResolveDirectoryOptions
}

export interface RelayServerHandle {
  port: number
  roomCount: () => number
  registrationCount: () => number
  close: () => Promise<void>
}

const ROLE_HEADER = 'x-taskwraith-role'
const SESSION_PATH = /^\/v1\/session\/([A-Za-z0-9._-]+)$/

export function createRelayServer(options: RelayOptions = {}): Promise<RelayServerHandle> {
  // Snapshot frames carry every visible chat's projections in one app
  // message; 256K was too tight once real workspaces went on the allowlist
  // (ws kills the CONNECTION on violation — code 1009 — not just the frame).
  const maxFrameBytes = options.maxFrameBytes ?? 1024 * 1024
  const idleTtlMs = options.idleTtlMs ?? 5 * 60 * 1000
  const rooms = new Map<string, Room>()
  const resolveDirectory = createResolveDirectory(options.resolve)

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if ((req.url || '').startsWith('/v1/resolve')) {
      resolveDirectory.handle(req, res)
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

    // WS-level heartbeat: a parked Mac listener waiting for a phone sends
    // no app frames, so without pings the idle sweeper reaps the room and
    // the phone's trusted reconnect finds nobody until the listener's
    // backoff loop happens to rebind. Pings (auto-ponged by ws) keep a
    // LIVE-but-quiet socket counted as activity; truly dead sockets stop
    // ponging and still get swept.
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping()
    }, 30_000)
    heartbeat.unref?.()
    ws.on('pong', () => {
      const r = rooms.get(sessionId)
      if (r) r.lastActivity = Date.now()
    })

    const cleanup = (): void => {
      clearInterval(heartbeat)
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

  return new Promise<RelayServerHandle>((resolve, reject) => {
    // Surface bind failures (EADDRINUSE etc.) as a rejection instead of an
    // uncaught 'error' event — the embedded-relay path in Electron main
    // catches this and disables pairing with a clear log line.
    http.once('error', (err) => {
      clearInterval(sweeper)
      reject(err)
    })
    http.listen(options.port ?? 0, () => {
      const addr = http.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        port,
        roomCount: () => rooms.size,
        registrationCount: () => resolveDirectory.registrationCount(),
        close: () =>
          new Promise<void>((res) => {
            clearInterval(sweeper)
            resolveDirectory.close()
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

// Standalone runs live in ./cli.ts (`npx tsx relay/src/cli.ts`). The old
// `require.main === module` auto-start was removed deliberately: this module
// is now ALSO imported by Electron main (the embedded relay), where the
// bundled top-level `module` IS `require.main` — the guard would have
// auto-bound a rogue relay on every app launch, gate or no gate.
