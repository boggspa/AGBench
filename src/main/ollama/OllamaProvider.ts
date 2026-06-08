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

interface OllamaNativeToolCall {
  function?: {
    name?: string
    /** Ollama returns parsed arguments as an object, but some builds emit a
     * JSON string. Accept both. */
    arguments?: Record<string, unknown> | string
  }
}

interface OllamaChatChunk {
  model?: string
  created_at?: string
  message?: {
    role?: string
    content?: string
    // Harmony-format models (e.g. gpt-oss) stream their answer into a
    // separate reasoning channel. Ollama surfaces it as `thinking`.
    thinking?: string
    // Models with native tool support (gpt-oss, qwen, etc.) return structured
    // calls here when the request includes a `tools` array.
    tool_calls?: OllamaNativeToolCall[]
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
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Echoed back on an assistant turn that made native tool calls so the model
   * keeps a coherent transcript across the stateless HTTP loop. */
  tool_calls?: OllamaNativeToolCall[]
  /** Names the tool a `role: 'tool'` result message answers. */
  tool_name?: string
}

interface OllamaChatTurnResult {
  content: string
  /** Accumulated harmony reasoning text (gpt-oss et al.), used as a fallback
   * when a model emits its answer into the thinking channel and leaves
   * `message.content` empty. */
  thinking: string
  /** Native structured tool calls (Ollama `tools` API). Preferred over the
   * legacy JSON-in-prose protocol when present. */
  toolCalls: OllamaToolRequest[]
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

const OLLAMA_TOOL_LOOP_LIMIT = 8
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
    'To request a tool, either emit a native tool/function call, or reply with ONLY a JSON object in this exact shape:',
    '{"taskwraith_tool":{"name":"read_file","arguments":{"path":"README.md"}}}',
    'Do NOT announce or describe a tool call in prose (for example, "we need to use web_search" or "let\'s do web_search"). Either actually issue the tool call now, or give your final answer in normal prose. Describing a tool without calling it does nothing.',
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

/** Escape backslashes that are NOT part of a valid JSON escape sequence so a
 * tolerant re-parse can recover. Models frequently embed source code in a tool
 * call's string arguments (e.g. Swift's `\(date)` interpolation, Windows paths,
 * LaTeX), which is invalid JSON — strict `JSON.parse` throws and the whole tool
 * call would otherwise leak to the user as raw text. The negative lookahead
 * leaves real escapes (`\n`, `\"`, `\\`, `\uXXXX`, …) untouched. */
export function sanitizeLooseJsonEscapes(candidate: string): string {
  // Consume valid escape pairs atomically (so the char after a real `\\` isn't
  // misread), and double any remaining lone backslash.
  return candidate.replace(/\\(["\\/bfnrtu])|\\/g, (_match, valid) =>
    valid ? `\\${valid}` : '\\\\'
  )
}

/** Strict JSON parse, falling back to a tolerant re-parse that repairs invalid
 * backslash escapes (the common failure when models embed code in string args). */
export function parseJsonObjectLoose(candidate: string): unknown | null {
  const strict = parseJsonObject(candidate)
  if (strict !== null) return strict
  return parseJsonObject(sanitizeLooseJsonEscapes(candidate))
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
    const parsed = recordFromUnknown(parseJsonObjectLoose(candidate))
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

export interface OllamaNativeToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

const STRING = { type: 'string' as const }

function ollamaNativeToolParameters(toolName: OllamaToolName): {
  description: string
  properties: Record<string, unknown>
  required: string[]
} {
  switch (toolName) {
    case 'read_file':
      return {
        description: 'Read a UTF-8 text file inside the active workspace.',
        properties: { path: { ...STRING, description: 'Workspace-relative file path.' } },
        required: ['path']
      }
    case 'list_directory':
      return {
        description: 'List the entries of a directory inside the active workspace.',
        properties: { path: { ...STRING, description: 'Workspace-relative directory path. Use "." for the root.' } },
        required: ['path']
      }
    case 'workspace_search':
      return {
        description: 'Search the workspace tree for text or a regular expression.',
        properties: {
          query: { ...STRING, description: 'Text or regex to search for.' },
          path: { ...STRING, description: 'Optional subdirectory to scope the search.' },
          maxResults: { type: 'number', description: 'Maximum matches to return.' },
          contextLines: { type: 'number', description: 'Lines of context around each match.' }
        },
        required: ['query']
      }
    case 'web_search':
      return {
        description:
          'Search the live web. Returns a ranked list of result titles and URLs. Use this for current events, weather, prices, or anything not answerable from memory.',
        properties: { query: { ...STRING, description: 'What to search the web for.' } },
        required: ['query']
      }
    case 'web_fetch':
      return {
        description:
          'Download a web page and return its readable text (HTML stripped) so you can summarize it.',
        properties: { url: { ...STRING, description: 'Absolute http(s) URL to fetch.' } },
        required: ['url']
      }
    case 'write_file':
      return {
        description: 'Create or overwrite a workspace file. Requires a short intent.',
        properties: {
          path: { ...STRING, description: 'Workspace-relative file path.' },
          content: { ...STRING, description: 'Full new file contents.' },
          intent: { ...STRING, description: 'Short reason for the change (shown in the approval modal).' }
        },
        required: ['path', 'content', 'intent']
      }
    case 'replace':
      return {
        description: 'Replace an exact substring within a workspace file. Requires a short intent.',
        properties: {
          path: { ...STRING, description: 'Workspace-relative file path.' },
          old_string: { ...STRING, description: 'Exact text to replace.' },
          new_string: { ...STRING, description: 'Replacement text.' },
          intent: { ...STRING, description: 'Short reason for the change.' }
        },
        required: ['path', 'old_string', 'new_string', 'intent']
      }
    case 'apply_patch':
      return {
        description: 'Apply a unified diff to the workspace. Requires a short intent.',
        properties: {
          patch: { ...STRING, description: 'Unified diff text.' },
          intent: { ...STRING, description: 'Short reason for the change.' }
        },
        required: ['patch', 'intent']
      }
    case 'run_shell_command':
      return {
        description: 'Run a shell command in the workspace. Requires a short intent.',
        properties: {
          command: { ...STRING, description: 'Exact command to run.' },
          intent: { ...STRING, description: 'Short reason for running it.' }
        },
        required: ['command', 'intent']
      }
    default:
      return {
        description: `Invoke the TaskWraith ${toolName} tool using its documented MCP argument schema.`,
        properties: {},
        required: []
      }
  }
}

/** Build OpenAI-style function definitions for the tools allowed in `tier`, to
 * pass via Ollama's native `tools` request field. Models with native tool
 * support (gpt-oss, qwen, etc.) emit structured `tool_calls` against these. */
export function ollamaNativeToolDefinitions(
  tier: OllamaToolControlTier | string | undefined | null
): OllamaNativeToolDefinition[] {
  return ollamaToolNamesForTier(tier).map((toolName) => {
    const { description, properties, required } = ollamaNativeToolParameters(toolName)
    return {
      type: 'function',
      function: {
        name: toolName,
        description,
        parameters: { type: 'object', properties, ...(required.length ? { required } : {}) }
      }
    }
  })
}

/** Normalize a single native tool call from an Ollama stream chunk into the
 * internal request shape, or null when the name is unknown / unparseable. */
export function normalizeOllamaNativeToolCall(call: OllamaNativeToolCall): OllamaToolRequest | null {
  const name = typeof call.function?.name === 'string' ? call.function.name.trim() : ''
  if (!OLLAMA_KNOWN_TOOL_NAMES.has(name as OllamaToolName)) return null
  const rawArgs = call.function?.arguments
  let args: Record<string, unknown> = {}
  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    args = rawArgs as Record<string, unknown>
  } else if (typeof rawArgs === 'string' && rawArgs.trim()) {
    args = recordFromUnknown(parseJsonObjectLoose(rawArgs)) || {}
  }
  return { toolName: name as OllamaToolName, arguments: args }
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
          'Continue the task using this result.',
          'If you still need more information to fully complete what the user asked, call another TaskWraith tool now (use different arguments than before).',
          'When you have everything you need, give your complete final answer to the user in normal assistant prose.',
          'Do not repeat an identical tool call, and only output JSON when you are requesting another TaskWraith tool.'
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

/** Nudge for harmony-format models (gpt-oss) that emit a plan into their hidden
 * reasoning channel without producing a final answer or an actual tool call.
 * We must not surface chain-of-thought as the answer, so push the model to act. */
export function ollamaReasoningOnlyNudgePrompt(): string {
  return [
    'You produced internal reasoning but no final answer and no tool call.',
    'If you need external data (web pages, files, search results), call one of the available tools now.',
    'Otherwise, write your final answer for the user in normal assistant prose.',
    'Do not leave your response only in hidden reasoning.'
  ].join(' ')
}

/** Nudge for models (notably gpt-oss) that ANNOUNCE a tool in prose
 * ("We need to use web_search", "Let's do web_search") but never emit an
 * actual structured tool call, then stop — handing an intent stub back to the
 * user instead of acting. Push them to emit the real call (or, if no tool is
 * actually needed, to answer) rather than describing the call in prose. */
export function ollamaToolIntentNudgePrompt(toolNames: string[] = []): string {
  const available = toolNames.filter(Boolean)
  return [
    'You described using a tool in prose but did not actually call one.',
    'Stop announcing the tool and emit a real tool call now (a structured function call), not a description of it.',
    available.length ? `Available tools: ${available.join(', ')}.` : '',
    'If you do not actually need a tool, give your complete final answer to the user in normal assistant prose instead.'
  ]
    .filter(Boolean)
    .join(' ')
}

/** Detect a leaked tool-protocol attempt: the model tried to emit the
 * `{"taskwraith_tool":{...}}` JSON contract in prose but it could not be parsed
 * into a real request (e.g. invalid JSON escapes that even the tolerant parser
 * couldn't repair). We must not show this raw blob to the user as the answer. */
export function looksLikeLeakedOllamaToolProtocol(text: string): boolean {
  const value = (text || '').trim()
  if (!value) return false
  return value.includes('"taskwraith_tool"') || value.includes('"tool"')
    ? /\{[\s\S]*"(?:taskwraith_tool|tool)"[\s\S]*\}/.test(value)
    : false
}

/** Nudge for a malformed/leaked tool-call JSON that couldn't be parsed. */
export function ollamaMalformedToolJsonNudgePrompt(): string {
  return [
    'Your previous tool request could not be parsed as valid JSON.',
    'If a string argument contains source code or backslashes, escape them correctly (for example, a literal backslash must be written as \\\\, and embedded double quotes as \\").',
    'Re-issue the tool call now as a single valid JSON object (or emit a native tool call). Do not output the tool request as plain prose.'
  ].join(' ')
}

/** Heuristic: does this turn's visible `content` merely ANNOUNCE a tool call
 * (without an accompanying structured tool call) rather than answer the user?
 * Used to re-prompt instead of finalizing an intent stub like
 * "We need to use web_search tool." Conservative: requires a short response
 * that names an available tool AND uses an action cue, so substantive answers
 * that merely mention a tool aren't misclassified. */
export function looksLikeOllamaToolIntent(content: string, toolNames: string[]): boolean {
  const text = (content || '').trim().toLowerCase()
  if (!text) return false
  // Intent stubs are short; a real answer that happens to mention a tool is not.
  if (text.length > 400) return false
  const names = (toolNames || [])
    .map((name) => (name || '').trim().toLowerCase())
    .filter(Boolean)
  const mentionsToolName = names.some((name) => name && text.includes(name))
  const mentionsGenericTool = /\b(tool|function call|function)\b/.test(text)
  if (!mentionsToolName && !mentionsGenericTool) return false
  // Action cue announcing an intent to act. `\buse\b` deliberately does not
  // match "used" so past-tense summaries of completed calls don't trigger.
  const actionCue =
    /\b(use|using|call|calling|invoke|invoking|run|running|perform|performing|let'?s|lets|let us|need to|needs to|should|going to|gonna|will|i'?ll|we'?ll|proceed to|do)\b/.test(
      text
    )
  return actionCue
}

/** Resolve the text TaskWraith should treat as the model's turn output.
 * Prefers the normal `content` channel; falls back to harmony reasoning
 * (`thinking`) so models like gpt-oss that emit their answer into the
 * reasoning channel still produce a visible response instead of nothing. */
export function resolveOllamaVisibleText(turn: { content: string; thinking?: string }): string {
  return turn.content.trim() ? turn.content : turn.thinking || ''
}

/**
 * Whether a turn's reasoning (`thinking`) channel should be surfaced as a
 * separate streamed reasoning note. True whenever there is reasoning text,
 * EXCEPT when that text is being promoted to the visible answer (no content and
 * no tool call) — emitting it as a note there would duplicate the final reply.
 */
export function shouldEmitOllamaReasoning(
  turn: { content: string; thinking?: string },
  toolRequestCount: number
): boolean {
  const reasoningText = (turn.thinking || '').trim()
  if (!reasoningText) return false
  const reasoningIsAnswer = toolRequestCount === 0 && !turn.content.trim()
  return !reasoningIsAnswer
}

async function runOllamaChatTurn(input: {
  baseUrl: string
  model: string
  messages: OllamaChatMessage[]
  signal: AbortSignal
  tools?: OllamaNativeToolDefinition[]
}): Promise<OllamaChatTurnResult> {
  const response = await fetch(endpoint(input.baseUrl, '/api/chat'), {
    method: 'POST',
    signal: input.signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      stream: true,
      messages: input.messages,
      ...(input.tools && input.tools.length ? { tools: input.tools } : {}),
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
  const toolCalls: OllamaToolRequest[] = []
  let lastDone: OllamaChatChunk | null = null
  const handleChunk = (chunk: OllamaChatChunk) => {
    if (chunk.error) {
      throw new Error(chunk.error)
    }
    content += chunk.message?.content || ''
    thinking += chunk.message?.thinking || ''
    for (const call of chunk.message?.tool_calls || []) {
      const normalized = normalizeOllamaNativeToolCall(call)
      if (normalized) toolCalls.push(normalized)
    }
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
  return { content, thinking, toolCalls, lastDone }
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
    const nativeToolDefs = toolProtocolEnabled
      ? ollamaNativeToolDefinitions(toolControlTier)
      : []
    const availableToolNames = nativeToolDefs.map((def) => def.function.name)
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
        signal: controller.signal,
        tools: nativeToolDefs
      })
      if (turn.lastDone) lastDone = turn.lastDone
      // gpt-oss and other harmony-format models emit their answer into the
      // reasoning (`thinking`) channel and may leave `content` empty; fall
      // back so the run still produces a visible reply instead of nothing.
      const visibleText = resolveOllamaVisibleText(turn)
      // Prefer native structured tool calls (Ollama `tools` API). Models that
      // ignore the schema and instead embed the legacy JSON-in-prose protocol
      // still work via the fallback parser.
      const nativeCalls = toolProtocolEnabled ? turn.toolCalls : []
      const usingNativeToolCalls = nativeCalls.length > 0
      const fallbackRequest =
        !usingNativeToolCalls && toolProtocolEnabled
          ? parseOllamaToolRequest(visibleText)
          : null
      const toolRequests: OllamaToolRequest[] = usingNativeToolCalls
        ? nativeCalls
        : fallbackRequest
          ? [fallbackRequest]
          : []
      // Surface the model's reasoning (`thinking`) channel as a streamed
      // reasoning note so it renders inside the live activity viewport — except
      // when thinking is being promoted to the visible answer (no content + no
      // tool call), where emitting it here would duplicate the final reply.
      if (shouldEmitOllamaReasoning(turn, toolRequests.length)) {
        const reasoningId = `ollama-thinking-${route.appRunId || 'run'}-${turnIndex}`
        deps.sendAgentCompatLine(
          event.sender,
          'ollama',
          {
            type: 'tool_use',
            tool_id: reasoningId,
            tool_name: 'ollama_thinking',
            kind: 'think',
            parameters: { title: 'Thinking' },
            provider: 'ollama',
            server: OLLAMA_LOCAL_TOOL_SERVER
          },
          route
        )
        deps.sendAgentCompatLine(
          event.sender,
          'ollama',
          {
            type: 'tool_result',
            tool_id: reasoningId,
            tool_name: 'ollama_thinking',
            status: 'success',
            output: turn.thinking,
            provider: 'ollama',
            server: OLLAMA_LOCAL_TOOL_SERVER
          },
          route
        )
      }
      if (toolRequests.length === 0) {
        const hasContent = turn.content.trim().length > 0
        // Reasoning-only (or empty) turn while tools are available: nudge the
        // model to either call a tool or answer in prose rather than surfacing
        // hidden chain-of-thought as the final answer.
        if (!hasContent && toolProtocolEnabled && turnIndex < OLLAMA_TOOL_LOOP_LIMIT) {
          messages.push({
            role: 'user',
            content:
              toolCallCount > 0
                ? ollamaEmptyToolResponseRetryPrompt()
                : ollamaReasoningOnlyNudgePrompt()
          })
          continue
        }
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
        // Leaked tool protocol: the model tried to emit the taskwraith_tool
        // JSON contract but it couldn't be parsed (e.g. invalid escapes from
        // embedded source code). Re-prompt to re-issue valid JSON rather than
        // leaking the raw blob to the user as the final answer.
        if (
          hasContent &&
          toolProtocolEnabled &&
          turnIndex < OLLAMA_TOOL_LOOP_LIMIT &&
          looksLikeLeakedOllamaToolProtocol(turn.content)
        ) {
          messages.push({ role: 'assistant', content: turn.content })
          messages.push({ role: 'user', content: ollamaMalformedToolJsonNudgePrompt() })
          continue
        }
        // Tool-intent stub: the model announced a tool in prose ("We need to
        // use web_search") but emitted no structured tool call, then stopped.
        // Re-prompt it to actually call the tool instead of handing the stub
        // back to the user.
        if (
          hasContent &&
          toolProtocolEnabled &&
          turnIndex < OLLAMA_TOOL_LOOP_LIMIT &&
          looksLikeOllamaToolIntent(turn.content, availableToolNames)
        ) {
          messages.push({ role: 'assistant', content: turn.content })
          messages.push({
            role: 'user',
            content: ollamaToolIntentNudgePrompt(availableToolNames)
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
      // Echo the assistant's native tool-call turn so the model keeps a coherent
      // transcript across the stateless HTTP loop.
      if (usingNativeToolCalls) {
        messages.push({
          role: 'assistant',
          content: turn.content || '',
          tool_calls: nativeCalls.map((request) => ({
            function: { name: request.toolName, arguments: request.arguments }
          }))
        })
      }
      for (const toolRequest of toolRequests) {
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
        if (usingNativeToolCalls) {
          // Native protocol: feed the result back as a `role: 'tool'` message
          // so the model resumes naturally on the next turn.
          messages.push({
            role: 'tool',
            content: toolResult.output,
            tool_name: toolRequest.toolName
          })
        } else {
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
      }
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
