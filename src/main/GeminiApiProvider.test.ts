import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import { tryRunGeminiApi, type GeminiApiProviderDeps } from './GeminiApiProvider'
import { AppStore } from './store'
import type { AgentRunPayload, AgentRunRoute } from './index'
import type { AppSettings, GeminiAuthProfile } from './store/types'

const userDataPath = vi.hoisted(() => `/tmp/agentbench-gemini-api-provider-test-${process.pid}`)

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
  // Phase M1 Step 3 deps (optional in tests so existing Step-2 tests
  // can omit them and still satisfy the interface — the defaults
  // disable function calling).
  mcpTools?: ReadonlyArray<{ name?: string; description?: string; inputSchema?: unknown }>
  executeMcpTool?: (
    toolName: string,
    args: unknown,
    route: AgentRunRoute | null
  ) => Promise<{ text: string; isError?: boolean }>
}): {
  deps: GeminiApiProviderDeps
  lines: SendLineCall[]
  errors: SendErrorCall[]
  exits: SendExitCall[]
  finishes: Array<{ runId: string | undefined; status: string }>
  toolCalls: Array<{ toolName: string; args: unknown; route: AgentRunRoute | null }>
} {
  const lines: SendLineCall[] = []
  const errors: SendErrorCall[] = []
  const exits: SendExitCall[] = []
  const finishes: Array<{ runId: string | undefined; status: string }> = []
  const toolCalls: Array<{ toolName: string; args: unknown; route: AgentRunRoute | null }> = []
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
    getMcpToolDefinitions: () => overrides.mcpTools || [],
    executeMcpTool: async (toolName, args, route) => {
      toolCalls.push({ toolName, args, route })
      if (overrides.executeMcpTool) {
        return overrides.executeMcpTool(toolName, args, route)
      }
      // Default: pretend the tool returned an empty success. Tests
      // that exercise the tool-calling loop will override this.
      return { text: '', isError: false }
    },
    loadSdk: overrides.loadSdk
  }
  return { deps, lines, errors, exits, finishes, toolCalls }
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
    const chunks = [{ text: 'Hello, ' }, { text: 'world!' }, { text: '', usageMetadata: usage }]
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
    const chunks = [{ candidates: [{ content: { parts: [{ text: 'from-parts' }] } }] }]
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
    // Initial no-op satisfies TS strict-null-check; the Promise constructor
    // runs synchronously so the real `resolve` is in place before we ever
    // call this through.
    let releaseSecond: () => void = () => {}
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
    releaseSecond()
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

/**
 * Phase M1 Step 3 — function calling against the AGBench MCP tool
 * surface. These tests mock the SDK + executor; they don't reach the
 * real `executeGeminiMcpTool` (covered separately by integration tests
 * in `index.ts`). The point is to pin the LOOP: model emits function
 * call → dispatch via deps.executeMcpTool → feed response back → repeat.
 */
function makeMcpTool(name: string) {
  return {
    name,
    description: `Stub tool ${name}.`,
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } }
  }
}

/** SDK fake that scripts a sequence of chunk-arrays (one inner array
 *  per `generateContentStream` call). Lets us simulate the
 *  multi-round dance: round 0 emits a functionCall, round 1 emits text.
 *  Also captures the `contents` passed on each call so tests can
 *  assert the functionResponse parts make it into the next turn. */
function scriptedSdk(rounds: any[][]): {
  loader: () => Promise<any | null>
  callsRef: Array<{ model: string; contents: any[]; config: any }>
} {
  const callsRef: Array<{ model: string; contents: any[]; config: any }> = []
  let roundIndex = 0
  const loader = async () => ({
    GoogleGenAI: class {
      models = {
        generateContentStream: async (params: any) => {
          // Deep-ish copy contents so the test can assert the snapshot
          // at call-time without later mutations clobbering it.
          callsRef.push({
            model: params.model,
            contents: JSON.parse(JSON.stringify(params.contents)),
            config: params.config
          })
          const chunks = rounds[roundIndex] || []
          roundIndex++
          return (async function* () {
            for (const chunk of chunks) yield chunk
          })()
        }
      }
    }
  })
  return { loader, callsRef }
}

describe('GeminiApiProvider (Phase M1 Step 3 — function calling)', () => {
  beforeEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true })
    fs.mkdirSync(userDataPath, { recursive: true })
  })

  it('passes function declarations on every generateContentStream call', async () => {
    const { loader, callsRef } = scriptedSdk([[{ text: 'final answer' }]])
    const { deps } = makeDeps({
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      loadSdk: loader,
      mcpTools: [makeMcpTool('read_file'), makeMcpTool('write_file')]
    })
    await tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)
    expect(callsRef).toHaveLength(1)
    const tools = callsRef[0].config?.tools
    expect(Array.isArray(tools)).toBe(true)
    expect(tools[0].functionDeclarations).toHaveLength(2)
    expect(tools[0].functionDeclarations.map((d: any) => d.name)).toEqual([
      'read_file',
      'write_file'
    ])
  })

  it('omits config.tools entirely when no MCP tools are configured', async () => {
    const { loader, callsRef } = scriptedSdk([[{ text: 'plain answer' }]])
    const { deps } = makeDeps({
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      loadSdk: loader,
      mcpTools: []
    })
    await tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)
    // Function calling disabled → no config block at all.
    expect(callsRef[0].config).toBeUndefined()
  })

  it('dispatches a function call, feeds the response back, and emits final text', async () => {
    const { loader, callsRef } = scriptedSdk([
      // Round 0: model asks to read a file.
      [
        {
          functionCalls: [{ id: 'call-1', name: 'read_file', args: { path: 'README.md' } }]
        }
      ],
      // Round 1: model emits final text after seeing the result.
      [{ text: 'Got it.' }]
    ])
    const { deps, toolCalls, lines } = makeDeps({
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      loadSdk: loader,
      mcpTools: [makeMcpTool('read_file')],
      executeMcpTool: async () => ({ text: 'file contents here', isError: false })
    })
    const ok = await tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)
    expect(ok).toBe(true)
    // Executor called exactly once with the expected name + args.
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].toolName).toBe('read_file')
    expect(toolCalls[0].args).toEqual({ path: 'README.md' })
    // Two stream calls: round 0 and round 1.
    expect(callsRef).toHaveLength(2)
    // Round 1's contents should include the model's function-call turn
    // + the user-side function-response turn.
    const round1Contents = callsRef[1].contents
    expect(round1Contents).toHaveLength(3) // initial user + model + user response
    expect(round1Contents[1].role).toBe('model')
    expect(round1Contents[1].parts[0].functionCall.name).toBe('read_file')
    expect(round1Contents[2].role).toBe('user')
    expect(round1Contents[2].parts[0].functionResponse.name).toBe('read_file')
    expect(round1Contents[2].parts[0].functionResponse.response).toEqual({
      output: 'file contents here'
    })
    // Final content event contains the model's text.
    const texts = lines
      .filter((line) => line.payload.type === 'content')
      .map((line) => line.payload.text)
    expect(texts).toEqual(['Got it.'])
  })

  it('handles multi-round tool use (two distinct tools, each fed back)', async () => {
    const { loader, callsRef } = scriptedSdk([
      [
        {
          functionCalls: [{ id: 'call-1', name: 'read_file', args: { path: 'a.txt' } }]
        }
      ],
      [
        {
          functionCalls: [
            {
              id: 'call-2',
              name: 'run_shell_command',
              args: { command: 'wc -l a.txt' }
            }
          ]
        }
      ],
      [{ text: 'Both done.' }]
    ])
    const seenTools: string[] = []
    const { deps, toolCalls } = makeDeps({
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      loadSdk: loader,
      mcpTools: [makeMcpTool('read_file'), makeMcpTool('run_shell_command')],
      executeMcpTool: async (name) => {
        seenTools.push(name)
        return { text: `result-of-${name}`, isError: false }
      }
    })
    await tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)
    expect(seenTools).toEqual(['read_file', 'run_shell_command'])
    expect(toolCalls.map((c) => c.toolName)).toEqual(['read_file', 'run_shell_command'])
    expect(callsRef).toHaveLength(3)
  })

  it('exits with an error after MAX_TOOL_ROUNDS without final text', async () => {
    // Always emit a function call → model never produces final text →
    // loop should cap out and emit an error event.
    const rounds: any[][] = []
    for (let i = 0; i < 25; i++) {
      rounds.push([
        {
          functionCalls: [{ id: `call-${i}`, name: 'read_file', args: { path: 'x' } }]
        }
      ])
    }
    const { loader } = scriptedSdk(rounds)
    const { deps, errors, exits, finishes } = makeDeps({
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      loadSdk: loader,
      mcpTools: [makeMcpTool('read_file')],
      executeMcpTool: async () => ({ text: 'ok', isError: false })
    })
    await expect(tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)).resolves.toBe(true)
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toMatch(/exceeded 20 tool-use rounds/)
    expect(exits).toEqual([{ provider: 'gemini', code: 1 }])
    expect(finishes).toEqual([{ runId: 'run-1', status: 'failed' }])
  })

  it('propagates an error-flagged tool result back as an `error` response part', async () => {
    const { loader, callsRef } = scriptedSdk([
      [
        {
          functionCalls: [{ id: 'call-1', name: 'write_file', args: { path: 'x' } }]
        }
      ],
      [{ text: 'Recovered.' }]
    ])
    const { deps } = makeDeps({
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      loadSdk: loader,
      mcpTools: [makeMcpTool('write_file')],
      executeMcpTool: async () => ({ text: 'denied by AGBench', isError: true })
    })
    await tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)
    const round1Contents = callsRef[1].contents
    expect(round1Contents[2].parts[0].functionResponse.response).toEqual({
      error: 'denied by AGBench'
    })
  })

  it('extracts function calls from candidates.parts when chunk.functionCalls is absent', async () => {
    const { loader } = scriptedSdk([
      [
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      id: 'call-1',
                      name: 'read_file',
                      args: { path: 'fallback.txt' }
                    }
                  }
                ]
              }
            }
          ]
        }
      ],
      [{ text: 'Read via fallback.' }]
    ])
    const { deps, toolCalls } = makeDeps({
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      loadSdk: loader,
      mcpTools: [makeMcpTool('read_file')],
      executeMcpTool: async () => ({ text: 'contents', isError: false })
    })
    await tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].args).toEqual({ path: 'fallback.txt' })
  })

  it('exits with 130 when the user aborts during tool execution', async () => {
    const controllerHolder: { current: AbortController | null } = { current: null }
    // Deferred promise gates the executor: the test resolves it AFTER
    // calling abort(), so the await in the tool loop unblocks into an
    // already-aborted controller and exits cleanly.
    let releaseExecutor: () => void = () => {}
    const executorPending = new Promise<void>((resolve) => {
      releaseExecutor = resolve
    })
    const { loader } = scriptedSdk([
      [
        {
          functionCalls: [{ id: 'call-1', name: 'read_file', args: { path: 'x' } }]
        }
      ],
      [{ text: 'should-not-reach' }]
    ])
    const { deps, exits, finishes, lines } = makeDeps({
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      loadSdk: loader,
      mcpTools: [makeMcpTool('read_file')],
      executeMcpTool: async () => {
        await executorPending
        return { text: 'late', isError: false }
      }
    })
    deps.runManager.attachAbortController = (_runId, c) => {
      controllerHolder.current = c as AbortController
      return undefined
    }
    const promise = tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)
    // Yield until the executor is awaiting on `executorPending`.
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    controllerHolder.current?.abort()
    releaseExecutor()
    await expect(promise).resolves.toBe(true)
    expect(exits).toEqual([{ provider: 'gemini', code: 130 }])
    expect(finishes).toEqual([{ runId: 'run-1', status: 'cancelled' }])
    // The second round's text MUST NOT have made it through.
    const texts = lines
      .filter((line) => line.payload.type === 'content')
      .map((line) => line.payload.text)
    expect(texts).not.toContain('should-not-reach')
  })

  it("converts a thrown executor into an error response (doesn't crash the loop)", async () => {
    const { loader, callsRef } = scriptedSdk([
      [
        {
          functionCalls: [{ id: 'call-1', name: 'read_file', args: { path: 'boom' } }]
        }
      ],
      [{ text: 'Caught it.' }]
    ])
    const { deps } = makeDeps({
      profiles: [makeApiKeyProfile()],
      defaultProfileId: 'profile-1',
      loadSdk: loader,
      mcpTools: [makeMcpTool('read_file')],
      executeMcpTool: async () => {
        throw new Error('something blew up')
      }
    })
    await expect(tryRunGeminiApi(stubEvent, basePayload, baseRoute, deps)).resolves.toBe(true)
    const round1Contents = callsRef[1].contents
    expect(round1Contents[2].parts[0].functionResponse.response.error).toMatch(/something blew up/)
  })
})
