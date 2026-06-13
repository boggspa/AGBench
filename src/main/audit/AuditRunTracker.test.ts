import { describe, expect, it } from 'vitest'
import { AuditRunTracker, tokensFromStats } from './AuditRunTracker'

describe('tokensFromStats', () => {
  it('prefers an explicit total', () => {
    expect(tokensFromStats({ total_tokens: 500, input_tokens: 100, output_tokens: 50 })).toBe(500)
    expect(tokensFromStats({ totalTokens: 42 })).toBe(42)
  })
  it('falls back to input + output', () => {
    expect(tokensFromStats({ input_tokens: 100, output_tokens: 50 })).toBe(150)
    expect(tokensFromStats({ inputTokens: 7 })).toBe(7)
  })
  it('returns undefined when nothing is present', () => {
    expect(tokensFromStats(undefined)).toBeUndefined()
    expect(tokensFromStats({})).toBeUndefined()
  })
})

describe('AuditRunTracker', () => {
  const trackerWithClock = () => {
    let t = 1000
    const tracker = new AuditRunTracker({ nowMs: () => t })
    return { tracker, advance: (ms: number) => (t += ms) }
  }

  it('settles on the result event with tokens, cost, and duration from stats', async () => {
    const { tracker } = trackerWithClock()
    const promise = tracker.track('run-1')
    expect(tracker.isTracked('run-1')).toBe(true)
    tracker.handleProviderOutput('run-1', {
      type: 'result',
      stats: { total_tokens: 1200, cost_usd: 0.03, duration_ms: 4500 }
    })
    const outcome = await promise
    expect(outcome).toEqual({
      runId: 'run-1',
      ok: true,
      tokens: 1200,
      costUsd: 0.03,
      durationMs: 4500
    })
    // No longer tracked once settled.
    expect(tracker.isTracked('run-1')).toBe(false)
  })

  it('accumulates assistant content and returns it as finalText on result', async () => {
    const { tracker } = trackerWithClock()
    const promise = tracker.track('run-report')
    tracker.handleProviderOutput('run-report', { type: 'content', text: '# Audit report\n' })
    tracker.handleProviderOutput('run-report', { type: 'content', text: '\nFinding details.' })
    tracker.handleProviderOutput('run-report', { type: 'result', stats: { total_tokens: 25 } })
    const outcome = await promise
    expect(outcome.ok).toBe(true)
    expect(outcome.finalText).toBe('# Audit report\n\nFinding details.')
  })

  it('handles cumulative assistant content without duplicating text', async () => {
    const { tracker } = trackerWithClock()
    const promise = tracker.track('run-cumulative')
    tracker.handleProviderOutput('run-cumulative', { type: 'content', text: 'Alpha' })
    tracker.handleProviderOutput('run-cumulative', {
      type: 'content',
      text: 'Alpha beta',
      cumulative: true
    })
    tracker.handleExit('run-cumulative', 0)
    const outcome = await promise
    expect(outcome.finalText).toBe('Alpha beta')
  })

  it('computes durationMs from the clock when stats omit it', async () => {
    const { tracker, advance } = trackerWithClock()
    const promise = tracker.track('run-2')
    advance(2500)
    tracker.handleProviderOutput('run-2', { type: 'result', stats: { totalTokens: 10 } })
    const outcome = await promise
    expect(outcome.durationMs).toBe(2500)
    expect(outcome.tokens).toBe(10)
    expect(outcome.costUsd).toBeUndefined()
  })

  it('marks a failed result as ok:false with an error', async () => {
    const { tracker } = trackerWithClock()
    const promise = tracker.track('run-3')
    tracker.handleProviderOutput('run-3', { type: 'result', status: 'failed' })
    const outcome = await promise
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('audit role-run reported a failed result')
  })

  it('settles via exit when no result arrives (clean exit → ok)', async () => {
    const { tracker, advance } = trackerWithClock()
    const promise = tracker.track('run-4')
    advance(800)
    tracker.handleExit('run-4', 0)
    const outcome = await promise
    expect(outcome).toEqual({ runId: 'run-4', ok: true, durationMs: 800 })
  })

  it('settles via exit with a failure on a non-zero code', async () => {
    const { tracker } = trackerWithClock()
    const promise = tracker.track('run-5')
    tracker.handleExit('run-5', 137)
    const outcome = await promise
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('provider exited with code 137')
  })

  it('resolves exactly once — a result wins and a later exit is a no-op', async () => {
    const { tracker } = trackerWithClock()
    let resolutions = 0
    const promise = tracker.track('run-6').then((o) => {
      resolutions += 1
      return o
    })
    tracker.handleProviderOutput('run-6', { type: 'result', stats: { total_tokens: 5 } })
    tracker.handleExit('run-6', 1) // must NOT override the successful result
    const outcome = await promise
    await Promise.resolve()
    expect(resolutions).toBe(1)
    expect(outcome.ok).toBe(true)
    expect(outcome.tokens).toBe(5)
  })

  it('ignores events for untracked runs and non-result output', async () => {
    const { tracker } = trackerWithClock()
    // No throw for unknown runs.
    expect(() => tracker.handleProviderOutput('ghost', { type: 'result' })).not.toThrow()
    expect(() => tracker.handleExit('ghost', 0)).not.toThrow()
    // A tracked run ignores non-result output and stays open.
    const promise = tracker.track('run-7')
    tracker.handleProviderOutput('run-7', { type: 'content', text: 'hi' })
    tracker.handleProviderOutput('run-7', { type: 'tool_use' })
    expect(tracker.isTracked('run-7')).toBe(true)
    tracker.handleExit('run-7', 0)
    expect((await promise).ok).toBe(true)
  })
})
