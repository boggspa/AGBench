/*
 * Standalone relay runner — for self-hosting the relay somewhere other than
 * the Mac (a VPS, a home server, a Tailscale node):
 *
 *   npx tsx relay/src/cli.ts            # listens on :8787
 *   PORT=9000 npx tsx relay/src/cli.ts
 *
 * When TaskWraith runs with IOS_REMOTE_TRUE=1 and NO TASKWRAITH_RELAY_URL,
 * the app embeds this same relay in-process instead — no external command
 * needed. Set TASKWRAITH_RELAY_URL to point the app at a relay started here.
 */

import { createRelayServer } from './server'

const port = Number(process.env.PORT || 8787)
void createRelayServer({ port })
  .then((handle) => {
    // eslint-disable-next-line no-console
    console.log(`[taskwraith-relay] listening on :${handle.port}`)
  })
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(
      `[taskwraith-relay] failed to start: ${err instanceof Error ? err.message : String(err)}`
    )
    process.exit(1)
  })
