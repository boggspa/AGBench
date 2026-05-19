import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import { tryRunGeminiApi, type GeminiApiProviderDeps } from './GeminiApiProvider'
import { AppStore } from './store'
import type { AgentRunPayload, AgentRunRoute } from './index'
import type { AppSettings, GeminiAuthProfile } from './store/types'

const userDataPath = vi.hoisted(
  () => `/tmp/agentbench-gemini-api-provider-test-${process.pid}`
)

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataPath
  }
}))

// Lightweight assertions about the event stream the provider emits.
// Tests use a single shared `sender` stub plus capture closures wired
// through `deps` so they can introspect the calls without spinning up
// a real WebContents.
type SendLineCall = {
  provider: string
  payload: any
  route: AgentRunRoute | null | undefined
}
type SendErrorCall = { provider: string; error: string }
type SendExitCall = { provider: string; code: number | null }

function makeDeps(overrides: {
  settings?: Partial<AppSettings>
  profiles?: GeminiAuthProfile[]
  defaultProfileId?: string | null
  decrypt?: (stored?: string | null) => string | null
  loadSdk?: () => Promise<any | null>
}): {
  deps: GeminiApiProviderDeps
  lines: SendLineCall[]
  errors: SendErrorCall[]
  exits: SendExitCall[]
  finishes: Array<{ runId: string | undefined; status: string }>
} {
  const lines: SendLineCall[] = []
  const errors: SendErrorCall[] = []
  const exits: SendExitCall[] = []
  const finishes: Array<{ runId: string | undefined; status: string }> = []
  const baseSettings: AppSettings = {
    geminiApiRuntime: 'auto',
    geminiAuthProfiles: overrides.profiles || [],
    defaultGeminiAuthProfileId: overrides.defaultProfileId ?? null,
    // Fields below are required by AppSettings but not consumed by the
    // provider; pick safe defaults so we don't have to import the full
    // default settings object.
    storeLocalChatHistory: true,
    storeRawEvents: false,
    storePromptResponseInUsage: false,
    geminiCheckpointingEnabled: false,
    chatContextTurns: 6,
    appearanceMode: 'soft_glass',
    visualEffectStyle: 'auto',
    themeAppearance: 'system',
    themeCornerStyle: 'rounded',
    themeAccentStyle: 'system',
    promptSurfaceStyle: 'liquid_glass',
    composerStyle: 'default',
    funFxEnabled: false,
    funFxMode: 'cinematic',
    advancedFx: {
      agentAura: false,
      livingWorkspace: false,
      dataViz: false,
      intensity: 'cinematic'
    },
    reduceTransparency: false,
    reduceMotion: false,
    compactDensity: false,
    showInspector: false,
    inspectorWidth: 380,
    sidebarWidth: 260,
    ...(overrides.settings || {})
  } as AppSettings

  const deps: GeminiApiProviderDeps = {
    sendAgentCompatLine: (_sender, provider, payload, route) => {
      lines.push({ provider, payload, route })
    },
    sendAgentCompatError: (_sender, provider, error) => {
      errors.push({ provider, error })
    },
    sendAgentCompatExit: (_sender, provider, code) => {
      exits.push({ provider, code })
    },
    runManager: {
      attachAbortController: () => undefined,
      finish: (runId, status) => {
        finishes.push({ runId, status })
        return undefined
      }
    },
    getSettings: () => baseSettings,
    getGeminiAuthProfiles: () => overrides.profiles || [],
    getDefaultGeminiAuthProfileId: () => overrides.defaultProfileId ?? null,
    decryptApiKey: overrides.decrypt ?? ((stored) => (stored ? `decrypted:${stored}` : null)),
    loadSdk: overrides.loadSdk
  }
  return { deps, lines, errors, exits, finishes }
}

function makeApiKeyProfile(overrides: Partial<GeminiAuthProfile> = {}): GeminiAuthProfile {
  return {
    id: 'profile-1',
    label: 'Default',
    kind: 'api-key',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    encryptedApiKey: 'encrypted-key',
    ...overrides
  }
}

const stubEvent = {
  sender: { send: () => undefined }
} as unknown as Electron.IpcMainInvokeEvent

const basePayload: AgentRunPayload = {
  provider: 'gemini',
  scope: 'workspace',
  prompt: 'Hello Gemini',
  workspace: '/tmp/workspace',
  appRunId: 'run-1',
  appChatId: 'chat-1'
}
const baseRoute: AgentRunRoute = { appRunId: 'run-1', appChatId: 'chat-1' }

/** Build a fake @google/genai SDK that yields the provided chunks. */
function fakeSdk(chunks: any[], options: { throwOn?: 'init' | 'stream' } = {}) {
  let constructed = 0
  const generator = async function* () {
    for (const chunk of chunks) {
      yield chunk
    }
  }
  return async () => ({
    GoogleGenAI: class FakeClient {
      models: any
      constructor() {
        constructed++
        if (options.throwOn === 'init') throw new Error('init failed')
        this.models = {
          generateContentStream: async () => {
            if (options.throwOn === 'stream') throw new Error('stream failed')
            return generator()
          }
        }
      }
      static get instanceCount() {
        return constructed
      }
    }
  })
}

describe('GeminiApiProvider (Phase M1 Step 2)', () => {
  beforeEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true })
    fs.mkdirSync(userDataPath, { recursive: true })
  })

  it('AppSettings.geminiApiRuntime defaults to "auto" on fresh install', () => {
    const settings = AppStore.getSettings()
    expect(settings.geminiApiRuntime).toBe('auto')
  })

  it('returns false when geminiApiRuntime is "never"', async () => {
    const { deps, lines, exits } = makeDeps({
      settings: { geminiApiRuntime: 'never' },
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      loadSdk: fakeSdk([{ text: 'should not be reached' }])
    })
    await expect(tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)).resolves.toBe(false)
    expect(lines).toEqual([])
    expect(exits).toEqual([])
  })

  it('returns false when no auth profile is selected in auto mode', async () => {
    const { deps, lines, exits } = makeDeps({
      profiles: [],
      defaultProfileId: null,
      loadSdk: fakeSdk([{ text: 'unused' }])
    })
    await expect(tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)).resolves.toBe(false)
    expect(lines).toEqual([])
    expect(exits).toEqual([])
  })

  it('returns false for non-api-key profile kinds (Step 2 only handles api-key)', async () => {
    const { deps } = makeDeps({
      profiles: [makeApiKeyProfile({ kind: 'vertex-ai' })],
      defaultProfileId: 'profile-1',
      loadSdk: fakeSdk([{ text: 'unused' }])
    })
    await expect(tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)).resolves.toBe(false)
  })

  it('returns false when SDK load fails', async () => {
    const { deps, lines, errors } = makeDeps({
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      loadSdk: async () => null
    })
    await expect(tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)).resolves.toBe(false)
    // No init emitted yet because we bail before constructing the client.
    expect(lines).toEqual([])
    expect(errors).toEqual([])
  })

  it('streams text chunks as content events and emits init + result + exit', async () => {
    const usage = {
      promptTokenCount: 4,
      candidatesTokenCount: 7,
      totalTokenCount: 11
    }
    const chunks = [
      { text: 'Hello, ' },
      { text: 'world!' },
      { text: '', usageMetadata: usage }
    ]
    const { deps, lines, errors, exits, finishes } = makeDeps({
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      loadSdk: fakeSdk(chunks)
    })
    await expect(tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)).resolves.toBe(true)

    const events = lines.map((line) => line.payload)
    const initEvent = events[0]
    expect(initEvent.type).toBe('init')
    expect(initEvent.session_id).toBe('api://chat-1')
    expect(initEvent.runtime).toBe('api-sdk')
    expect(typeof initEvent.model).toBe('string')

    const contents = events.filter((event) => event.type === 'content')
    expect(contents.map((event) => event.text)).toEqual(['Hello, ', 'world!'])
    contents.forEach((event) => expect(event.provider).toBe('gemini'))

    const result = events.find((event) => event.type === 'result')
    expect(result).toBeDefined()
    expect(result.status).toBe('success')
    expect(result.stats.promptTokenCount).toBe(4)
    expect(result.stats.candidatesTokenCount).toBe(7)
    expect(result.stats.totalTokenCount).toBe(11)
    expect(typeof result.stats.duration_ms).toBe('number')
    expect(result.providerThreadId).toBe('api://chat-1')

    expect(errors).toEqual([])
    expect(exits).toEqual([{ provider: 'gemini', code: 0 }])
    expect(finishes).toEqual([{ runId: 'run-1', status: 'completed' }])
  })

  it('extracts text from candidates.parts when chunk.text is empty', async () => {
    const chunks = [
      { candidates: [{ content: { parts: [{ text: 'from-parts' }] } }] }
    ]
    const { deps, lines } = makeDeps({
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      loadSdk: fakeSdk(chunks)
    })
    await tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)
    const contentTexts = lines
      .filter((line) => line.payload.type === 'content')
      .map((line) => line.payload.text)
    expect(contentTexts).toEqual(['from-parts'])
  })

  it('surfaces an error and finishes "failed" when stream throws', async () => {
    const { deps, errors, exits, finishes } = makeDeps({
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      loadSdk: fakeSdk([], { throwOn: 'stream' })
    })
    await expect(tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)).resolves.toBe(true)
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toMatch(/Gemini API stream failed/i)
    expect(exits).toEqual([{ provider: 'gemini', code: 1 }])
    expect(finishes).toEqual([{ runId: 'run-1', status: 'failed' }])
  })

  it('surfaces an error and finishes "failed" when client construction throws', async () => {
    const { deps, errors, exits, finishes } = makeDeps({
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      loadSdk: fakeSdk([], { throwOn: 'init' })
    })
    await expect(tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)).resolves.toBe(true)
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toMatch(/Failed to initialise Gemini API client/i)
    expect(exits).toEqual([{ provider: 'gemini', code: 1 }])
    expect(finishes).toEqual([{ runId: 'run-1', status: 'failed' }])
  })

  it('emits a useful error when the api key fails to decrypt', async () => {
    const { deps, errors, exits, finishes } = makeDeps({
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      decrypt: () => null,
      loadSdk: fakeSdk([{ text: 'unused' }])
    })
    await expect(tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)).resolves.toBe(true)
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toMatch(/no usable API key/i)
    expect(exits).toEqual([{ provider: 'gemini', code: 1 }])
    expect(finishes).toEqual([{ runId: 'run-1', status: 'failed' }])
  })

  it('honours an in-flight abort by exiting 130 and finishing "cancelled"', async () => {
    // Capture the controller wired through runManager so the test can
    // abort it mid-stream. Yields one chunk, then waits a microtask so
    // the for-await loop checks signal.aborted before pulling the next.
    const controllerHolder: { current: AbortController | null } = { current: null }
    // Gate the generator on a deferred promise: the test resolves it
    // AFTER calling abort(), so the for-await loop pulls the second
    // chunk only once the signal is already aborted (matching how a
    // real SDK suspends between server responses).
    let releaseSecond: (() => void) | null = null
    const secondReady = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    const generator = async function* () {
      yield { text: 'partial' }
      await secondReady
      yield { text: 'should-not-stream' }
    }
    const sdk = async () => ({
      GoogleGenAI: class {
        models = {
          generateContentStream: async () => generator()
        }
      }
    })
    const { deps, exits, finishes, lines } = makeDeps({
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      loadSdk: sdk
    })
    deps.runManager.attachAbortController = (_runId, c) => {
      controllerHolder.current = c as AbortController
      return undefined
    }
    const promise = tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)
    // Let the first chunk stream through, then abort + release the
    // gate so the loop wakes up, observes signal.aborted, and bails.
    await new Promise((resolve) => setImmediate(resolve))
    controllerHolder.current?.abort()
    releaseSecond?.()
    await expect(promise).resolves.toBe(true)
    expect(exits).toEqual([{ provider: 'gemini', code: 130 }])
    expect(finishes).toEqual([{ runId: 'run-1', status: 'cancelled' }])
    // Ensure the "should-not-stream" chunk never reached the renderer.
    const contentTexts = lines
      .filter((line) => line.payload.type === 'content')
      .map((line) => line.payload.text)
    expect(contentTexts).not.toContain('should-not-stream')
  })
})
