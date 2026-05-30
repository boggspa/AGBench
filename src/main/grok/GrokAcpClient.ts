// Bidirectional JSON-RPC (ACP) client for `grok agent stdio`. Drives the
// read-only turn flow: initialize → session/new → session/prompt, streaming
// session/update notifications back through `onEvent`. Process spawn is
// INJECTED so the state machine is unit-testable against a fake child (no real
// process / model call in tests). Protocol shapes proven by the G1 spike.
//
// G4 is read-only: clientCapabilities advertise no fs write, mcpServers is
// empty, and we never send the `always-approve` command. AGBench-owned tools +
// session/request_permission mediation come in G5.

import {
  encodeAcpFrame,
  parseAcpStreamChunk,
  acpMessageToRunEvents,
  isAcpPermissionRequest,
  parseAcpPermissionRequest,
  buildAcpPermissionResponse,
  type NormalizedGrokRunEvent,
  type AcpPermissionRequest,
  type AcpPermissionDecision
} from './GrokAcpProtocol'

/** Minimal child-process surface this client needs (subset of ChildProcess). */
export interface AcpChildProcess {
  stdin: { write(data: string): void } | null
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): void } | null
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): void } | null
  on(event: 'error', listener: (err: Error) => void): void
  on(event: 'close', listener: (code: number | null) => void): void
  kill(signal?: string): void
}

export interface GrokAcpRunOptions {
  prompt: string
  cwd: string
  /** Spawns `grok --no-auto-update agent stdio` (injected for testability). */
  spawnProcess: () => AcpChildProcess
  /** Normalized run events: content / thinking / init(sessionId) / result / warning. */
  onEvent: (event: NormalizedGrokRunEvent) => void
  /** Called once with the spawned child (for the cancellation registry). */
  onProcess?: (child: AcpChildProcess) => void
  /**
   * G5 — client-mediated tool approval. When the agent sends
   * `session/request_permission`, this resolves the decision that's written
   * back. The default (when omitted) is DENY: the request is answered with a
   * 'cancelled'/reject outcome so the agent never hangs and never gets a silent
   * allow. runGrokAcpProvider supplies a real handler that routes the request
   * to the AGBench approval ledger (G5c, the live-verified follow-up).
   */
  onPermissionRequest?: (
    request: AcpPermissionRequest
  ) => AcpPermissionDecision | Promise<AcpPermissionDecision>
  /**
   * Called once when the child exits. `turnComplete` is true when the prompt
   * reached its stopReason before exit — the caller uses it (not the exit code)
   * to decide success, since a normal turn ends by SIGINT-killing the stdio
   * server (a non-zero exit).
   */
  onClose?: (code: number | null, turnComplete: boolean) => void
  /**
   * G4d — opt-in raw JSON-RPC frame tap (both directions). Used by the gated
   * AGBENCH_GROK_DEBUG capture so the live ACP wire shape can be confirmed from
   * a single in-app run — in particular whether Grok actually emits `tool_call`
   * session/updates and `session/request_permission` requests (the safety
   * precondition for trusting write-over-ACP). Never affects behavior.
   */
  onRawFrame?: (direction: 'in' | 'out', message: unknown) => void
}

export interface GrokAcpRunHandle {
  /** User-initiated cancel: session/cancel (protocol) then kill. */
  cancel: () => void
}

const ACP_ID = { initialize: 1, sessionNew: 2, prompt: 3 } as const

/**
 * Run a single read-only ACP turn. Returns a handle whose `cancel()` interrupts
 * an in-progress turn. The caller wires `onEvent` to its run-event sink and
 * synthesizes the canonical result/exit from `onClose`.
 */
export function runGrokAcpTurn(options: GrokAcpRunOptions): GrokAcpRunHandle {
  const child = options.spawnProcess()
  options.onProcess?.(child)

  let carry = ''
  let sessionId = ''
  let promptSent = false
  let turnComplete = false

  const writeRpc = (id: number | null, method: string, params: unknown): void => {
    const message =
      id == null ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }
    options.onRawFrame?.('out', message)
    try {
      child.stdin?.write(encodeAcpFrame(message))
    } catch {
      // stdin may be gone if the child exited; ignored.
    }
  }

  // Write a raw JSON-RPC response object (already shaped {jsonrpc,id,result}).
  const writeResponse = (message: Record<string, unknown>): void => {
    options.onRawFrame?.('out', message)
    try {
      child.stdin?.write(encodeAcpFrame(message))
    } catch {
      // stdin may be gone if the child exited; ignored.
    }
  }

  // G5 — answer an inbound session/request_permission. Resolves the decision
  // (handler or default DENY), then writes the response. Default-deny means a
  // missing handler / rejected promise can never silently allow a tool, and the
  // agent never hangs waiting for a reply.
  const answerPermissionRequest = (request: AcpPermissionRequest): void => {
    const fallbackDeny = (): void =>
      writeResponse(buildAcpPermissionResponse(request.rpcId, request.options, 'deny'))
    let decision: AcpPermissionDecision | Promise<AcpPermissionDecision>
    try {
      decision = options.onPermissionRequest ? options.onPermissionRequest(request) : 'deny'
    } catch {
      fallbackDeny()
      return
    }
    Promise.resolve(decision)
      .then((resolved) =>
        writeResponse(buildAcpPermissionResponse(request.rpcId, request.options, resolved))
      )
      .catch(fallbackDeny)
    // Surface the request in the transcript only when no mediator is wired
    // (so the user sees WHY a tool was declined). With a handler (G5c) the
    // ledger card is the surface, so stay quiet here.
    if (!options.onPermissionRequest) {
      options.onEvent({
        type: 'provider_warning',
        text: `Grok requested a tool (${request.toolName}) — declined (AGBench tool mediation is gated until G5c).`
      })
    }
  }

  // Step 1 — initialize handshake (read-only client capabilities).
  writeRpc(ACP_ID.initialize, 'initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    clientInfo: { name: 'agbench', version: '1.0.6' }
  })

  child.stdout?.on('data', (chunk) => {
    const parsed = parseAcpStreamChunk(chunk.toString(), carry)
    carry = parsed.carry
    for (const message of parsed.messages) {
      options.onRawFrame?.('in', message)
      // G5 — inbound agent→client request: answer tool-permission asks before
      // anything else (it's a request with an id + method, not a response).
      if (isAcpPermissionRequest(message)) {
        const request = parseAcpPermissionRequest(message)
        if (request) answerPermissionRequest(request)
        continue
      }
      // Lifecycle correlation by request id (single sequential flow).
      if (message.id === ACP_ID.initialize && message.result) {
        // Step 2 — create a session in the workspace; no MCP in read-only G4.
        writeRpc(ACP_ID.sessionNew, 'session/new', { cwd: options.cwd, mcpServers: [] })
        continue
      }
      if (message.id === ACP_ID.sessionNew && message.result) {
        const result = message.result as { sessionId?: string }
        sessionId = typeof result.sessionId === 'string' ? result.sessionId : ''
        if (sessionId) options.onEvent({ type: 'init', sessionId })
        if (!promptSent) {
          promptSent = true
          // Step 3 — the prompt (the only step that calls the model).
          writeRpc(ACP_ID.prompt, 'session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: options.prompt }]
          })
        }
        continue
      }
      // Everything else: stream updates / capture completion. We forward
      // content + thinking to the sink, but NOT the ACP `result` — the caller
      // synthesizes the canonical result/exit from onClose (mirrors the
      // headless path). A result event just signals the turn is done.
      for (const event of acpMessageToRunEvents(message)) {
        if (event.type === 'result') {
          turnComplete = true
        } else {
          options.onEvent(event)
        }
      }
      if (turnComplete) {
        // Normal completion: just close the process (do NOT session/cancel —
        // that's only for interrupting an in-progress turn).
        setTimeout(() => child.kill('SIGINT'), 25)
      }
    }
  })

  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString().trim()
    if (text) options.onEvent({ type: 'provider_warning', text })
  })

  child.on('error', (err) => {
    options.onEvent({ type: 'provider_warning', text: err.message })
    options.onClose?.(1, turnComplete)
  })
  child.on('close', (code) => options.onClose?.(code, turnComplete))

  return {
    cancel: () => {
      if (sessionId && !turnComplete) writeRpc(null, 'session/cancel', { sessionId })
      child.kill('SIGINT')
    }
  }
}
