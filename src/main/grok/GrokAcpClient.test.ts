import { describe, it, expect } from 'vitest'
import { runGrokAcpTurn, type AcpChildProcess, type GrokAcpRunOptions } from './GrokAcpClient'
import type { NormalizedGrokRunEvent } from './GrokAcpProtocol'

class FakeAcpChild implements AcpChildProcess {
  writes: string[] = []
  killed = false
  private dataListeners: ((chunk: string) => void)[] = []
  private closeListener?: (code: number | null) => void
  private errorListener?: (err: Error) => void

  stdin = {
    write: (data: string): void => {
      this.writes.push(data)
    }
  }
  stdout = {
    on: (_event: 'data', listener: (chunk: string) => void): void => {
      this.dataListeners.push(listener)
    }
  }
  stderr = {
    on: (_event: 'data', _listener: (chunk: string) => void): void => {}
  }

  on(event: 'error' | 'close', listener: (arg: never) => void): void {
    if (event === 'close') this.closeListener = listener as (code: number | null) => void
    else this.errorListener = listener as (err: Error) => void
  }

  kill(): void {
    this.killed = true
    this.closeListener?.(0)
  }

  /** Test helper: deliver an ACP message line to the client. */
  emit(message: unknown): void {
    const line = `${JSON.stringify(message)}\n`
    this.dataListeners.forEach((cb) => cb(line))
  }

  sent(): Record<string, unknown>[] {
    return this.writes.map((w) => JSON.parse(w.trim()))
  }

  fail(err: Error): void {
    this.errorListener?.(err)
  }
}

const run = (
  child: FakeAcpChild,
  overrides: Partial<GrokAcpRunOptions> = {}
): {
  events: NormalizedGrokRunEvent[]
  closes: (number | null)[]
  handle: ReturnType<typeof runGrokAcpTurn>
} => {
  const events: NormalizedGrokRunEvent[] = []
  const closes: (number | null)[] = []
  const handle = runGrokAcpTurn({
    prompt: 'hi',
    cwd: '/tmp/ws',
    spawnProcess: () => child,
    onEvent: (e) => events.push(e),
    onClose: (c) => closes.push(c),
    ...overrides
  })
  return { events, closes, handle }
}

describe('runGrokAcpTurn', () => {
  it('drives initialize → session/new → session/prompt and streams the answer', async () => {
    const child = new FakeAcpChild()
    const { events, closes } = run(child)

    // On construction it sends initialize.
    expect(child.sent()[0]).toMatchObject({ id: 1, method: 'initialize' })

    // initialize result → session/new (with cwd, empty mcpServers).
    child.emit({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } })
    expect(child.sent()[1]).toMatchObject({
      id: 2,
      method: 'session/new',
      params: { cwd: '/tmp/ws', mcpServers: [] }
    })

    // session/new result → capture sessionId (init event) + send the prompt.
    child.emit({ jsonrpc: '2.0', id: 2, result: { sessionId: 's-123' } })
    expect(events).toContainEqual({ type: 'init', sessionId: 's-123' })
    expect(child.sent()[2]).toMatchObject({
      id: 3,
      method: 'session/prompt',
      params: { sessionId: 's-123', prompt: [{ type: 'text', text: 'hi' }] }
    })

    // Stream updates: thought + answer chunks.
    const update = (sessionUpdate: string, text: string) => ({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 's-123', update: { sessionUpdate, content: { type: 'text', text } } }
    })
    child.emit(update('agent_thought_chunk', 'Greeting.'))
    child.emit(update('agent_message_chunk', 'Hi'))
    child.emit(update('agent_message_chunk', '!'))

    const answer = events
      .filter((e) => e.type === 'content')
      .map((e) => e.text)
      .join('')
    expect(answer).toBe('Hi!')
    expect(events.some((e) => e.type === 'thinking' && e.text === 'Greeting.')).toBe(true)

    // Completion notification → turn complete → process closed.
    child.emit({
      jsonrpc: '2.0',
      method: '_x.ai/session/prompt_complete',
      params: { sessionId: 's-123', stopReason: 'end_turn' }
    })
    // The ACP `result` is NOT forwarded as a sink event — caller synthesizes it.
    expect(events.some((e) => e.type === 'result')).toBe(false)

    await new Promise((r) => setTimeout(r, 40))
    expect(child.killed).toBe(true)
    expect(closes).toEqual([0])
  })

  it('cancel() sends session/cancel then kills (only mid-turn)', () => {
    const child = new FakeAcpChild()
    const { handle } = run(child)
    child.emit({ jsonrpc: '2.0', id: 1, result: {} })
    child.emit({ jsonrpc: '2.0', id: 2, result: { sessionId: 's-9' } })

    handle.cancel()
    const cancelMsg = child.sent().find((m) => m.method === 'session/cancel')
    expect(cancelMsg).toMatchObject({ method: 'session/cancel', params: { sessionId: 's-9' } })
    expect(child.killed).toBe(true)
  })

  it('G5 — answers session/request_permission with DENY by default (never hangs/allows)', async () => {
    const child = new FakeAcpChild()
    const { events } = run(child)
    child.emit({ jsonrpc: '2.0', id: 1, result: {} })
    child.emit({ jsonrpc: '2.0', id: 2, result: { sessionId: 's-1' } })

    child.emit({
      jsonrpc: '2.0',
      id: 42,
      method: 'session/request_permission',
      params: {
        sessionId: 's-1',
        toolCall: { title: 'Write file', kind: 'edit' },
        options: [
          { optionId: 'a', name: 'Allow', kind: 'allow_once' },
          { optionId: 'r', name: 'Reject', kind: 'reject_once' }
        ]
      }
    })
    await new Promise((r) => setTimeout(r, 0))

    const response = child.sent().find((m) => m.id === 42 && 'result' in m)
    // Default-deny → it SELECTS the reject option (a denial), never an allow.
    expect(response).toMatchObject({
      id: 42,
      result: { outcome: { outcome: 'selected', optionId: 'r' } }
    })
    // The decline is surfaced in the transcript so the user knows a tool was asked for.
    expect(
      events.some((e) => e.type === 'provider_warning' && /requested a tool/.test(e.text || ''))
    ).toBe(true)
  })

  it('G5 — routes the permission request through an injected handler (allow path)', async () => {
    const child = new FakeAcpChild()
    const seen: string[] = []
    run(child, {
      onPermissionRequest: (req) => {
        seen.push(req.toolName)
        return 'allow'
      }
    })
    child.emit({ jsonrpc: '2.0', id: 1, result: {} })
    child.emit({ jsonrpc: '2.0', id: 2, result: { sessionId: 's-1' } })
    child.emit({
      jsonrpc: '2.0',
      id: 99,
      method: 'session/request_permission',
      params: {
        sessionId: 's-1',
        toolCall: { title: 'Read file', kind: 'read' },
        options: [{ optionId: 'a', name: 'Allow', kind: 'allow_once' }]
      }
    })
    await new Promise((r) => setTimeout(r, 0))

    expect(seen).toEqual(['Read file'])
    const response = child.sent().find((m) => m.id === 99 && 'result' in m)
    expect(response).toMatchObject({
      id: 99,
      result: { outcome: { outcome: 'selected', optionId: 'a' } }
    })
  })

  it('surfaces a spawn/process error as a provider_warning + closes', () => {
    const child = new FakeAcpChild()
    const { events, closes } = run(child)
    child.fail(new Error('spawn failed'))
    expect(events.some((e) => e.type === 'provider_warning' && e.text === 'spawn failed')).toBe(
      true
    )
    expect(closes).toEqual([1])
  })
})
