/*
 * taskwraith-relay — trusted-reconnect resolve endpoint.
 *
 * Phase T5 fills this in: a signed (Ed25519 identity), nonce'd, freshness-bounded
 * POST that maps an iPhone identity key to the Mac's current live sessionId so a
 * reconnect needs no QR re-scan. Until then it's a 501 stub so the route exists.
 */

import type { IncomingMessage, ServerResponse } from 'http'

export function handleResolve(_req: IncomingMessage, res: ServerResponse): void {
  res.statusCode = 501
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ ok: false, error: 'trusted-reconnect resolve not implemented (T5)' }))
}
