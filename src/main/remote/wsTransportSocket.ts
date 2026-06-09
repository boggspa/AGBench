/*
 * Real-WebSocket adapter for RemoteTransportClient's injectable socket factory.
 * Thin glue over `ws` so the client stays transport-agnostic + unit-testable.
 */

import { WebSocket } from 'ws'
import type { TransportSocket, TransportSocketFactory } from './RemoteTransportClient'

export const wsTransportSocketFactory: TransportSocketFactory = (url, headers, handlers) => {
  const socket = new WebSocket(url, { headers })
  socket.on('open', () => handlers.onOpen())
  socket.on('message', (data) => handlers.onMessage(data.toString()))
  socket.on('close', (code) => handlers.onClose(code))
  socket.on('error', (err) => handlers.onError(err instanceof Error ? err : new Error(String(err))))
  const adapter: TransportSocket = {
    send: (data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data)
    },
    close: () => socket.close()
  }
  return adapter
}
