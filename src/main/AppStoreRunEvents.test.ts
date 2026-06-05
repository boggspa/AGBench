import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import { join } from 'path'
import { AppStore } from './store'

const userDataPath = vi.hoisted(() => `/tmp/taskwraith-run-events-test-${process.pid}`)

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataPath
  }
}))

describe('AppStore run events', () => {
  beforeEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true })
    fs.mkdirSync(userDataPath, { recursive: true })
  })

  it('does not persist provider stream artifacts when raw events are disabled', () => {
    const record = AppStore.appendRunEvent({
      runId: 'run-raw-off',
      provider: 'gemini',
      kind: 'provider_raw',
      phase: 'raw',
      source: 'provider',
      payload: { data: 'secret-ish provider stream token=abc1234567890\n' }
    })

    expect(record.artifacts).toBeUndefined()
    expect(record.payload).toMatchObject({
      redacted: true
    })
    expect(fs.existsSync(join(userDataPath, 'run-artifacts', 'run-raw-off', 'stdout.log'))).toBe(
      false
    )
  })

  it('persists provider stream artifacts when raw events are enabled', () => {
    AppStore.updateSettings({ storeRawEvents: true })

    const record = AppStore.appendRunEvent({
      runId: 'run-raw-on',
      provider: 'gemini',
      kind: 'provider_raw',
      phase: 'raw',
      source: 'provider',
      payload: { data: 'provider stream persisted\n' }
    })

    expect(record.artifacts).toHaveLength(1)
    expect(record.artifacts?.[0]).toMatchObject({
      kind: 'stdout',
      path: 'run-raw-on/stdout.log'
    })
    expect(
      fs.readFileSync(join(userDataPath, 'run-artifacts', 'run-raw-on', 'stdout.log'), 'utf8')
    ).toBe('provider stream persisted\n')
  })
})
