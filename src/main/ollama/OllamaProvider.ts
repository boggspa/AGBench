import { execFile } from 'child_process'
import { promisify } from 'util'
import { buildProviderCapabilityContract } from '../ProviderCapabilities'
import type { AgentRunPayload, AgentRunRoute } from '../run/AgentRunTypes'
import type { RunManager, RunSessionStatus } from '../RunManager'
import type { AppSettings, ProviderCapabilityContract } from '../store/types'

export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
const OLLAMA_MEMORY_POLL_INTERVAL_MS = 5_000
const execFileAsync = promisify(execFile)

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

export interface OllamaProcessMemoryEntry {
  pid: number
  rssBytes: number
  command: string
}

export interface OllamaProcessMemorySnapshot {
  sampledAt: string
  processCount: number
  rssBytes: number
  rssGb: number
  processes: OllamaProcessMemoryEntry[]
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

export function humanizeOllamaModelId(model: string): string {
  const id = model.trim()
  const key = id.toLowerCase()
  if (key === 'qwen3:4b-instruct') return 'Qwen 3 (4B Param)'
  if (key === 'gemma4:12b' || key.startsWith('gemma4:12b-')) {
    return 'Gemma 4 (12B Param)'
  }
  if (
    key === 'gpt-oss' ||
    key === 'gpt-oss:20b' ||
    key === 'gpt-oss:latest' ||
    key === 'openai/gpt-oss-20b'
  ) {
    return 'GPT OSS (20B Param)'
  }
  return id
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
      label: humanizeOllamaModelId(id),
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

function isOllamaModelRuntimeCommand(command: string): boolean {
  const lower = command.toLowerCase()
  if (lower.includes('llama-server')) return true
  if (lower.includes('ollama_llama_server')) return true
  return lower.includes('ollama') && lower.includes('runner')
}

export function parseOllamaMemoryPsOutput(
  stdout: string,
  sampledAt = new Date().toISOString()
): OllamaProcessMemorySnapshot | null {
  const processes: OllamaProcessMemoryEntry[] = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) continue
    const command = match[3].trim()
    if (!isOllamaModelRuntimeCommand(command)) continue
    const pid = Number(match[1])
    const rssKb = Number(match[2])
    if (!Number.isFinite(pid) || !Number.isFinite(rssKb) || rssKb <= 0) continue
    processes.push({
      pid,
      rssBytes: Math.round(rssKb * 1024),
      command
    })
  }
  if (processes.length === 0) return null
  const rssBytes = processes.reduce((sum, process) => sum + process.rssBytes, 0)
  return {
    sampledAt,
    processCount: processes.length,
    rssBytes,
    rssGb: rssBytes / 1_000_000_000,
    processes
  }
}

export async function sampleOllamaLlamaServerMemory(): Promise<OllamaProcessMemorySnapshot | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,rss=,command='], {
      timeout: 2_000,
      maxBuffer: 1024 * 1024
    })
    return parseOllamaMemoryPsOutput(String(stdout))
  } catch {
    return null
  }
}

function ollamaHardwareStats(
  latest: OllamaProcessMemorySnapshot | null,
  peak: OllamaProcessMemorySnapshot | null,
  sampleCount: number
): Record<string, unknown> {
  if (!latest && !peak) return {}
  const selectedPeak = peak || latest
  const selectedLatest = latest || peak
  if (!selectedLatest || !selectedPeak) return {}
  return {
    ollamaMemoryRssBytes: selectedLatest.rssBytes,
    ollamaMemoryRssGb: selectedLatest.rssGb,
    ollamaMemoryPeakRssBytes: selectedPeak.rssBytes,
    ollamaMemoryPeakRssGb: selectedPeak.rssGb,
    ollamaMemoryProcessCount: selectedPeak.processCount,
    ollamaMemorySampleCount: sampleCount,
    ollamaMemorySampledAt: selectedPeak.sampledAt,
    hardware: {
      ram: {
        process: 'llama-server',
        rssBytes: selectedLatest.rssBytes,
        rssGb: selectedLatest.rssGb,
        peakRssBytes: selectedPeak.rssBytes,
        peakRssGb: selectedPeak.rssGb,
        processCount: selectedPeak.processCount,
        sampleCount,
        sampledAt: selectedPeak.sampledAt
      }
    }
  }
}

function createOllamaMemoryMonitor(intervalMs = OLLAMA_MEMORY_POLL_INTERVAL_MS) {
  let timer: NodeJS.Timeout | null = null
  let latest: OllamaProcessMemorySnapshot | null = null
  let peak: OllamaProcessMemorySnapshot | null = null
  let sampleCount = 0
  let inflight: Promise<void> | null = null

  const sample = async (): Promise<void> => {
    if (inflight) return inflight
    inflight = sampleOllamaLlamaServerMemory()
      .then((snapshot) => {
        if (!snapshot) return
        latest = snapshot
        sampleCount += 1
        if (!peak || snapshot.rssBytes > peak.rssBytes) {
          peak = snapshot
        }
      })
      .catch(() => {})
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  return {
    start(): void {
      void sample()
      timer = setInterval(() => void sample(), intervalMs)
      timer.unref?.()
    },
    async stop(): Promise<Record<string, unknown>> {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      await sample()
      if (inflight) await inflight
      return ollamaHardwareStats(latest, peak, sampleCount)
    }
  }
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
      message:
        'Ollama local mode does not yet expose TaskWraith MCP tools; read-only search should run through a TaskWraith-controlled tool loop.'
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
  let memoryMonitor: ReturnType<typeof createOllamaMemoryMonitor> | null = null
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
        'Ollama is reachable, but no local model is installed. Pull a model with `ollama pull qwen3:4b-instruct`, `ollama pull gemma4:12b`, or `ollama pull gpt-oss`, then refresh models.',
        route
      )
      deps.sendAgentCompatExit(event.sender, 'ollama', 1, route)
      deps.runManager.finish(route.appRunId, 'failed' as RunSessionStatus)
      return
    }
    const modelLabel = humanizeOllamaModelId(model)
    memoryMonitor = createOllamaMemoryMonitor()
    memoryMonitor.start()

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
        modelLabel,
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
              modelLabel: humanizeOllamaModelId(chunk.model || model),
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
        deps.sendAgentCompatLine(
          event.sender,
          'ollama',
          { type: 'content', text, model, modelLabel },
          route
        )
      }
      if (chunk.done) lastDone = chunk
    }

    const hardwareStats = memoryMonitor ? await memoryMonitor.stop() : {}
    memoryMonitor = null
    deps.sendAgentCompatLine(
      event.sender,
      'ollama',
      {
        type: 'result',
        status: 'success',
        model,
        modelLabel,
        stats: {
          ...(lastDone ? ollamaUsageStats(lastDone) : {}),
          ...hardwareStats
        }
      },
      route
    )
    deps.sendAgentCompatExit(event.sender, 'ollama', 0, route)
    deps.runManager.finish(route.appRunId, 'completed' as RunSessionStatus)
  } catch (error) {
    if (memoryMonitor) {
      await memoryMonitor.stop().catch(() => {})
      memoryMonitor = null
    }
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
