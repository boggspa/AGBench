import { describe, expect, it } from 'vitest'
import {
  createRunEventRecord,
  createRunEventReplay,
  filterRunEvents,
  nextRunEventSequence,
  parseRunEventLine,
  prepareRunEventPayload,
  safeRunEventFileName,
  serializeRunEventRecord
} from './RunEventStore'
import type { RunEventRecord } from './store/types'

describe('RunEventStore', () => {
  it('creates durable schema-versioned events with stable sequence numbers', () => {
    const record = createRunEventRecord(
      {
        runId: 'run-1',
        chatId: 'chat-1',
        workspaceId: 'workspace-1',
        workspacePath: '/workspace',
        provider: 'gemini',
        kind: 'lifecycle',
        phase: 'control',
        source: 'renderer',
        summary: 'Run requested',
        payload: { requestedModel: 'flash' }
      },
      7,
      { now: '2026-05-07T00:00:00.000Z' }
    )

    expect(record.schemaVersion).toBe(1)
    expect(record.sequence).toBe(7)
    expect(record.runId).toBe('run-1')
    expect(record.timestamp).toBe('2026-05-07T00:00:00.000Z')
    expect(record.payload).toEqual({ requestedModel: 'flash' })
  })

  it('sanitizes run ids for per-run JSONL filenames', () => {
    expect(safeRunEventFileName('codex/run:1')).toBe('codex_run_1.jsonl')
    expect(safeRunEventFileName('')).toBe('unknown-run.jsonl')
  })

  it('round-trips JSONL records and ignores malformed lines', () => {
    const record = createRunEventRecord(
      {
        runId: 'run-1',
        kind: 'provider_exit',
        phase: 'raw',
        source: 'provider',
        summary: 'Exit',
        payload: { code: 0 }
      },
      1,
      { now: '2026-05-07T00:00:00.000Z' }
    )

    expect(parseRunEventLine(serializeRunEventRecord(record))).toEqual(record)
    expect(parseRunEventLine('{bad json')).toBeNull()
    expect(parseRunEventLine(JSON.stringify({ runId: 'run-1' }))).toBeNull()
  })

  it('redacts raw provider payloads when raw persistence is disabled', () => {
    const payload = prepareRunEventPayload(
      { data: 'secret-ish provider stream token=abc1234567890' },
      { rawProviderPayload: true, storeRawPayload: false }
    ) as { redacted: boolean; preview: string; byteLength: number }

    expect(payload.redacted).toBe(true)
    expect(payload.preview).toContain('secret-ish provider stream')
    expect(payload.preview).toContain('token=[REDACTED]')
    expect(payload.byteLength).toBeGreaterThan(0)
  })

  it('filters events by run, provider, kind, and sequence', () => {
    const events: RunEventRecord[] = [
      createRunEventRecord(
        { runId: 'run-1', provider: 'gemini', kind: 'lifecycle', phase: 'control', source: 'main' },
        1
      ),
      createRunEventRecord(
        {
          runId: 'run-1',
          provider: 'gemini',
          kind: 'tool',
          phase: 'normalized',
          source: 'renderer'
        },
        2
      ),
      createRunEventRecord(
        {
          runId: 'run-2',
          provider: 'codex',
          kind: 'tool',
          phase: 'normalized',
          source: 'renderer'
        },
        1
      )
    ]

    expect(filterRunEvents(events, { runId: 'run-1', kinds: ['tool'] })).toHaveLength(1)
    expect(filterRunEvents(events, { provider: 'gemini', fromSequence: 2 })).toHaveLength(1)
    expect(filterRunEvents(events, { limit: 2 }).map((event) => event.runId)).toEqual([
      'run-1',
      'run-2'
    ])
    expect(nextRunEventSequence(events.filter((event) => event.runId === 'run-1'))).toBe(3)
  })

  it('builds replay metadata for a run journal', () => {
    const events: RunEventRecord[] = [
      createRunEventRecord(
        {
          runId: 'run-1',
          kind: 'lifecycle',
          phase: 'control',
          source: 'renderer',
          payload: { status: 'starting' }
        },
        1,
        { now: '2026-05-07T00:00:00.000Z' }
      ),
      createRunEventRecord(
        {
          runId: 'run-1',
          kind: 'final_message',
          phase: 'normalized',
          source: 'renderer',
          payload: { content: 'Done' }
        },
        2,
        { now: '2026-05-07T00:00:01.000Z' }
      ),
      createRunEventRecord(
        {
          runId: 'run-1',
          kind: 'lifecycle',
          phase: 'control',
          source: 'main',
          payload: { status: 'completed' }
        },
        3,
        { now: '2026-05-07T00:00:02.000Z' }
      )
    ]

    const replay = createRunEventReplay('run-1', events)
    expect(replay.count).toBe(3)
    expect(replay.lastSequence).toBe(3)
    expect(replay.countsByKind.lifecycle).toBe(2)
    expect(replay.countsByKind.final_message).toBe(1)
    expect(replay.startedAt).toBe('2026-05-07T00:00:00.000Z')
    expect(replay.endedAt).toBe('2026-05-07T00:00:02.000Z')
  })
})
