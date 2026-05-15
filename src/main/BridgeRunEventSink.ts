import type { RunEvent, RunEventSink } from './RunEventBus'

/**
 * BridgeRunEventSink — fans every `RunEventBus` event out to the daemon
 * via JSON-RPC notification, which then forwards to any connected iOS
 * devices over QUIC.
 *
 * Design lift from Phase B: `RunEventBus` was deliberately built as a
 * fan-out primitive so additional sinks could be added without touching
 * the ~10 emission call sites scattered through `main/index.ts`. The
 * Electron IPC sink was the first subscriber (preserves legacy renderer
 * behavior); this is the second. From the perspective of the renderer
 * and the adapters, nothing changed — events still flow through
 * `runEventBus.publish(...)` and the renderer still receives them.
 *
 * Filtering today: **forward everything**. The daemon receives the
 * notifications and broadcasts to any connected iOS devices; iOS-side
 * filtering (by appRunId / workspaceId / interest set) decides whether
 * to surface them. Per-pair routing is a future refinement once iOS
 * actually opts in to specific runs (Phase D1's "watched chats"
 * concept from the original plan).
 *
 * Performance: each forwarded notification is a single stdout `write`
 * line into the daemon's stdin pipe. Cost is dominated by JSON encoding
 * (which the renderer-side IPC sink ALSO does); same order of magnitude.
 * In normal use without iOS active, the daemon receives + discards
 * (no connected QUIC peers), which is cheap. When iOS is paired and
 * connected, this becomes the live transcript stream.
 *
 * Wire shape (the notification the daemon receives):
 *
 *   `bridge.runEvent`
 *   {
 *     channel: "agent-output",
 *     provider: "gemini",
 *     payload: {...the routed event payload...},
 *     publishedAt: "2026-05-15T..."
 *   }
 *
 * The daemon (Swift side, separate slice) will translate this into an
 * iOS-bound QUIC frame on each active pair connection.
 */

export interface BridgeRunEventNotifier {
  /** Send a fire-and-forget notification to the daemon over stdio. Same
   * `BridgeDaemonClient.notify` shape — abstracted so tests don't need a
   * real daemon spawned. */
  notify(method: string, params: unknown): void
}

export interface BridgeRunEventSinkOptions {
  /** Notifier used to push to the daemon. Production wires
   * `BridgeDaemonClient`. Tests wire a vi.fn(). */
  notifier: BridgeRunEventNotifier
  /** When set, the sink's published events are also forwarded here.
   * Useful when running with `AGBENCH_DEBUG_BUS=1` so the forwarded
   * notifications show up in the dev terminal. */
  log?: (line: string) => void
  /** Optional filter to drop events before forwarding. Defaults to
   * forward-everything. Per-pair routing eventually plugs in here. */
  filter?: (event: RunEvent) => boolean
}

const NOTIFICATION_METHOD = 'bridge.runEvent'

export function makeBridgeRunEventSink(options: BridgeRunEventSinkOptions): RunEventSink {
  const { notifier, log, filter } = options
  return {
    id: 'bridge-run-events',
    filter,
    handle(event) {
      // Strip the (non-serializable) `sender: Electron.WebContents` before
      // forwarding — it's only meaningful to the in-process Electron IPC
      // sink. Everything else round-trips through JSON without surprise.
      const wireEvent = {
        channel: event.channel,
        provider: event.provider,
        payload: event.payload,
        publishedAt: event.publishedAt
      }
      try {
        notifier.notify(NOTIFICATION_METHOD, wireEvent)
      } catch (err) {
        // Best-effort — a failed notify (daemon dead, stdin closed) must
        // not break the bus. Log + swallow.
        log?.(
          `[BridgeRunEventSink] notify failed for channel="${event.channel}": ${err instanceof Error ? err.message : String(err)}`
        )
        return
      }
      log?.(`[BridgeRunEventSink] forwarded channel="${event.channel}" provider="${event.provider}"`)
    }
  }
}
