/**
 * Phase M1 — GeminiApiProvider.
 *
 * Google has announced that the `gemini` CLI is being deprecated
 * (~30 days) in favour of Antigravity / `agy`, which drops the MCP/ACP
 * surfaces AGBench's Gemini integration currently relies on. To hedge,
 * this module is the entry point for an in-process Gemini runtime built
 * on the `@google/genai` SDK that coexists alongside the existing CLI
 * provider (`runGeminiProvider` in `src/main/index.ts`). Coexistence,
 * not replacement: both paths stay shippable so a regression in either
 * can be rolled back without losing the other.
 *
 * Step 1 (scaffold) landed `loadOptionalGeminiSdk` + a no-op stub.
 * Step 2 lit up bare-bones streaming:
 *   - Gating on `AppSettings.geminiApiRuntime` (auto/always/never).
 *   - Auth resolution via the active `GeminiAuthProfile` (api-key only).
 *   - SDK instantiation + `models.generateContentStream` consumption.
 *   - Streaming text deltas to the renderer via `sendAgentCompatLine`
 *     using the same `{ type: 'content', text }` envelope the existing
 *     Gemini CLI adapter already speaks (so GeminiStreamAdapter
 *     understands it unchanged).
 *   - Abort wiring through `runManager.attachAbortController` so the
 *     existing 'Stop' button cancels mid-stream.
 *   - Final `result` event carries `usageMetadata` for future Step-8
 *     quota persistence.
 *
 * Step 3 (this file) lights up function calling:
 *   - Per-turn translation of `mcpToolDefinitions()` into Gemini's
 *     `FunctionDeclaration[]` shape (see `GeminiApiToolDeclarations.ts`).
 *   - Outer round loop: stream → collect function calls → dispatch via
 *     host-side `executeGeminiMcpTool` → feed responses back → repeat.
 *   - Hard cap at MAX_TOOL_ROUNDS (20) to prevent runaway loops.
 *   - Abort is checked between rounds AND between dispatches, so a
 *     mid-tool-loop cancel exits cleanly with code 130.
 *   - Approval gates, audit events, and tool_use/tool_result emission
 *     come for free — `executeGeminiMcpTool` already handles all of
 *     those internally. We don't re-implement.
 *
 * Still TODO in later steps:
 *   - Step 4: approval gates (verified working — they're inherited).
 *   - Step 5: history replay from chat record.
 *   - Step 6: settings UI + model picker.
 *   - Step 7: image input.
 *   - Step 8: persist usageMetadata to recordUsage.
 *   - Step 9: migration banner.
 *   - vertex-ai / google-oauth profile kinds (Step 2 only handles
 *     `api-key`; other kinds fall through to the CLI path).
 *
 * IMPORTANT: do NOT import `@google/genai` at module load. The dep is
 * `optionalDependencies`-shaped (declared but may not be installed in
 * every environment, e.g. CI without the optional bucket). Use only
 * the dynamic `import()` inside `loadOptionalGeminiSdk` so typecheck
 * and bundling stay clean when the SDK is absent.
 */

import type { AgentRunPayload, AgentRunRoute } from './index'
import type { AppSettings, GeminiAuthProfile } from './store/types'
import type { RunManager, RunSessionStatus } from './RunManager'
import { buildGeminiFunctionDeclarations } from './GeminiApiToolDeclarations'

/** Hard cap on how many tool-call rounds we permit inside a single
 *  Gemini turn. Each round adds one model response + at least one tool
 *  dispatch to the conversation. A pathological loop (model keeps
 *  asking for the same tool) would otherwise spin forever. 20 is well
 *  above the natural ceiling for any sane agent task (most settle in
 *  1-5 rounds) and well below where token budgets become punitive. */
const MAX_TOOL_ROUNDS = 20

/** Shape the function-calling loop expects out of the MCP tool list
 *  and the executor. Kept narrow on purpose so `index.ts` can satisfy
 *  the contract with the existing `mcpToolDefinitions()` /
 *  `executeGeminiMcpTool` helpers without inventing a new wire format. */
export interface GeminiApiMcpToolDescriptor {
  name?: string
  description?: string
  inputSchema?: unknown
}

export interface GeminiApiMcpExecutionResult {
  text: string
  isError?: boolean
}

/**
 * Attempt to dynamically import `@google/genai`. Returns `null` if the
 * dep is absent so the caller can fall back to the CLI provider. Mirrors
 * `loadOptionalClaudeSdk` in `src/main/index.ts`. The `new Function`
 * wrapper around `import` is the same trick used there to keep bundlers
 * from statically resolving the specifier — without it, electron-vite
 * would either fail at build time or bake the missing dep into the
 * production bundle.
 */
export async function loadOptionalGeminiSdk(): Promise<any | null> {
  try {
    const importer = new Function('specifier', 'return import(specifier)') as (
      specifier: string
    ) => Promise<any>
    return await importer('@google/genai')
  } catch {
    return null
  }
}

/**
 * Dependency surface for `tryRunGeminiApi`. Lets `index.ts` pass its
 * module-local helpers in without forcing GeminiApiProvider to import
 * back from `index.ts` at runtime (which would create a circular import
 * — `index.ts` already imports this module). Also makes the function
 * trivially testable: tests inject a mock `loadSdk` that yields a
 * scripted stream + capture closures for the send/finish helpers.
 */
export interface GeminiApiProviderDeps {
  sendAgentCompatLine: (
    sender: Electron.WebContents,
    provider: 'gemini',
    payload: any,
    route?: AgentRunRoute | null
  ) => void
  sendAgentCompatError: (
    sender: Electron.WebContents,
    provider: 'gemini',
    error: string,
    route?: AgentRunRoute | null
  ) => void
  sendAgentCompatExit: (
    sender: Electron.WebContents,
    provider: 'gemini',
    code: number | null,
    route?: AgentRunRoute | null
  ) => void
  runManager: Pick<RunManager<any>, 'attachAbortController' | 'finish'>
  getSettings: () => AppSettings
  getGeminiAuthProfiles: () => GeminiAuthProfile[]
  getDefaultGeminiAuthProfileId: () => string | null
  decryptApiKey: (stored?: string | null) => string | null
  /** Phase M1 Step 3: snapshot of `mcpToolDefinitions()` from
   *  `src/main/index.ts`. Re-read at the start of each turn so a
   *  hot-reload / tool-list change picks up without restarting the
   *  app. Empty array disables function calling entirely (the model
   *  can only emit text). */
  getMcpToolDefinitions: () => ReadonlyArray<GeminiApiMcpToolDescriptor>
  /** Phase M1 Step 3: dispatch a tool call. Wraps the host-side
   *  `executeGeminiMcpTool` from `src/main/index.ts` which already
   *  handles approval gates, audit events, tool_use/tool_result
   *  emission, and durable run events. We MUST NOT re-implement any
   *  of that here — just route to the executor. */
  executeMcpTool: (
    toolName: string,
    args: unknown,
    route: AgentRunRoute | null
  ) => Promise<GeminiApiMcpExecutionResult>
  /** Optional SDK loader override; defaults to `loadOptionalGeminiSdk`.
   *  Tests pass a synthetic SDK to avoid real network calls. */
  loadSdk?: () => Promise<any | null>
}

/** Default model used when the payload doesn't specify one or specifies
 *  a CLI-flavoured placeholder (`cli-default`, `auto`, etc.). Step 6
 *  will wire the real model picker; for now this keeps the API path
 *  functional for smoke testing. The 2.0 Flash family is the cheapest
 *  generally-available API model that streams reliably. */
const DEFAULT_GEMINI_API_MODEL = 'gemini-2.0-flash'

/** Synthetic `session_id` prefix for the API path. The renderer's
 *  GeminiAdapter stores `session_id` as `linkedProviderSessionId` for
 *  later resume — but the API SDK is stateless per-request, so we mint
 *  a per-chat synthetic id rather than leaving the field empty (an
 *  empty id breaks downstream UI assumptions). The `api://` scheme
 *  makes it obvious in logs that this id is not a real provider
 *  session token. */
const API_SESSION_ID_PREFIX = 'api://'

function resolveGeminiApiModel(requested?: string | null): string {
  const trimmed = typeof requested === 'string' ? requested.trim() : ''
  if (
    !trimmed ||
    trimmed === 'cli-default' ||
    trimmed === 'auto' ||
    trimmed === 'default' ||
    trimmed === 'custom'
  ) {
    return DEFAULT_GEMINI_API_MODEL
  }
  // Aliases that match the CLI's friendly names.
  if (trimmed === 'pro') return 'gemini-2.5-pro'
  if (trimmed === 'flash') return 'gemini-2.5-flash'
  if (trimmed === 'flash-lite') return 'gemini-2.5-flash-lite'
  return trimmed
}

function syntheticApiSessionId(route: AgentRunRoute): string {
  // Prefer the chat id (stable across runs for the same chat); fall
  // back to the run id (unique per turn) so we never emit an empty
  // session id. Renderer treats both as opaque strings.
  return `${API_SESSION_ID_PREFIX}${route.appChatId || route.appRunId || 'unknown'}`
}

function selectGeminiAuthProfile(
  payload: AgentRunPayload,
  deps: GeminiApiProviderDeps
): GeminiAuthProfile | null {
  const profiles = deps.getGeminiAuthProfiles()
  if (!profiles.length) return null
  const requestedId = payload.geminiAuthProfileId || deps.getDefaultGeminiAuthProfileId()
  if (!requestedId) return null
  return profiles.find((profile) => profile.id === requestedId) || null
}

/** Extract the streaming text delta from a single `generateContentStream`
 *  chunk. The SDK exposes a `text` getter that concatenates all text
 *  parts from the first candidate; we prefer that for forward
 *  compatibility. Falls back to a manual walk of
 *  `candidates[0].content.parts` so the function doesn't break if the
 *  SDK changes the getter's behaviour. */
function chunkText(chunk: any): string {
  if (!chunk) return ''
  if (typeof chunk.text === 'string' && chunk.text) return chunk.text
  try {
    const parts = chunk.candidates?.[0]?.content?.parts
    if (Array.isArray(parts)) {
      const texts: string[] = []
      for (const part of parts) {
        if (part && typeof part.text === 'string') texts.push(part.text)
      }
      return texts.join('')
    }
  } catch {
    // Defensive: never let chunk shape weirdness crash the loop.
  }
  return ''
}

function chunkUsage(chunk: any): Record<string, number> | null {
  const usage = chunk?.usageMetadata
  if (!usage || typeof usage !== 'object') return null
  const out: Record<string, number> = {}
  for (const key of [
    'promptTokenCount',
    'candidatesTokenCount',
    'totalTokenCount',
    'cachedContentTokenCount',
    'thoughtsTokenCount',
    'toolUsePromptTokenCount'
  ]) {
    const value = usage[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value
    }
  }
  return Object.keys(out).length ? out : null
}

/** Shape of a function-call slot the model emitted during a turn. We
 *  keep `id` optional because the SDK populates it only when the model
 *  emits one (newer models do, 2.0 Flash sometimes omits it). */
interface PendingFunctionCall {
  id?: string
  name: string
  args: Record<string, unknown>
}

/** Extract any function calls from a single streamed chunk. The SDK
 *  exposes a `functionCalls` convenience getter on `GenerateContentResponse`
 *  that flattens the first candidate's `Part[]`; we prefer that for
 *  forward compatibility. Falls back to a manual walk of
 *  `candidates[0].content.parts` for older / mocked shapes. Returns an
 *  empty array when there are no calls in the chunk. */
function chunkFunctionCalls(chunk: any): PendingFunctionCall[] {
  if (!chunk) return []
  const out: PendingFunctionCall[] = []
  const fromGetter = chunk.functionCalls
  if (Array.isArray(fromGetter)) {
    for (const call of fromGetter) {
      if (call && typeof call.name === 'string') {
        out.push({
          id: typeof call.id === 'string' ? call.id : undefined,
          name: call.name,
          args:
            call.args && typeof call.args === 'object' && !Array.isArray(call.args)
              ? (call.args as Record<string, unknown>)
              : {}
        })
      }
    }
    if (out.length) return out
  }
  try {
    const parts = chunk.candidates?.[0]?.content?.parts
    if (Array.isArray(parts)) {
      for (const part of parts) {
        const call = part?.functionCall
        if (call && typeof call.name === 'string') {
          out.push({
            id: typeof call.id === 'string' ? call.id : undefined,
            name: call.name,
            args:
              call.args && typeof call.args === 'object' && !Array.isArray(call.args)
                ? (call.args as Record<string, unknown>)
                : {}
          })
        }
      }
    }
  } catch {
    // Defensive: chunk shape weirdness shouldn't crash the loop.
  }
  return out
}

/**
 * Decide whether the API path should attempt to handle this run, given
 * the user's `geminiApiRuntime` setting + the selected auth profile.
 *
 *   - `never`: always return false (CLI only).
 *   - `auto` : run when an api-key profile is selected, else fall back.
 *   - `always`: run regardless; downstream resolveAuth may still bail.
 *
 * vertex-ai and google-oauth profile kinds are intentionally NOT
 * supported in Step 2 — they need additional auth wiring that lives
 * in later steps. When such a profile is selected we fall through to
 * the CLI even under `always` (the CLI already handles those modes).
 */
export function shouldAttemptGeminiApi(
  payload: AgentRunPayload,
  deps: GeminiApiProviderDeps
): { attempt: boolean; reason?: string } {
  const settings = deps.getSettings()
  const mode = settings.geminiApiRuntime || 'auto'
  if (mode === 'never') {
    return { attempt: false, reason: 'geminiApiRuntime=never' }
  }
  const profile = selectGeminiAuthProfile(payload, deps)
  if (mode === 'auto') {
    if (!profile) return { attempt: false, reason: 'no profile selected' }
    if (profile.kind !== 'api-key') {
      return { attempt: false, reason: `profile kind ${profile.kind} not supported yet` }
    }
    if (!profile.encryptedApiKey) {
      return { attempt: false, reason: 'profile has no api key' }
    }
    return { attempt: true }
  }
  // mode === 'always'
  if (profile && profile.kind !== 'api-key') {
    // Step 2 can't honour vertex/oauth profiles; defer to CLI even
    // under `always` so the user doesn't see hard failures.
    return { attempt: false, reason: `profile kind ${profile.kind} not supported yet` }
  }
  return { attempt: true }
}

/**
 * Attempt to run a Gemini turn via the API SDK path. Returns `true`
 * when the function took ownership of the run (success or handled
 * error) — caller must NOT then fall through to the CLI. Returns
 * `false` only when the API path declined to handle the run before
 * touching the event stream; the caller is free to invoke the CLI
 * provider in that case.
 *
 * Step 3 scope:
 *   - Single user-turn prompt; no history replay (Step 5).
 *   - Text + tool-call rounds streamed out.
 *   - Function calling via AGBench MCP tools (Step 3 — this file).
 *   - Approval gates inherited from `executeGeminiMcpTool`.
 *   - No image input (Step 7).
 *   - usageMetadata emitted on `result` event but not yet persisted to
 *     `recordUsage` (Step 8).
 */
export async function tryRunGeminiApi(
  event: Electron.IpcMainInvokeEvent,
  payload: AgentRunPayload,
  route: AgentRunRoute | null,
  deps: GeminiApiProviderDeps
): Promise<boolean> {
  const normalizedRoute: AgentRunRoute = route || {}
  const gating = shouldAttemptGeminiApi(payload, deps)
  if (!gating.attempt) return false

  // Resolve auth: only api-key in Step 2.
  const profile = selectGeminiAuthProfile(payload, deps)
  if (!profile || profile.kind !== 'api-key') {
    return false
  }
  const apiKey = deps.decryptApiKey(profile.encryptedApiKey)
  if (!apiKey) {
    // Profile exists but the key didn't decrypt (likely safeStorage
    // unavailability). Surface a useful error instead of silently
    // falling back so the user knows their profile is misconfigured.
    deps.sendAgentCompatError(
      event.sender,
      'gemini',
      `Gemini API profile "${profile.label}" has no usable API key; check Settings.`,
      normalizedRoute
    )
    deps.sendAgentCompatExit(event.sender, 'gemini', 1, normalizedRoute)
    deps.runManager.finish(normalizedRoute.appRunId, 'failed' as RunSessionStatus)
    return true
  }

  // Load SDK (allow test override).
  const sdk = await (deps.loadSdk || loadOptionalGeminiSdk)()
  const GoogleGenAI = sdk?.GoogleGenAI || sdk?.default?.GoogleGenAI
  if (typeof GoogleGenAI !== 'function') {
    // SDK missing in this environment — defer to CLI.
    return false
  }

  // Set up cancellation: bind an AbortController to the run so the
  // existing 'Stop' button (which routes through runManager.cancel)
  // aborts the stream mid-flight. Mirrors tryRunClaudeSdk's pattern.
  const controller = new AbortController()
  if (normalizedRoute.appRunId) {
    deps.runManager.attachAbortController(normalizedRoute.appRunId, controller)
  }

  const model = resolveGeminiApiModel(payload.model)
  const sessionId = syntheticApiSessionId(normalizedRoute)

  // Emit `init` so the renderer's GeminiAdapter starts the run.
  deps.sendAgentCompatLine(
    event.sender,
    'gemini',
    {
      type: 'init',
      session_id: sessionId,
      model,
      timestamp: new Date().toISOString(),
      provider: 'gemini',
      runtime: 'api-sdk',
      fallback: false
    },
    normalizedRoute
  )

  let client: any
  try {
    client = new GoogleGenAI({ apiKey })
  } catch (error) {
    const message = `Failed to initialise Gemini API client: ${error instanceof Error ? error.message : String(error)}`
    deps.sendAgentCompatError(event.sender, 'gemini', message, normalizedRoute)
    deps.sendAgentCompatExit(event.sender, 'gemini', 1, normalizedRoute)
    deps.runManager.finish(normalizedRoute.appRunId, 'failed' as RunSessionStatus)
    return true
  }

  // Build the single-turn contents. History replay is Step 5.
  const contents: any[] = [{ role: 'user', parts: [{ text: payload.prompt }] }]

  // Phase M1 Step 3: function-calling tool declarations.
  // Translate the AGBench MCP tool surface into Gemini's FunctionDeclaration
  // shape ONCE per run (the tool list is stable across rounds, and the
  // converter is pure so the cost is trivial anyway). Empty array
  // disables function calling — model can only emit text.
  const mcpTools = deps.getMcpToolDefinitions()
  const functionDeclarations = mcpTools.length ? buildGeminiFunctionDeclarations(mcpTools) : []
  const generateConfig =
    functionDeclarations.length > 0 ? { tools: [{ functionDeclarations }] } : undefined

  const startedAt = Date.now()
  let lastUsage: Record<string, number> | null = null
  let aborted = false

  // Phase M1 Step 3: outer round loop. Each iteration consumes one
  // model response stream. If the model emits function calls, we
  // dispatch them, append the `model` turn (with the calls) and a
  // `user` turn (with the responses) to `contents`, and continue. We
  // exit the loop when:
  //   - A round produces no function calls (= final answer).
  //   - The user cancels mid-stream (aborted = true).
  //   - We hit MAX_TOOL_ROUNDS (runaway tool-use guard).
  // The cap is intentionally generous; sane agent loops settle in
  // 1-5 rounds. We surface an error event on cap-hit rather than
  // silently emitting partial output, so the user sees something
  // actionable in the chat.
  let round = 0
  for (; round < MAX_TOOL_ROUNDS; round++) {
    if (controller.signal.aborted) {
      aborted = true
      break
    }

    const pendingFunctionCalls: PendingFunctionCall[] = []
    try {
      const stream = await client.models.generateContentStream(
        generateConfig ? { model, contents, config: generateConfig } : { model, contents }
      )
      for await (const chunk of stream) {
        if (controller.signal.aborted) {
          aborted = true
          break
        }
        const text = chunkText(chunk)
        if (text) {
          deps.sendAgentCompatLine(
            event.sender,
            'gemini',
            { type: 'content', text, provider: 'gemini' },
            normalizedRoute
          )
        }
        const calls = chunkFunctionCalls(chunk)
        if (calls.length) {
          for (const call of calls) pendingFunctionCalls.push(call)
        }
        const usage = chunkUsage(chunk)
        if (usage) lastUsage = usage
      }
    } catch (error) {
      if (controller.signal.aborted) {
        aborted = true
      } else {
        const message = `Gemini API stream failed: ${error instanceof Error ? error.message : String(error)}`
        deps.sendAgentCompatError(event.sender, 'gemini', message, normalizedRoute)
        deps.sendAgentCompatExit(event.sender, 'gemini', 1, normalizedRoute)
        deps.runManager.finish(normalizedRoute.appRunId, 'failed' as RunSessionStatus)
        return true
      }
    }

    if (aborted) break

    // No function calls this round → model emitted its final answer.
    if (pendingFunctionCalls.length === 0) break

    // Dispatch each pending function call through the host-side
    // executor and accumulate the response parts for the next turn.
    // `executeGeminiMcpTool` (via deps.executeMcpTool) already emits
    // tool_use + tool_result events and handles approval gates, so
    // we just relay the result back to the model. We DO NOT emit
    // additional tool_use / tool_result here — that would double-up
    // in the renderer.
    const modelParts: any[] = pendingFunctionCalls.map((call) => ({
      functionCall: {
        ...(call.id ? { id: call.id } : {}),
        name: call.name,
        args: call.args
      }
    }))
    const responseParts: any[] = []
    for (const call of pendingFunctionCalls) {
      // Re-check abort BEFORE each dispatch so a cancel mid-tool-loop
      // (e.g. user clicked Stop while the executor is awaiting an
      // approval modal) exits cleanly without spinning through every
      // queued call. The executor itself may take a long time when
      // it's gated on user approval.
      if (controller.signal.aborted) {
        aborted = true
        break
      }
      let result: GeminiApiMcpExecutionResult
      try {
        result = await deps.executeMcpTool(call.name, call.args, normalizedRoute)
      } catch (error) {
        // Defensive: a thrown executor never happens in production
        // (executeGeminiMcpTool catches everything), but tests and
        // future refactors could regress this. Convert to an error
        // result so the loop can still feed something back to the
        // model rather than dying mid-turn.
        result = {
          text: `Tool execution threw: ${error instanceof Error ? error.message : String(error)}`,
          isError: true
        }
      }
      // Also re-check after each dispatch — the user could have
      // cancelled WHILE the executor was awaiting (long-running
      // shells, approval modals, etc.).
      if (controller.signal.aborted) {
        aborted = true
        break
      }
      // Gemini expects `response` to be a JSON object, not a raw
      // string. Wrap the text + error flag in a small object so the
      // model can disambiguate. The exact key (`output` for success,
      // `error` for failure) follows Gemini's published convention.
      const responseObject: Record<string, unknown> = result.isError
        ? { error: result.text }
        : { output: result.text }
      responseParts.push({
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name: call.name,
          response: responseObject
        }
      })
    }

    if (aborted) break

    contents.push({ role: 'model', parts: modelParts })
    contents.push({ role: 'user', parts: responseParts })
    // Loop continues — next iteration calls generateContentStream
    // with the updated contents.
  }

  if (aborted) {
    // 130 = 128 + SIGINT; matches the convention CLI-killed runs use
    // so the renderer's "Stopped" treatment kicks in.
    deps.sendAgentCompatExit(event.sender, 'gemini', 130, normalizedRoute)
    deps.runManager.finish(normalizedRoute.appRunId, 'cancelled' as RunSessionStatus)
    return true
  }

  // Cap exhausted without the model producing a final text-only
  // response → emit an actionable error rather than pretending success.
  // We still emit the result event so the renderer can render
  // duration / partial stats, but with status:error + a useful
  // message in the error stream.
  if (round >= MAX_TOOL_ROUNDS) {
    const message = `Gemini API: model exceeded ${MAX_TOOL_ROUNDS} tool-use rounds without producing a final answer (possible loop).`
    deps.sendAgentCompatError(event.sender, 'gemini', message, normalizedRoute)
    deps.sendAgentCompatExit(event.sender, 'gemini', 1, normalizedRoute)
    deps.runManager.finish(normalizedRoute.appRunId, 'failed' as RunSessionStatus)
    return true
  }

  // Final `result` event carries the usage block so future Step 8
  // can scrape it without re-listening to the entire stream. Stats
  // mirror the Claude SDK path's shape (duration_ms + token counts).
  deps.sendAgentCompatLine(
    event.sender,
    'gemini',
    {
      type: 'result',
      status: 'success',
      stats: {
        ...(lastUsage || {}),
        duration_ms: Date.now() - startedAt
      },
      provider: 'gemini',
      runtime: 'api-sdk',
      providerThreadId: sessionId,
      fallback: false
    },
    normalizedRoute
  )
  deps.sendAgentCompatExit(event.sender, 'gemini', 0, normalizedRoute)
  deps.runManager.finish(normalizedRoute.appRunId, 'completed' as RunSessionStatus)
  return true
}
