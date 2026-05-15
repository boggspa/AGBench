import { describe, expect, it, vi } from 'vitest'
import { makeBridgeRunEventSink } from './BridgeRunEventSink'
import type { RunEvent } from './RunEventBus'

function sampleEvent(overrides: Partial<RunEvent> = {}): RunEvent {
  return {
    channel: 'agent-output',
    provider: 'gemini',
    payload: { hello: 'world', appRunId: 'run-1' },
    publishedAt: '2026-05-15T12:00:00Z',
    ...overrides
  }
}

describe('makeBridgeRunEventSink', () => {
  it('forwards every event by default with the expected wire shape', () => {
    const notify = vi.fn()
    const sink = makeBridgeRunEventSink({ notifier: { notify } })
    sink.handle(sampleEvent())
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('bridge.runEvent', {
      channel: 'agent-output',
      provider: 'gemini',
      payload: { hello: 'world', appRunId: 'run-1' },
      publishedAt: '2026-05-15T12:00:00Z'
    })
  })

  it('strips the non-serializable sender field before notifying', () => {
    const notify = vi.fn()
    const sink = makeBridgeRunEventSink({ notifier: { notify } })
    // Fabricate a "sender" shape on the event — sink should not forward it.
    sink.handle({
      ...sampleEvent(),
      sender: { isDestroyed: () => false, send: () => {} } as unknown as Electron.WebContents
    })
    const forwardedShape = notify.mock.calls[0][1] as Record<string, unknown>
    expect(forwardedShape).not.toHaveProperty('sender')
  })

  it('uses sink id "bridge-run-events"', () => {
    const sink = makeBridgeRunEventSink({ notifier: { notify: vi.fn() } })
    expect(sink.id).toBe('bridge-run-events')
  })

  it('applies an optional filter (forward when filter returns true)', () => {
    const notify = vi.fn()
    const sink = makeBridgeRunEventSink({
      notifier: { notify },
      filter: (e) => e.channel === 'agent-output'
    })
    expect(sink.filter).toBeDefined()
    // Filter is consulted by the bus, not by handle() — but we test that
    // the option is plumbed through.
    if (sink.filter) {
      expect(sink.filter(sampleEvent({ channel: 'agent-output' }))).toBe(true)
      expect(sink.filter(sampleEvent({ channel: 'agent-error' }))).toBe(false)
    }
  })

  it('does not throw when the notifier throws (best-effort delivery)', () => {
    const notify = vi.fn(() => {
      throw new Error('daemon stdin closed')
    })
    const log = vi.fn()
    const sink = makeBridgeRunEventSink({ notifier: { notify }, log })
    expect(() => sink.handle(sampleEvent())).not.toThrow()
    // The error must be surfaced to the log so an operator can see why the
    // forward isn't working.
    const logged = log.mock.calls.map((c) => c[0] as string).join('\n')
    expect(logged).toContain('notify failed')
    expect(logged).toContain('daemon stdin closed')
  })

  it('logs forwarded events when log is provided', () => {
    const notify = vi.fn()
    const log = vi.fn()
    const sink = makeBridgeRunEventSink({ notifier: { notify }, log })
    sink.handle(sampleEvent({ channel: 'agent-exit', provider: 'codex' }))
    const logged = log.mock.calls.map((c) => c[0] as string).join('\n')
    expect(logged).toContain('forwarded')
    expect(logged).toContain('agent-exit')
    expect(logged).toContain('codex')
  })

  it('forwards each of the six known RunEventChannels', () => {
    const channels: RunEvent['channel'][] = [
      'agent-output',
      'agent-error',
      'agent-exit',
      'gemini-output',
      'gemini-error',
      'gemini-exit'
    ]
    const notify = vi.fn()
    const sink = makeBridgeRunEventSink({ notifier: { notify } })
    for (const channel of channels) {
      sink.handle(sampleEvent({ channel }))
    }
    expect(notify).toHaveBeenCalledTimes(channels.length)
    const forwardedChannels = notify.mock.calls.map(
      (c) => (c[1] as { channel: string }).channel
    )
    expect(forwardedChannels).toEqual(channels)
  })
})
