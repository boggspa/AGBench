import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import { tryRunGeminiApi } from './GeminiApiProvider'
import { AppStore } from './store'
import type { AgentRunPayload, AgentRunRoute } from './index'

const userDataPath = vi.hoisted(() => `/tmp/agentbench-gemini-api-provider-test-${process.pid}`)

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataPath
  }
}))

describe('GeminiApiProvider scaffold (Phase M1 Step 1)', () => {
  beforeEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true })
    fs.mkdirSync(userDataPath, { recursive: true })
  })

  it('tryRunGeminiApi returns false for any input (no-op scaffold)', async () => {
    // Step 1 is intentionally a stub: every call must return false so
    // `runGeminiProvider` falls through to the existing CLI path. When
    // Step 2 wires the real implementation, this test will tighten.
    const stubEvent = {
      sender: { send: () => undefined }
    } as unknown as Electron.IpcMainInvokeEvent
    const payload: AgentRunPayload = {
      provider: 'gemini',
      scope: 'workspace',
      prompt: 'test prompt'
    }
    const route: AgentRunRoute = { appRunId: 'test-run-id' }

    await expect(tryRunGeminiApi(stubEvent, payload, route)).resolves.toBe(false)
  })

  it('AppSettings.geminiApiRuntime defaults to "auto" on fresh install', () => {
    // No stored settings file — getSettings should yield the default.
    const settings = AppStore.getSettings()
    expect(settings.geminiApiRuntime).toBe('auto')
  })
})
