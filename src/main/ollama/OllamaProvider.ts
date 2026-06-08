import { buildProviderCapabilityContract } from '../ProviderCapabilities'
import type { AgentRunPayload, AgentRunRoute } from '../run/AgentRunTypes'
import type { RunManager, RunSessionStatus } from '../RunManager'
import type { AppSettings, ProviderCapabilityContract } from '../store/types'

export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'

export interface OllamaModelInfo {
  id: string
  label: string
  description?: string
  isDefault?: boolean
  contextLength?: number
  parameterSize?: string
  quantizationLevel?: string
  capabilities?: string[]
}

export interface OllamaStatusSnapshot {
  available: boolean
  setupRequired: boolean
  baseUrl: string
  modelCount: number
  defaultModel?: string
  models?: OllamaModelInfo[]
  error?: string
}

export interface OllamaProviderDeps {
  getSettings: () => Pick<AppSettings, 'ollamaBaseUrl' | 'ollamaDefaultModel' | 'agenticServices' | 'geminiMcpBridgeEnabled' | 'codexSandboxFallback'>
  sendAgentCompatLine: (
    sender: Electron.WebContents,
    provider: 'ollama',
    payload: any,
    route?: AgentRunRoute | null
  ) => void
  sendAgentCompatError: (
    sender: Electron.WebContents,
    provider: 'ollama',
    error: string,
    route?: AgentRunRoute | null
  ) => void
  sendAgentCompatExit: (
    sender: Electron.WebContents,
    provider: 'ollama',
    code: number | null,
    route?: AgentRunRoute | null
  ) => void
  runManager: Pick<RunManager<any>, 'attachAbortController' | 'finish'>
  emitProviderCapabilityWarnings?: (
    sender: Electron.WebContents,
    provider: 'ollama',
    workspacePath: string | undefined,
    approvalMode: string | undefined,
    route?: AgentRunRoute | null,
    options?: { excludeIds?: string[] }
  ) => Promise<void>
}

interface OllamaTagsResponse {
  models?: Array<{
    name?: string
    model?: string
    size?: number
    details?: {
      parameter_size?: string
      quantization_level?: string
      context_length?: number
    }
    capabilities?: string[]
  }>
}

type OllamaTagModel = NonNullable<OllamaTagsResponse['models']>[number]

interface OllamaChatChunk {
  model?: string
  created_at?: string
  message?: {
    role?: string
    content?: string
  }
  done?: boolean
  error?: string
  prompt_eval_count?: number
  eval_count?: number
  total_duration?: number
  load_duration?: number
  prompt_eval_duration?: number
  eval_duration?: number
}

export function normalizeOllamaBaseUrl(value?: string | null): string {
  const raw = String(value || '').trim() || DEFAULT_OLLAMA_BASE_URL
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_OLLAMA_BASE_URL
    url.pathname = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return DEFAULT_OLLAMA_BASE_URL
  }
}

function endpoint(baseUrl: string | undefined | null, path: string): string {
  return `${normalizeOllamaBaseUrl(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`
}

function modelLabel(model: string): string {
  return model
    .split(':')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(':')
}

function modelDescription(model: OllamaTagModel): string | undefined {
  const details = model.details || {}
  const pieces = [
    details.parameter_size,
    details.quantization_level,
    typeof details.context_length === 'number' ? `${details.context_length.toLocaleString()} ctx` : ''
  ].filter(Boolean)
  return pieces.length > 0 ? pieces.join(' · ') : undefined
}

export function normalizeOllamaModels(
  response: OllamaTagsResponse,
  defaultModel?: string | null
): OllamaModelInfo[] {
  const seen = new Set<string>()
  const selectedDefault = String(defaultModel || '').trim()
  const normalized: OllamaModelInfo[] = []
  for (const entry of Array.isArray(response.models) ? response.models : []) {
    const id = String(entry.model || entry.name || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const info: OllamaModelInfo = {
      id,
      label: modelLabel(id),
      isDefault: selectedDefault ? id === selectedDefault : seen.size === 1
    }
    const description = modelDescription(entry)
    if (description) info.description = description
    if (typeof entry.details?.context_length === 'number') {
      info.contextLength = entry.details.context_length
    }
    if (entry.details?.parameter_size) info.parameterSize = entry.details.parameter_size
    if (entry.details?.quantization_level) {
      info.quantizationLevel = entry.details.quantization_level
    }
    if (Array.isArray(entry.capabilities)) {
      const capabilities = entry.capabilities.filter(
        (item): item is string => typeof item === 'string'
      )
      if (capabilities.length > 0) info.capabilities = capabilities
    }
    normalized.push(info)
  }
  return normalized
}

export async function fetchOllamaModels(
  settings: Pick<AppSettings, 'ollamaBaseUrl' | 'ollamaDefaultModel'>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<OllamaModelInfo[]> {
  const timeoutMs = options.timeoutMs ?? 3_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const signal = options.signal || controller.signal
  try {
    const response = await fetch(endpoint(settings.ollamaBaseUrl, '/api/tags'), { signal })
    if (!response.ok) {
      throw new Error(`Ollama model list failed with HTTP ${response.status}.`)
    }
    const json = (await response.json()) as OllamaTagsResponse
    return normalizeOllamaModels(json, settings.ollamaDefaultModel)
  } finally {
    clearTimeout(timer)
  }
}

export async function getOllamaStatusSnapshot(
  settings: Pick<AppSettings, 'ollamaBaseUrl' | 'ollamaDefaultModel'>
): Promise<OllamaStatusSnapshot> {
  const baseUrl = normalizeOllamaBaseUrl(settings.ollamaBaseUrl)
  try {
    const models = await fetchOllamaModels({ ...settings, ollamaBaseUrl: baseUrl })
    const defaultModel =
      String(settings.ollamaDefaultModel || '').trim() || models.find((model) => model.isDefault)?.id
    return {
      available: true,
      setupRequired: models.length === 0,
      baseUrl,
      modelCount: models.length,
      defaultModel,
      models,
      ...(models.length === 0 ? { error: 'Ollama is reachable, but no local models are installed.' } : {})
    }
  } catch (error) {
    return {
      available: false,
      setupRequired: true,
      baseUrl,
      modelCount: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function getOllamaCapabilityContract(
  deps: Pick<OllamaProviderDeps, 'getSettings'>,
  request: { workspacePath?: string; approvalMode?: string } = {}
): Promise<ProviderCapabilityContract> {
  const settings = deps.getSettings()
  const status = await getOllamaStatusSnapshot(settings)
  return buildProviderCapabilityContract({
    provider: 'ollama',
    settings,
    workspacePath: request.workspacePath,
    approvalMode: request.approvalMode || 'plan',
    status,
    mcpStatus: {
      available: false,
      enabled: false,
      message: 'Ollama Phase 1 does not expose MCP tools.'
    }
  })
}

function resolveRequestedOllamaModel(
  payload: Pick<AgentRunPayload, 'model'>,
  settings: Pick<AppSettings, 'ollamaDefaultModel'>,
  models: OllamaModelInfo[]
): string {
  const requested = String(payload.model || '').trim()
  if (requested && !['cli-default', 'auto', 'default', 'custom'].includes(requested)) {
    return requested
  }
  const configured = String(settings.ollamaDefaultModel || '').trim()
  if (configured) return configured
  return models.find((model) => model.isDefault)?.id || models[0]?.id || ''
}

function ollamaUsageStats(chunk: OllamaChatChunk): Record<string, unknown> {
  return {
    ...(typeof chunk.prompt_eval_count === 'number'
      ? { inputTokens: chunk.prompt_eval_count }
      : {}),
    ...(typeof chunk.eval_count === 'number' ? { outputTokens: chunk.eval_count } : {}),
    ...(typeof chunk.total_duration === 'number' ? { totalDurationNs: chunk.total_duration } : {}),
    ...(typeof chunk.load_duration === 'number' ? { loadDurationNs: chunk.load_duration } : {}),
    ...(typeof chunk.prompt_eval_duration === 'number'
      ? { promptEvalDurationNs: chunk.prompt_eval_duration }
      : {}),
    ...(typeof chunk.eval_duration === 'number' ? { evalDurationNs: chunk.eval_duration } : {})
  }
}

export async function runOllamaProvider(
  deps: OllamaProviderDeps,
  event: Electron.IpcMainInvokeEvent,
  payload: AgentRunPayload,
  route: AgentRunRoute
): Promise<void> {
  const settings = deps.getSettings()
  const baseUrl = normalizeOllamaBaseUrl(settings.ollamaBaseUrl)
  const controller = new AbortController()
  deps.runManager.attachAbortController(route.appRunId!, controller)

  try {
    const models = await fetchOllamaModels({ ...settings, ollamaBaseUrl: baseUrl }, {
      signal: controller.signal
    })
    const model = resolveRequestedOllamaModel(payload, settings, models)
    if (!model) {
      deps.sendAgentCompatError(
        event.sender,
        'ollama',
        'Ollama is reachable, but no local model is installed. Pull a model with `ollama pull qwen3:4b-instruct`, then refresh models.',
        route
      )
      deps.sendAgentCompatExit(event.sender, 'ollama', 1, route)
      deps.runManager.finish(route.appRunId, 'failed' as RunSessionStatus)
      return
    }

    await deps.emitProviderCapabilityWarnings?.(
      event.sender,
      'ollama',
      payload.workspace,
      'plan',
      route
    )

    deps.sendAgentCompatLine(
      event.sender,
      'ollama',
      {
        type: 'init',
        session_id: `ollama://${model}`,
        model,
        timestamp: new Date().toISOString()
      },
      route
    )

    const response = await fetch(endpoint(baseUrl, '/api/chat'), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [{ role: 'user', content: payload.prompt }],
        options: {
          temperature: 0.2
        }
      })
    })

    if (!response.ok || !response.body) {
      throw new Error(`Ollama chat failed with HTTP ${response.status}.`)
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let lastDone: OllamaChatChunk | null = null
    for await (const value of response.body as any as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const chunk = JSON.parse(trimmed) as OllamaChatChunk
        if (chunk.error) {
          throw new Error(chunk.error)
        }
        const text = chunk.message?.content || ''
        if (text) {
          deps.sendAgentCompatLine(
            event.sender,
            'ollama',
            {
              type: 'content',
              text,
              model: chunk.model || model,
              timestamp: chunk.created_at || new Date().toISOString()
            },
            route
          )
        }
        if (chunk.done) {
          lastDone = chunk
        }
      }
    }
    const trailing = buffer.trim()
    if (trailing) {
      const chunk = JSON.parse(trailing) as OllamaChatChunk
      if (chunk.error) throw new Error(chunk.error)
      const text = chunk.message?.content || ''
      if (text) {
        deps.sendAgentCompatLine(event.sender, 'ollama', { type: 'content', text, model }, route)
      }
      if (chunk.done) lastDone = chunk
    }

    deps.sendAgentCompatLine(
      event.sender,
      'ollama',
      {
        type: 'result',
        status: 'success',
        model,
        stats: lastDone ? ollamaUsageStats(lastDone) : {}
      },
      route
    )
    deps.sendAgentCompatExit(event.sender, 'ollama', 0, route)
    deps.runManager.finish(route.appRunId, 'completed' as RunSessionStatus)
  } catch (error) {
    const aborted = controller.signal.aborted
    const message = aborted
      ? 'Ollama run cancelled.'
      : error instanceof Error
        ? error.message
        : String(error)
    deps.sendAgentCompatError(event.sender, 'ollama', message, route)
    deps.sendAgentCompatExit(event.sender, 'ollama', aborted ? 130 : 1, route)
    deps.runManager.finish(route.appRunId, aborted ? ('cancelled' as RunSessionStatus) : ('failed' as RunSessionStatus))
  }
}
