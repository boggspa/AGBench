import { execFile } from 'child_process'
import { promisify } from 'util'
import { buildProviderCapabilityContract } from '../ProviderCapabilities'
import type { AgentRunPayload, AgentRunRoute } from '../run/AgentRunTypes'
import type { RunManager, RunSessionStatus } from '../RunManager'
import type { AppSettings, OllamaToolControlTier, ProviderCapabilityContract } from '../store/types'
import {
  OLLAMA_KNOWN_TOOL_NAMES,
  effectiveOllamaToolControlTier,
  normalizeOllamaToolControlTier,
  ollamaTierLabel,
  ollamaToolNamesForTier,
  type OllamaToolName
} from './OllamaToolTiers'

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
  getSettings: () => Pick<AppSettings, 'ollamaBaseUrl' | 'ollamaDefaultModel' | 'ollamaToolControlTier' | 'ollamaProviderParityWorkspaceGrants' | 'agenticServices' | 'geminiMcpBridgeEnabled' | 'codexSandboxFallback'>
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
  executeTool?: (request: OllamaToolExecutionRequest) => Promise<OllamaToolExecutionResult>
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
    // Harmony-format models (e.g. gpt-oss) stream their answer into a
    // separate reasoning channel. Ollama surfaces it as `thinking`.
    thinking?: string
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

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OllamaChatTurnResult {
  content: string
  /** Accumulated harmony reasoning text (gpt-oss et al.), used as a fallback
   * when a model emits its answer into the thinking channel and leaves
   * `message.content` empty. */
  thinking: string
  lastDone: OllamaChatChunk | null
}

export interface OllamaToolExecutionRequest {
  toolName: OllamaToolName
  arguments: Record<string, unknown>
  workspacePath: string
  appChatId?: string
  appRunId?: string
  toolControlTier?: OllamaToolControlTier
}

export interface OllamaToolExecutionResult {
  ok: boolean
  output: string
  structuredContent?: unknown
}

export interface OllamaToolRequest {
  toolName: OllamaToolName
  arguments: Record<string, unknown>
}

const OLLAMA_TOOL_LOOP_LIMIT = 4
const OLLAMA_LOCAL_TOOL_SERVER = 'TaskWraith-local'

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
  if (key === 'qwen3.5:9b' || key.startsWith('qwen3.5:9b-')) {
    return 'Qwen 3.5 (9B Param)'
  }
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
  const tier = effectiveOllamaToolControlTier(settings, request.workspacePath)
  const toolNames = ollamaToolNamesForTier(tier)
  const status = await getOllamaStatusSnapshot(settings)
  return buildProviderCapabilityContract({
    provider: 'ollama',
    settings,
    workspacePath: request.workspacePath,
    approvalMode: request.approvalMode || 'plan',
    status,
    mcpStatus: {
      available:
        Boolean(request.workspacePath) && settings.agenticServices?.mcpTools !== 'deny',
      enabled: settings.agenticServices?.mcpTools !== 'deny',
      installed: true,
      serverName: OLLAMA_LOCAL_TOOL_SERVER,
      tools:
        Boolean(request.workspacePath) && settings.agenticServices?.mcpTools !== 'deny'
          ? toolNames
          : [],
      message:
        Boolean(request.workspacePath) && settings.agenticServices?.mcpTools !== 'deny'
          ? `Ollama local mode uses TaskWraith-controlled ${ollamaTierLabel(tier)} tools.`
          : 'Ollama tools require a workspace thread and enabled TaskWraith MCP/tool policy.'
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

export function ollamaLocalToolSystemPrompt(
  tier: OllamaToolControlTier | string | undefined | null = 'read_only'
): string {
  const normalizedTier = normalizeOllamaToolControlTier(tier)
  const tools = ollamaToolNamesForTier(normalizedTier)
  const hasWebTools = tools.includes('web_search') || tools.includes('web_fetch')
  const lines = [
    'You are running inside TaskWraith through local Ollama.',
    'You do not have direct shell or filesystem access, but TaskWraith DOES give you working tools (listed below) that you can call right now. Use them instead of telling the user you lack a capability.',
    ...(hasWebTools
      ? [
          'You CAN access the live internet through the web_search and web_fetch tools below. When the user asks about current events, weather, prices, or anything you cannot answer from memory, use web_search to find sources, then web_fetch to read a chosen page. web_fetch returns the readable text of the page, so you can summarize it directly.'
        ]
      : []),
    'To request a tool, reply with ONLY a JSON object in this exact shape:',
    '{"taskwraith_tool":{"name":"read_file","arguments":{"path":"README.md"}}}',
    `Current Ollama tool-control tier: ${ollamaTierLabel(normalizedTier)}.`,
    'Available tools:'
  ]
  const describeTool = (toolName: OllamaToolName): string | null => {
    if (toolName === 'list_directory') return '- list_directory: {"path":"."}'
    if (toolName === 'read_file') return '- read_file: {"path":"relative/path.txt"}'
    if (toolName === 'workspace_search') {
      return '- workspace_search: {"query":"text or regex","path":".","maxResults":50,"contextLines":1}'
    }
    if (toolName === 'web_search') {
      return '- web_search: {"query":"current information to search for"} — returns a ranked list of result titles and URLs from the live web.'
    }
    if (toolName === 'web_fetch') {
      return '- web_fetch: {"url":"https://example.com/page"} — downloads a page and returns its readable text (HTML markup is stripped), ready for you to read and summarize.'
    }
    if (toolName === 'write_file') {
      return '- write_file: {"path":"relative/path.txt","content":"...","intent":"short reason before changing files"}'
    }
    if (toolName === 'replace') {
      return '- replace: {"path":"relative/path.txt","old_string":"...","new_string":"...","intent":"short reason before changing files"}'
    }
    if (toolName === 'apply_patch') {
      return '- apply_patch: {"patch":"unified diff","intent":"short reason before changing files"}'
    }
    if (toolName === 'run_shell_command') {
      return '- run_shell_command: {"command":"exact command","intent":"short reason before running it"}'
    }
    return `- ${toolName}: use the TaskWraith MCP argument schema for this tool.`
  }
  for (const toolName of tools) {
    const line = describeTool(toolName)
    if (line) lines.push(line)
  }
  lines.push(
    'Paths must stay inside the active workspace.',
    'web_search and web_fetch are read-only network tools routed through TaskWraith policy. A typical flow is: web_search for the topic, pick the most relevant result, then web_fetch that URL and summarize its readable text for the user.',
    'Mutating tools require an intent or summary. TaskWraith will show a modal approval before running approved-edit and approved-shell tools.',
    'After TaskWraith returns a tool result, answer normally or request one more tool with the same JSON shape.',
    'Do not invent file contents or workspace facts when a tool result is needed.'
  )
  return [
    ...lines
  ].join('\n')
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseJsonObject(candidate: string): unknown | null {
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

function jsonCandidatesFromText(text: string): string[] {
  const candidates: string[] = []
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]?.trim()) candidates.push(match[1].trim())
  }
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    candidates.push(trimmed)
  }
  const keyIndex = trimmed.indexOf('"taskwraith_tool"')
  if (keyIndex >= 0) {
    const start = trimmed.lastIndexOf('{', keyIndex)
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1))
  }
  return [...new Set(candidates)]
}

export function parseOllamaToolRequest(text: string): OllamaToolRequest | null {
  for (const candidate of jsonCandidatesFromText(text)) {
    const parsed = recordFromUnknown(parseJsonObject(candidate))
    if (!parsed) continue
    const wrapper = recordFromUnknown(parsed.taskwraith_tool) || recordFromUnknown(parsed.tool)
    if (!wrapper) continue
    const name = typeof wrapper.name === 'string' ? wrapper.name.trim() : ''
    if (!OLLAMA_KNOWN_TOOL_NAMES.has(name as OllamaToolName)) continue
    const args = recordFromUnknown(wrapper.arguments) || recordFromUnknown(wrapper.args) || {}
    return {
      toolName: name as OllamaToolName,
      arguments: args
    }
  }
  return null
}

export function ollamaToolResultFollowUpPrompt(input: {
  toolName: OllamaToolName
  output: string
  ok: boolean
}): string {
  return [
    `TaskWraith executed ${input.toolName}.`,
    input.ok ? 'Tool status: success.' : 'Tool status: error.',
    'Tool result:',
    input.output,
    '',
    input.ok
      ? [
          'Now continue the original task in normal assistant prose.',
          'If the tool result is enough to answer the user, summarize the relevant facts and stop.',
          'Do not call the same tool again unless the result is incomplete and another call is strictly necessary.',
          'Only output JSON if you are requesting a different additional TaskWraith tool.'
        ].join(' ')
      : [
          'The tool failed.',
          'Explain the limitation or request a different allowed TaskWraith tool only if that can recover.'
        ].join(' ')
  ].join('\n')
}

export function ollamaEmptyToolResponseRetryPrompt(): string {
  return [
    'Your previous response was empty after TaskWraith returned tool results.',
    'Do not request another tool unless it is strictly required.',
    'Answer the original user now in normal assistant prose, summarizing the tool results you already received.'
  ].join(' ')
}

export function ollamaEmptyResponseRetryPrompt(): string {
  return [
    'Your previous response was empty.',
    'Answer the original user request now in normal assistant prose.',
    'Put your final answer in your normal response, not only in hidden reasoning.'
  ].join(' ')
}

/** Resolve the text TaskWraith should treat as the model's turn output.
 * Prefers the normal `content` channel; falls back to harmony reasoning
 * (`thinking`) so models like gpt-oss that emit their answer into the
 * reasoning channel still produce a visible response instead of nothing. */
export function resolveOllamaVisibleText(turn: { content: string; thinking?: string }): string {
  return turn.content.trim() ? turn.content : turn.thinking || ''
}

async function runOllamaChatTurn(input: {
  baseUrl: string
  model: string
  messages: OllamaChatMessage[]
  signal: AbortSignal
}): Promise<OllamaChatTurnResult> {
  const response = await fetch(endpoint(input.baseUrl, '/api/chat'), {
    method: 'POST',
    signal: input.signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      stream: true,
      messages: input.messages,
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
  let content = ''
  let thinking = ''
  let lastDone: OllamaChatChunk | null = null
  const handleChunk = (chunk: OllamaChatChunk) => {
    if (chunk.error) {
      throw new Error(chunk.error)
    }
    content += chunk.message?.content || ''
    thinking += chunk.message?.thinking || ''
    if (chunk.done) {
      lastDone = chunk
    }
  }

  for await (const value of response.body as any as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      handleChunk(JSON.parse(trimmed) as OllamaChatChunk)
    }
  }
  const trailing = buffer.trim()
  if (trailing) {
    handleChunk(JSON.parse(trailing) as OllamaChatChunk)
  }
  return { content, thinking, lastDone }
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
        'Ollama is reachable, but no local model is installed. Pull a model with `ollama pull qwen3:4b-instruct`, `ollama pull qwen3.5:9b`, `ollama pull gemma4:12b`, or `ollama pull gpt-oss`, then refresh models.',
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

    const toolProtocolEnabled =
      Boolean(deps.executeTool && payload.workspace && payload.scope !== 'global') &&
      settings.agenticServices?.mcpTools !== 'deny'
    const toolControlTier = effectiveOllamaToolControlTier(settings, payload.workspace)
    const messages: OllamaChatMessage[] = [
      ...(toolProtocolEnabled
        ? [{ role: 'system' as const, content: ollamaLocalToolSystemPrompt(toolControlTier) }]
        : []),
      { role: 'user', content: payload.prompt }
    ]
    let lastDone: OllamaChatChunk | null = null
    let toolCallCount = 0
    for (let turnIndex = 0; turnIndex <= OLLAMA_TOOL_LOOP_LIMIT; turnIndex += 1) {
      const turn = await runOllamaChatTurn({
        baseUrl,
        model,
        messages,
        signal: controller.signal
      })
      if (turn.lastDone) lastDone = turn.lastDone
      // gpt-oss and other harmony-format models emit their answer into the
      // reasoning (`thinking`) channel and may leave `content` empty; fall
      // back so the run still produces a visible reply instead of nothing.
      const visibleText = resolveOllamaVisibleText(turn)
      const toolRequest = toolProtocolEnabled ? parseOllamaToolRequest(visibleText) : null
      if (!toolRequest) {
        if (!visibleText.trim() && turnIndex < OLLAMA_TOOL_LOOP_LIMIT) {
          messages.push({
            role: 'user',
            content:
              toolCallCount > 0
                ? ollamaEmptyToolResponseRetryPrompt()
                : ollamaEmptyResponseRetryPrompt()
          })
          continue
        }
        if (visibleText) {
          deps.sendAgentCompatLine(
            event.sender,
            'ollama',
            {
              type: 'content',
              text: visibleText,
              model,
              modelLabel,
              timestamp: new Date().toISOString()
            },
            route
          )
        }
        break
      }
      if (turnIndex >= OLLAMA_TOOL_LOOP_LIMIT) {
        deps.sendAgentCompatLine(
          event.sender,
          'ollama',
          {
            type: 'provider_warning',
            id: 'ollama-tool-loop-limit',
            severity: 'warning',
            title: 'Ollama tool loop limit reached',
            message: 'The local model kept requesting tools; TaskWraith stopped the tool loop.'
          },
          route
        )
        break
      }
      toolCallCount += 1
      const toolId = `ollama-tool-${route.appRunId || Date.now()}-${toolCallCount}`
      deps.sendAgentCompatLine(
        event.sender,
        'ollama',
        {
          type: 'tool_use',
          tool_id: toolId,
          tool_name: toolRequest.toolName,
          parameters: toolRequest.arguments,
          provider: 'ollama',
          server: OLLAMA_LOCAL_TOOL_SERVER
        },
        route
      )
      const toolResult = await deps.executeTool!({
        toolName: toolRequest.toolName,
        arguments: toolRequest.arguments,
        workspacePath: payload.workspace!,
        appChatId: route.appChatId || payload.appChatId,
        appRunId: route.appRunId || payload.appRunId,
        toolControlTier
      })
      deps.sendAgentCompatLine(
        event.sender,
        'ollama',
        {
          type: 'tool_result',
          tool_id: toolId,
          tool_name: toolRequest.toolName,
          status: toolResult.ok ? 'success' : 'error',
          output: toolResult.output,
          result: toolResult.structuredContent,
          provider: 'ollama',
          server: OLLAMA_LOCAL_TOOL_SERVER
        },
        route
      )
      messages.push({
        role: 'assistant',
        content: `Requested TaskWraith tool ${toolRequest.toolName}.`
      })
      messages.push({
        role: 'user',
        content: ollamaToolResultFollowUpPrompt({
          toolName: toolRequest.toolName,
          output: toolResult.output,
          ok: toolResult.ok
        })
      })
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
          ...(toolCallCount > 0 ? { taskWraithToolCalls: toolCallCount } : {}),
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
