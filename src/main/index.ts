import { app, shell, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { spawn, ChildProcess } from 'child_process'
import { promises as fs } from 'fs'
import { createConnection, createServer, Socket, Server as NetServer } from 'net'
import * as pty from 'node-pty'
import os from 'os'
import icon from '../../resources/icon.png?asset'
import { CodexAppServerClient } from './CodexAppServerClient'
import { AppStore } from './store'
import { AppSettings, WorkspaceRecord, ChatRecord, AppearanceMode, WorkspaceFileEntry, WorkspaceFileReadResult, GeminiSessionListResult, GeminiSessionSummary, GeminiWorktreeLaunchOption, ProviderId, ExternalPathGrant, ScheduledTask, AgenticServiceId, GeminiMcpBridgeStatus, ProviderCapabilityContract, RunQueueJob, RunQueueJobFilter, RunQueueJobStatus } from './store/types'
import { TrustStatusService } from './TrustStatusService'
import { getWorkspaceDiff, captureWorkspaceSnapshot, computeRunDiff } from './DiffService'
import { isCodexSandboxToolingFailure } from './SandboxFallback'
import { isPathInsideWorkspace, resolveAgenticPermission } from './AgenticPolicy'
import { RunManager } from './RunManager'
import { buildProviderCapabilityContract } from './ProviderCapabilities'

let mainWindow: BrowserWindow | null = null
let geminiProcess: ChildProcess | null = null
let geminiSessionProcess: pty.IPty | null = null
let codexClient: CodexAppServerClient | null = null
let codexExecProcess: ChildProcess | null = null
let scheduledTaskTimer: ReturnType<typeof setTimeout> | null = null
let geminiMcpBroker: NetServer | null = null
let activeGeminiToolContext: GeminiToolContext | null = null
const NATIVE_GLASS_VIBRANCY: BrowserWindowConstructorOptions['vibrancy'] = 'sidebar'
const FILE_ICON_CACHE = new Map<string, string | null>()
const MAX_EDITOR_FILE_BYTES = 1_500_000
const MAX_EDITOR_FILES = 900
const MAX_EDITOR_DEPTH = 6
const MAX_GEMINI_SESSION_LINES = 200
const MAX_GEMINI_SESSION_LINE_LENGTH = 600
const MAX_GEMINI_DISCOVERY_FILES = 40
const MAX_GEMINI_DISCOVERY_DEPTH = 5
const MAX_GEMINI_MEMORY_FILES = 30
const SKIP_EDITOR_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.vite',
  '.turbo',
  'coverage',
  '.cache'
])
const GEMINI_CAPABILITY_KINDS = ['mcp', 'extensions', 'skills'] as const
const GEMINI_CAPABILITY_COMMANDS = {
  mcp: ['mcp', 'list'],
  extensions: ['extensions', 'list'],
  skills: ['skills', 'list']
} as const
const GEMINI_CAPABILITY_TIMEOUT_MS = 8_000
const MAX_CAPABILITY_OUTPUT_CHARS = 200_000
const MAX_SCHEDULE_TIMER_DELAY_MS = 2_147_000_000
const GEMINI_MCP_SERVER_NAME = 'agentbench'
const GEMINI_MCP_BRIDGE_ARG = '--agentbench-gemini-mcp-bridge'
const GEMINI_MCP_SOCKET_ARG = '--socket'
const isGeminiMcpBridgeProcess = process.argv.includes(GEMINI_MCP_BRIDGE_ARG)
const AGENTBENCH_MCP_TOOLS = ['run_shell_command', 'write_file', 'replace', 'read_file', 'list_directory'] as const
type AgentBenchMcpToolName = typeof AGENTBENCH_MCP_TOOLS[number]

// Ask Chromium to keep expensive renderer visuals on the GPU raster path where supported.
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')

type GeminiCapabilityKind = typeof GEMINI_CAPABILITY_KINDS[number]
type GeminiCapabilityFormat = 'json' | 'raw' | 'error'

interface GeminiCapabilityItem {
  id: string
  name: string
  status?: string
  detail?: string
  raw: string
}

interface GeminiCapabilitySection {
  kind: GeminiCapabilityKind
  command: string[]
  format: GeminiCapabilityFormat
  items: GeminiCapabilityItem[]
  stdout: string
  stderr: string
  status: number | null
  timedOut: boolean
  error?: string
  parsingError?: string
  truncated?: boolean
}

interface GeminiCapabilitiesState {
  refreshedAt: string
  workspace?: string
  sections: Record<GeminiCapabilityKind, GeminiCapabilitySection>
}

interface GeminiCapabilityProcessResult {
  args: string[]
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  error?: string
  truncated?: boolean
}

type HostWeatherKind = 'clear' | 'partly_cloudy' | 'cloudy' | 'overcast' | 'rain' | 'heavy_rain' | 'snow' | 'mist' | 'fog' | 'storm' | 'unknown'

interface HostWeatherState {
  kind: HostWeatherKind
  description: string
  temperatureC?: number
  location?: string
  isDay: boolean
  updatedAt: string
  source: 'wttr' | 'fallback'
  error?: string
}

const HOST_WEATHER_CACHE_MS = 30 * 60 * 1000
const HOST_WEATHER_TIMEOUT_MS = 5_000
let hostWeatherCache: HostWeatherState | null = null
let hostWeatherCacheAt = 0

type AgentApprovalAction = 'accept' | 'acceptForSession' | 'acceptForWorkspace' | 'decline' | 'cancel'

interface AgentRunRoute {
  appRunId?: string
  appChatId?: string
}

interface AgentRunPayload {
  provider: ProviderId
  workspace: string
  prompt: string
  appRunId?: string
  appChatId?: string
  model?: string
  reasoningEffort?: string | null
  serviceTier?: string | null
  approvalMode?: string
  imagePaths?: string[]
  providerSessionId?: string | null
  externalPathGrants?: ExternalPathGrant[]
}

interface CodexRunState {
  sender: Electron.WebContents
  threadId: string
  workspacePath?: string
  turnId?: string
  model: string
  appRunId?: string
  appChatId?: string
  tokenUsage?: any
  assistantTextByItemId: Map<string, string>
  timelineStartedItemIds: Set<string>
  reasoningTextByItemId: Map<string, string>
  commandOutputByItemId: Map<string, string>
  filePatchByItemId: Map<string, any>
  hostRerunRequestedItemIds: Set<string>
  completed: boolean
}

interface GeminiToolContext {
  sender: Electron.WebContents
  workspacePath: string
  appRunId?: string
  appChatId?: string
  providerSessionId?: string | null
}

interface AgenticApprovalWaiter {
  provider: ProviderId
  service: AgenticServiceId
  workspacePath?: string
  runId?: string
  resolve: (allowed: boolean) => void
}

interface HostCommandApproval {
  sender: Electron.WebContents
  provider: 'codex'
  command: unknown
  commandText: string
  cwd: string
  workspacePath: string
  threadId: string
  model: string
  appRunId?: string
  appChatId?: string
  reason: string
  output: string
}

interface HostCommandResult {
  stdout: string
  stderr: string
  exitCode: number | null
  error?: string
  timedOut: boolean
  durationMs: number
}

const CODEX_STATIC_MODELS = [
  { id: 'gpt-5.5', label: 'GPT-5.5', description: 'Default Codex model', isDefault: true },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', description: 'Research preview where available' }
]
const CLAUDE_STATIC_MODELS = [
  { id: 'default', label: 'Default', description: 'Claude Code configured default', isDefault: true },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'haiku', label: 'Haiku' },
  { id: 'best', label: 'Best available' },
  { id: 'custom', label: 'Custom model ID' }
]
const KIMI_STATIC_MODELS = [
  { id: 'default', label: 'Default', description: 'Kimi configured default', isDefault: true },
  { id: 'kimi-k2', label: 'Kimi K2' },
  { id: 'kimi-k2-turbo', label: 'Kimi K2 Turbo' },
  { id: 'kimi-latest', label: 'Kimi Latest' },
  { id: 'custom', label: 'Custom model ID' }
]
const pendingCodexApprovals = new Map<string, { rpcId: number | string; method: string; params: any; service?: AgenticServiceId; workspacePath?: string; runId?: string }>()
const pendingKimiApprovals = new Map<string, { child: ChildProcess; rpcId: number | string; params: any; runId?: string }>()
const pendingGeminiToolApprovals = new Map<string, AgenticApprovalWaiter>()
const pendingHostCommandApprovals = new Map<string, HostCommandApproval>()
const agenticSessionGrants = new Set<string>()
let activeCodexRunState: CodexRunState | null = null
const cliProviderProcesses = new Map<ProviderId, ChildProcess>()
const cliProviderAbortControllers = new Map<ProviderId, AbortController>()

interface ResolvedProviderBinary {
  provider: ProviderId
  binaryPath: string | null
  source: 'settings' | 'path' | 'common' | 'missing'
  error?: string
}

interface CliProviderStreamState {
  provider: ProviderId
  sender: Electron.WebContents
  startedAt: number
  model: string
  fallback: boolean
  completed: boolean
  assistantText: string
  providerSessionId?: string | null
  runId?: string | null
  appRunId?: string
  appChatId?: string
  tokenUsage?: any
}

const runManager = new RunManager<any>()

interface CodexUsageCredential {
  accessToken: string
  accountId: string
  importedAt?: string
  source?: string
}

let inMemoryCodexUsageCredential: CodexUsageCredential | null = null

function providerDisplayName(provider: ProviderId): string {
  if (provider === 'codex') return 'Codex'
  if (provider === 'claude') return 'Claude'
  if (provider === 'kimi') return 'Kimi'
  return 'Gemini'
}

function emitRunQueueChanged(): void {
  mainWindow?.webContents.send('run-queue-changed', AppStore.getRunQueueJobs({ includeTerminal: true }))
}

function mapRunSessionStatusToQueueStatus(status: string): RunQueueJobStatus {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'starting') return 'starting'
  return 'active'
}

function persistRunSessionQueueState(session: ReturnType<typeof runManager.get>): void {
  if (!session) return
  const status = mapRunSessionStatusToQueueStatus(session.status)
  const existing = AppStore.getRunQueueJob(session.runId)
  const processLike = session.process as unknown as { pid?: unknown } | undefined
  const processPid = typeof processLike?.pid === 'number'
    ? processLike.pid
    : undefined
  const partial: Partial<RunQueueJob> = {
    provider: session.provider,
    chatId: session.appChatId,
    workspacePath: session.workspacePath || existing?.workspacePath || '',
    providerSessionId: session.providerSessionId,
    providerRunId: session.providerRunId,
    processPid,
    status
  }

  if (existing) {
    AppStore.updateRunQueueJob(session.runId, partial)
  } else if (partial.workspacePath) {
    AppStore.saveRunQueueJob({
      id: session.runId,
      runId: session.runId,
      provider: session.provider,
      chatId: session.appChatId,
      workspacePath: partial.workspacePath,
      source: 'system',
      status,
      promptPreview: `${providerDisplayName(session.provider)} run`
    })
  }
  emitRunQueueChanged()
}

runManager.onChange((event) => {
  if (event.type === 'removed') return
  persistRunSessionQueueState(event.session)
})

const AGENTIC_SERVICE_LABELS: Record<AgenticServiceId, string> = {
  shellCommands: 'Shell commands',
  fileChanges: 'File changes',
  mcpTools: 'MCP and tool calls'
}

function getAgenticServicePolicy(service: AgenticServiceId, settings: AppSettings = AppStore.getSettings()) {
  return settings.agenticServices?.[service] || 'ask'
}

function hasAgenticWorkspaceGrant(
  settings: AppSettings,
  provider: ProviderId,
  workspacePath: string | undefined,
  service: AgenticServiceId
): boolean {
  if (!workspacePath) return false
  const normalizedWorkspace = resolve(workspacePath)
  return (settings.agenticWorkspaceGrants || []).some((grant) => {
    if (!grant || grant.provider !== provider || grant.service !== service || !grant.workspacePath) return false
    return resolve(grant.workspacePath) === normalizedWorkspace
  })
}

function upsertAgenticWorkspaceGrant(provider: ProviderId, workspacePath: string | undefined, service: AgenticServiceId): void {
  if (!workspacePath) return
  const settings = AppStore.getSettings()
  const normalizedWorkspace = resolve(workspacePath)
  const now = new Date().toISOString()
  const grants = (settings.agenticWorkspaceGrants || []).filter((grant) => {
    if (!grant || grant.provider !== provider || grant.service !== service || !grant.workspacePath) return true
    return resolve(grant.workspacePath) !== normalizedWorkspace
  })
  grants.push({
    id: `${provider}-${service}-${Date.now()}`,
    provider,
    service,
    workspacePath: normalizedWorkspace,
    createdAt: now,
    updatedAt: now
  })
  AppStore.updateSettings({ agenticWorkspaceGrants: grants })
}

function agenticSessionGrantKey(provider: ProviderId, workspacePath: string | undefined, service: AgenticServiceId): string {
  return `${provider}:${service}:${workspacePath ? resolve(workspacePath) : 'global'}`
}

function hasAgenticSessionGrant(provider: ProviderId, workspacePath: string | undefined, service: AgenticServiceId, runId?: string): boolean {
  if (runId && runManager.hasSessionGrant(runId, service)) return true
  return agenticSessionGrants.has(agenticSessionGrantKey(provider, workspacePath, service))
}

function addAgenticSessionGrant(provider: ProviderId, workspacePath: string | undefined, service: AgenticServiceId, runId?: string): void {
  if (runId && runManager.get(runId)) {
    runManager.addSessionGrant(runId, service)
    return
  }
  agenticSessionGrants.add(agenticSessionGrantKey(provider, workspacePath, service))
}

function approvalActionsForPolicy(policy: string, workspacePath?: string): AgentApprovalAction[] {
  const actions: AgentApprovalAction[] = ['accept']
  if (policy === 'workspace' && workspacePath) {
    actions.push('acceptForWorkspace')
  }
  actions.push('acceptForSession', 'decline')
  return actions
}

async function requestAgenticServiceApproval(
  sender: Electron.WebContents | null,
  provider: ProviderId,
  service: AgenticServiceId,
  workspacePath: string | undefined,
  request: {
    method: string
    title: string
    body: string
    preview?: any
    runId?: string
  }
): Promise<boolean> {
  const settings = AppStore.getSettings()
  const policy = getAgenticServicePolicy(service, settings)
  const label = AGENTIC_SERVICE_LABELS[service]
  const decision = resolveAgenticPermission(
    policy,
    policy === 'workspace' && hasAgenticWorkspaceGrant(settings, provider, workspacePath, service),
    hasAgenticSessionGrant(provider, workspacePath, service, request.runId)
  )

  if (decision === 'deny') {
    sender?.send('agent-error', { provider, error: `${label} blocked by AgentBench settings.` })
    return false
  }
  if (decision === 'allow') {
    return true
  }
  if (!sender || sender.isDestroyed()) {
    return false
  }

  const approvalId = Date.now() + '-' + Math.random().toString(36).slice(2)
  const actions = approvalActionsForPolicy(policy, workspacePath)
  return new Promise((resolveApproval) => {
    pendingGeminiToolApprovals.set(approvalId, {
      provider,
      service,
      workspacePath,
      runId: request.runId,
      resolve: resolveApproval
    })
    runManager.registerApproval(request.runId, approvalId)
    const session = runManager.get(request.runId)
    sender.send('agent-approval-request', {
      provider,
      appRunId: session?.runId,
      appChatId: session?.appChatId,
      id: approvalId,
      approvalId,
      method: request.method,
      title: request.title,
      body: request.body,
      preview: { ...(request.preview || {}), actions },
      actions
    })
  })
}

function resolveWorkspaceDirectory(workspacePath: string, requestedCwd?: string | null): string {
  const workspaceRoot = resolve(workspacePath)
  const cwd = requestedCwd && requestedCwd.trim()
    ? isAbsolute(requestedCwd) ? resolve(requestedCwd) : resolve(workspaceRoot, requestedCwd)
    : workspaceRoot
  if (!isPathInsideWorkspace(workspaceRoot, cwd)) {
    throw new Error('Command cwd is outside the workspace.')
  }
  return cwd
}

function resolveGeminiMcpPath(workspacePath: string, filePath: string): string {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('A workspace path is required.')
  }
  return resolveWorkspaceChild(workspacePath, filePath)
}

function previewForGeminiMcpTool(toolName: AgentBenchMcpToolName, args: Record<string, any>, cwd: string, workspacePath: string) {
  if (toolName === 'run_shell_command') {
    return {
      title: 'Approve Gemini shell command',
      body: `${String(args.command || '')}\n${cwd}`,
      service: 'shellCommands' as AgenticServiceId,
      preview: {
        kind: 'command',
        command: String(args.command || ''),
        cwd
      }
    }
  }

  if (toolName === 'write_file' || toolName === 'replace') {
    const filePath = String(args.path || args.file_path || '')
    return {
      title: toolName === 'write_file' ? 'Approve Gemini file write' : 'Approve Gemini file edit',
      body: filePath ? toWorkspaceRelativePath(workspacePath, resolveGeminiMcpPath(workspacePath, filePath)) : toolName,
      service: 'fileChanges' as AgenticServiceId,
      preview: {
        kind: 'fileChange',
        changes: [{ kind: toolName === 'write_file' ? 'write' : 'replace', path: filePath }],
        patchPreview: toolName === 'replace'
          ? [
              `--- old_string`,
              String(args.old_string || args.oldString || '').slice(0, 2000),
              `+++ new_string`,
              String(args.new_string || args.newString || '').slice(0, 2000)
            ].join('\n')
          : String(args.content || '').slice(0, 2000)
      }
    }
  }

  return {
    title: 'Approve Gemini tool call',
    body: toolName,
    service: 'mcpTools' as AgenticServiceId,
    preview: {
      kind: 'tool',
      toolName,
      params: args
    }
  }
}

function runHostCommand(command: unknown, cwd: string, timeoutMs = 120_000): Promise<HostCommandResult> {
  return new Promise((resolveRun) => {
    const startedAt = Date.now()
    let stdout = ''
    let stderr = ''
    let settled = false
    let child: ChildProcess
    const commandText = codexCommandText(command)

    try {
      if (Array.isArray(command) && command.length > 0) {
        const [binary, ...args] = command.map(codexString)
        child = spawn(binary, args, {
          cwd,
          shell: false,
          env: createCliEnv({ FORCE_COLOR: '0', NO_COLOR: '1' }, binary)
        })
      } else {
        const shellCommand = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh')
        const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-Command', commandText] : ['-lc', commandText]
        child = spawn(shellCommand, shellArgs, {
          cwd,
          shell: false,
          env: createCliEnv({ FORCE_COLOR: '0', NO_COLOR: '1' }, shellCommand)
        })
      }
    } catch (error) {
      resolveRun({
        stdout,
        stderr,
        exitCode: null,
        error: error instanceof Error ? error.message : String(error),
        timedOut: false,
        durationMs: Date.now() - startedAt
      })
      return
    }

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      resolveRun({
        stdout,
        stderr,
        exitCode: null,
        error: 'Command timed out.',
        timedOut: true,
        durationMs: Date.now() - startedAt
      })
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
      if (stdout.length > 500_000) stdout = stdout.slice(-500_000)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 500_000) stderr = stderr.slice(-500_000)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveRun({
        stdout,
        stderr,
        exitCode: null,
        error: error.message,
        timedOut: false,
        durationMs: Date.now() - startedAt
      })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveRun({
        stdout,
        stderr,
        exitCode: code,
        timedOut: false,
        durationMs: Date.now() - startedAt
      })
    })
  })
}

function codexNeedsApprovalGate(settings: AppSettings = AppStore.getSettings()): boolean {
  const services = settings.agenticServices
  return !services || services.shellCommands !== 'allow' || services.fileChanges !== 'allow' || services.mcpTools !== 'allow'
}

function resolveGeminiApprovalModeForServices(approvalMode: string, settings: AppSettings): string {
  const services = settings.agenticServices
  if (!services || approvalMode === 'plan') return approvalMode
  if (services.shellCommands === 'deny' || services.fileChanges === 'deny') return 'plan'
  if (approvalMode === 'auto_edit' && (services.shellCommands !== 'allow' || services.fileChanges !== 'allow')) {
    return 'default'
  }
  return approvalMode
}

function clearScheduledTaskTimer() {
  if (scheduledTaskTimer) {
    clearTimeout(scheduledTaskTimer)
    scheduledTaskTimer = null
  }
}

function emitDueScheduledTasks() {
  const dueTasks = AppStore.getDueScheduledTasks()
  for (const task of dueTasks) {
    const updated = AppStore.updateScheduledTask(task.id, {
      status: 'due',
      firedAt: new Date().toISOString()
    })
    mainWindow?.webContents.send('scheduled-task-due', updated || task)
  }
  scheduleNextTaskTimer()
}

function scheduleNextTaskTimer() {
  clearScheduledTaskTimer()
  const nextTask = AppStore.getScheduledTasks()
    .filter((task) => task.status === 'pending')
    .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime())[0]
  if (!nextTask) {
    return
  }
  const runAtMs = new Date(nextTask.runAt).getTime()
  if (!Number.isFinite(runAtMs)) {
    return
  }
  const delay = Math.max(0, Math.min(MAX_SCHEDULE_TIMER_DELAY_MS, runAtMs - Date.now()))
  scheduledTaskTimer = setTimeout(emitDueScheduledTasks, delay)
}

function providerBinaryName(provider: ProviderId): string {
  return provider === 'kimi' ? 'kimi' : provider === 'claude' ? 'claude' : provider
}

function expandHomePath(value?: string | null): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw === '~') return os.homedir()
  if (raw.startsWith('~/')) return join(os.homedir(), raw.slice(2))
  return raw
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate)
    return stat.isFile() || stat.isSymbolicLink()
  } catch {
    return false
  }
}

function getCliSearchDirs(binaryPath?: string | null): string[] {
  const dirs = [
    binaryPath ? dirname(binaryPath) : '',
    ...(process.env.PATH || '').split(delimiter),
    join(os.homedir(), '.local', 'bin'),
    join(os.homedir(), '.npm-global', 'bin'),
    join(os.homedir(), '.bun', 'bin'),
    join(os.homedir(), '.cargo', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ].filter(Boolean)

  return Array.from(new Set(dirs))
}

function createCliEnv(extra: Record<string, string>, binaryPath?: string | null): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    PATH: getCliSearchDirs(binaryPath).join(delimiter),
    ...extra
  }
}

async function resolveCliProviderBinary(provider: ProviderId): Promise<ResolvedProviderBinary> {
  const binaryName = providerBinaryName(provider)
  const settings = AppStore.getSettings()
  const configured = provider === 'claude' ? settings.claudeBinaryPath : provider === 'kimi' ? settings.kimiBinaryPath : ''
  const configuredPath = expandHomePath(configured)

  if (configuredPath) {
    if (await fileExists(configuredPath)) {
      return { provider, binaryPath: configuredPath, source: 'settings' }
    }
    return {
      provider,
      binaryPath: null,
      source: 'settings',
      error: `Configured ${providerDisplayName(provider)} binary was not found: ${configuredPath}`
    }
  }

  const pathCandidates = getCliSearchDirs().map((entry) => join(entry, binaryName))
  const commonCandidates = [
    join(os.homedir(), '.local', 'bin', binaryName),
    join(os.homedir(), '.npm-global', 'bin', binaryName),
    join(os.homedir(), '.bun', 'bin', binaryName),
    join(os.homedir(), '.cargo', 'bin', binaryName),
    join('/opt/homebrew/bin', binaryName),
    join('/usr/local/bin', binaryName)
  ]
  const seen = new Set<string>()
  for (const candidate of [...pathCandidates, ...commonCandidates]) {
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    if (await fileExists(candidate)) {
      return {
        provider,
        binaryPath: candidate,
        source: pathCandidates.includes(candidate) ? 'path' : 'common'
      }
    }
  }

  return {
    provider,
    binaryPath: null,
    source: 'missing',
    error: `${providerDisplayName(provider)} CLI was not found on PATH or common local install locations.`
  }
}

function captureProcessOutput(command: string, args: string[], cwd?: string, timeoutMs = 8_000): Promise<{ stdout: string; stderr: string; code: number | null; error?: string; timedOut: boolean }> {
  return new Promise((resolveCapture) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(command, args, {
      cwd,
      shell: false,
      env: createCliEnv({ FORCE_COLOR: '0', NO_COLOR: '1' }, command)
    })
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolveCapture({ stdout, stderr, code: null, timedOut: true, error: 'Timed out.' })
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
      if (stdout.length > 80_000) stdout = stdout.slice(-80_000)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 80_000) stderr = stderr.slice(-80_000)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveCapture({ stdout, stderr, code: null, timedOut: false, error: error.message })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveCapture({ stdout, stderr, code, timedOut: false })
    })
  })
}

async function readResolvedCliVersion(resolved: ResolvedProviderBinary): Promise<string> {
  if (!resolved.binaryPath) return 'missing'
  const output = await captureProcessOutput(resolved.binaryPath, ['--version'])
  return (output.stdout || output.stderr || output.error || 'unknown').trim().split('\n')[0] || 'unknown'
}

async function readClaudeAuthState(resolved: ResolvedProviderBinary): Promise<string> {
  if (!resolved.binaryPath) return 'unknown'
  const output = await captureProcessOutput(resolved.binaryPath, ['auth', 'status'], undefined, 8_000)
  if (output.code === 0) return 'authenticated'
  if ((output.stdout + output.stderr).toLowerCase().includes('not')) return 'missing'
  return process.env.ANTHROPIC_API_KEY ? 'api-key' : 'unknown'
}

async function getCliProviderStatus(provider: ProviderId) {
  const resolved = await resolveCliProviderBinary(provider)
  if (!resolved.binaryPath) {
    return {
      provider,
      label: providerDisplayName(provider),
      available: false,
      version: 'missing',
      appServer: 'unsupported',
      authState: 'unknown',
      setupRequired: true,
      binaryPath: null,
      binarySource: resolved.source,
      error: resolved.error
    }
  }

  return {
    provider,
    label: providerDisplayName(provider),
    available: true,
    version: await readResolvedCliVersion(resolved),
    appServer: provider === 'kimi' ? 'wire-supported' : 'sdk-or-cli',
    authState: provider === 'claude' ? await readClaudeAuthState(resolved) : 'unknown',
    setupRequired: false,
    binaryPath: resolved.binaryPath,
    binarySource: resolved.source,
    supportsSessions: true,
    supportsApprovals: provider === 'kimi',
    supportsQuota: false,
    supportsMcpStatus: false
  }
}

function getCliProviderMcpStatus(provider: ProviderId) {
  return {
    provider,
    available: false,
    sections: [],
    message: `${providerDisplayName(provider)} MCP/server status is not exposed through a safe structured app API in this first pass. Use the provider terminal command for live MCP inspection.`
  }
}

async function getAgentStatusSnapshot(provider: ProviderId): Promise<any> {
  if (provider === 'codex') {
    let accountStatus: any = null
    let rateLimitStatus: any = null
    let codexUsage: any = null
    try {
      const client = getCodexClient()
      await client.ensureStarted(app.getVersion())
      accountStatus = await client.request('account/read', { refreshToken: false }, 15_000)
      rateLimitStatus = await client.request('account/rateLimits/read', {}, 15_000)
    } catch (error) {
      accountStatus = { error: error instanceof Error ? error.message : String(error) }
    }
    try {
      codexUsage = await fetchCodexUsageSnapshot()
    } catch (error) {
      codexUsage = {
        configured: Boolean(AppStore.getSettings().codexUsageCredential?.accountId),
        source: 'chatgpt-wham',
        error: error instanceof Error ? error.message : String(error)
      }
    }
    const account = accountStatus?.account || null
    return {
      provider,
      version: await readCliVersion('codex'),
      appServer: codexClient ? 'started' : 'lazy',
      authState: account ? account.type : accountStatus?.requiresOpenaiAuth ? 'missing' : 'not-required',
      planType: account?.planType || null,
      account,
      requiresOpenaiAuth: Boolean(accountStatus?.requiresOpenaiAuth),
      rateLimits: rateLimitStatus?.rateLimits || null,
      rateLimitsByLimitId: rateLimitStatus?.rateLimitsByLimitId || null,
      codexUsage,
      error: accountStatus?.error
    }
  }
  if (provider === 'claude' || provider === 'kimi') {
    return getCliProviderStatus(provider)
  }
  const geminiStatus = await getCliProviderStatus('gemini')
  return {
    ...geminiStatus,
    appServer: 'unsupported',
    supportsMcpStatus: false
  }
}

async function getAgentMcpStatusSnapshot(provider: ProviderId): Promise<any> {
  if (provider === 'claude' || provider === 'kimi') {
    return getCliProviderMcpStatus(provider)
  }
  if (provider !== 'codex') {
    return null
  }
  const client = getCodexClient()
  await client.ensureStarted(app.getVersion())
  return client.request('mcpServerStatus/list', {
    detail: 'toolsAndAuthOnly',
    limit: 100
  }, 20_000)
}

async function getProviderCapabilityContract(
  provider: ProviderId,
  workspacePath?: string,
  approvalMode?: string
): Promise<ProviderCapabilityContract> {
  const settings = AppStore.getSettings()
  const [status, mcpStatus, geminiBridgeStatus] = await Promise.all([
    getAgentStatusSnapshot(provider).catch((error) => ({
      provider,
      available: false,
      setupRequired: true,
      error: error instanceof Error ? error.message : String(error)
    })),
    getAgentMcpStatusSnapshot(provider).catch((error) => ({
      provider,
      available: false,
      error: error instanceof Error ? error.message : String(error)
    })),
    provider === 'gemini' ? getGeminiMcpBridgeStatus().catch((error) => ({
      checkedAt: new Date().toISOString(),
      enabled: Boolean(settings.geminiMcpBridgeEnabled),
      installed: false,
      available: false,
      serverName: GEMINI_MCP_SERVER_NAME,
      error: error instanceof Error ? error.message : String(error),
      message: 'Gemini MCP bridge status check failed.'
    } satisfies GeminiMcpBridgeStatus)) : Promise.resolve(null)
  ])

  return buildProviderCapabilityContract({
    provider,
    settings,
    workspacePath,
    approvalMode,
    status,
    mcpStatus,
    geminiMcpBridgeStatus: geminiBridgeStatus
  })
}

async function emitProviderCapabilityWarnings(
  sender: Electron.WebContents,
  provider: ProviderId,
  workspacePath: string | undefined,
  approvalMode: string | undefined,
  route?: AgentRunRoute | null,
  options: { excludeIds?: string[] } = {}
): Promise<void> {
  const excluded = new Set(options.excludeIds || [])
  const contract = await getProviderCapabilityContract(provider, workspacePath, approvalMode)
  for (const capabilityWarning of contract.warnings) {
    if (excluded.has(capabilityWarning.id)) continue
    if (capabilityWarning.severity === 'info') continue
    sendAgentCompatLine(sender, provider, {
      type: 'provider_warning',
      provider,
      severity: capabilityWarning.severity,
      title: capabilityWarning.title,
      message: capabilityWarning.message,
      capabilityWarning
    }, route)
  }
}

function redactAccountId(accountId?: string | null): string | null {
  const raw = String(accountId || '').trim()
  if (!raw) return null
  return raw.length <= 10 ? raw : `${raw.slice(0, 6)}...${raw.slice(-4)}`
}

function parseCodexUsageCredential(raw: string, source: string): CodexUsageCredential {
  const parsed = JSON.parse(raw)
  const tokens = parsed?.tokens && typeof parsed.tokens === 'object' ? parsed.tokens : parsed
  const accessToken = String(tokens?.access_token || tokens?.accessToken || '').trim()
  const accountId = String(tokens?.account_id || tokens?.accountId || tokens?.accountID || '').trim()
  if (!accessToken) {
    throw new Error('Codex auth JSON did not contain an access_token.')
  }
  if (!accountId) {
    throw new Error('Codex auth JSON did not contain an account_id.')
  }
  return {
    accessToken,
    accountId,
    importedAt: new Date().toISOString(),
    source
  }
}

function storedCodexUsageCredential(): CodexUsageCredential | null {
  if (inMemoryCodexUsageCredential) {
    return inMemoryCodexUsageCredential
  }
  const stored = AppStore.getSettings().codexUsageCredential
  if (!stored?.encryptedAccessToken || !stored.accountId || !safeStorage.isEncryptionAvailable()) {
    return null
  }
  try {
    const accessToken = safeStorage.decryptString(Buffer.from(stored.encryptedAccessToken, 'base64')).trim()
    if (!accessToken) return null
    return {
      accessToken,
      accountId: stored.accountId,
      importedAt: stored.importedAt,
      source: stored.source
    }
  } catch {
    return null
  }
}

function storeCodexUsageCredential(credential: CodexUsageCredential) {
  inMemoryCodexUsageCredential = credential
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  const encryptedAccessToken = encryptionAvailable
    ? safeStorage.encryptString(credential.accessToken).toString('base64')
    : undefined
  AppStore.updateSettings({
    codexUsageCredential: {
      encryptedAccessToken,
      accountId: credential.accountId,
      importedAt: credential.importedAt || new Date().toISOString(),
      source: credential.source,
      encryptionAvailable
    }
  })
}

function clearCodexUsageCredential() {
  inMemoryCodexUsageCredential = null
  AppStore.updateSettings({ codexUsageCredential: undefined as any })
}

async function resolveCodexUsageImportPath(event: Electron.IpcMainInvokeEvent, requestedPath?: string | null): Promise<string | null> {
  const explicitPath = expandHomePath(requestedPath)
  if (explicitPath) return explicitPath
  const defaultPath = join(os.homedir(), '.codex', 'auth.json')
  if (await fileExists(defaultPath)) {
    return defaultPath
  }
  const parentWindow = BrowserWindow.fromWebContents(event.sender)
  const dialogOptions = {
    title: 'Import Codex usage session',
    message: 'Select Codex auth.json to import usage limits.',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  } as Electron.OpenDialogOptions
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0]
}

function normalizeCodexUsageWindow(id: string, label: string, windowKind: string, window: any) {
  const usedPercent = Math.max(0, Math.min(100, Number(window?.used_percent || window?.usedPercent || 0)))
  const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent))
  const resetAtSeconds = Number(window?.reset_at || window?.resetAt || 0)
  const resetAfterSeconds = Number(window?.reset_after_seconds || window?.resetAfterSeconds || 0)
  const limitWindowSeconds = Number(window?.limit_window_seconds || window?.limitWindowSeconds || 0)
  return {
    id,
    label,
    windowKind,
    usedPercent,
    remainingPercent,
    limitWindowSeconds,
    resetAfterSeconds,
    resetAt: resetAtSeconds > 0 ? new Date(resetAtSeconds * 1000).toISOString() : undefined,
    limitLabel: `${Math.round(remainingPercent)}% remaining`
  }
}

function codexUsageWindowIdentity(label: string): string {
  const normalized = label.toLowerCase()
  const spark = /spark|gpt-5\.3-codex-spark/.test(normalized)
  const weekly = /weekly|7.?day/.test(normalized)
  if (spark && weekly) return 'spark-weekly'
  if (spark) return 'spark-5h'
  if (weekly) return 'weekly'
  return '5h'
}

function dedupeCodexUsageWindows(windows: any[]): any[] {
  const seen = new Set<string>()
  return windows.filter((windowEntry) => {
    const key = [
      codexUsageWindowIdentity(String(windowEntry?.label || '')),
      windowEntry?.resetAt || '',
      Math.round(Number(windowEntry?.remainingPercent || 0))
    ].join(':')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function codexUsageWindowValue(rateLimit: any, kind: 'primary' | 'secondary') {
  if (!rateLimit || typeof rateLimit !== 'object') return null
  if (kind === 'primary') {
    return rateLimit.primary_window || rateLimit.primaryWindow || rateLimit.primary || rateLimit.five_hour_window || rateLimit.fiveHourWindow || null
  }
  return rateLimit.secondary_window || rateLimit.secondaryWindow || rateLimit.secondary || rateLimit.weekly_window || rateLimit.weeklyWindow || null
}

function normalizeCodexUsagePayload(payload: any, credential: CodexUsageCredential) {
  const windows: any[] = []
  const rateLimit = payload?.rate_limit || payload?.rateLimit || payload?.rate_limits || payload?.rateLimits || {}
  const primaryWindow = codexUsageWindowValue(rateLimit, 'primary')
  const secondaryWindow = codexUsageWindowValue(rateLimit, 'secondary')
  if (primaryWindow) {
    windows.push(normalizeCodexUsageWindow('primary-5h', '5h', 'session', primaryWindow))
  }
  if (secondaryWindow) {
    windows.push(normalizeCodexUsageWindow('secondary-weekly', 'Weekly', 'weekly', secondaryWindow))
  }
  const additional = Array.isArray(payload?.additional_rate_limits)
    ? payload.additional_rate_limits
    : Array.isArray(payload?.additionalRateLimits)
      ? payload.additionalRateLimits
    : []
  additional.forEach((limit: any, index: number) => {
    const rawName = String(limit?.limit_name || limit?.limitName || limit?.metered_feature || limit?.meteredFeature || 'Additional Codex').trim() || 'Additional Codex'
    const nested = limit?.rate_limit || limit?.rateLimit || {}
    const nestedPrimary = codexUsageWindowValue(nested, 'primary')
    const nestedSecondary = codexUsageWindowValue(nested, 'secondary')
    if (nestedPrimary) {
      windows.push(normalizeCodexUsageWindow(`additional-${index}-5h`, `${rawName} 5h`, 'session', nestedPrimary))
    }
    if (nestedSecondary) {
      windows.push(normalizeCodexUsageWindow(`additional-${index}-weekly`, `${rawName} Weekly`, 'weekly', nestedSecondary))
    }
  })
  const creditBalance = payload?.credits?.balance
  return {
    configured: true,
    source: 'chatgpt-wham',
    accountId: redactAccountId(credential.accountId),
    importedAt: credential.importedAt,
    fetchedAt: new Date().toISOString(),
    planType: payload?.plan_type || payload?.planType || null,
    windows: dedupeCodexUsageWindows(windows),
    balances: creditBalance === undefined || creditBalance === null ? [] : [{
      label: 'Credits Remaining',
      amount: Number(creditBalance),
      unit: 'credits'
    }]
  }
}

async function fetchCodexUsageSnapshot(): Promise<any> {
  const credential = storedCodexUsageCredential()
  if (!credential) {
    const stored = AppStore.getSettings().codexUsageCredential
    return {
      configured: Boolean(stored?.accountId),
      source: stored?.source || null,
      accountId: redactAccountId(stored?.accountId),
      importedAt: stored?.importedAt,
      encryptionAvailable: stored?.encryptionAvailable ?? safeStorage.isEncryptionAvailable(),
      error: stored?.accountId ? 'Codex usage token is not available in this session. Re-import Codex auth to refresh usage.' : 'Codex usage import is not configured.'
    }
  }

  const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${credential.accessToken}`,
      'chatgpt-account-id': credential.accountId,
      Accept: 'application/json'
    }
  })
  if (response.status === 401 || response.status === 403) {
    throw new Error('Imported Codex session is expired or not authorized.')
  }
  if (response.status === 429) {
    throw new Error('Codex usage endpoint is rate limited.')
  }
  if (!response.ok) {
    throw new Error(`Codex usage endpoint returned HTTP ${response.status}.`)
  }
  const payload = await response.json()
  return normalizeCodexUsagePayload(payload, credential)
}

async function importCodexUsageCredential(event: Electron.IpcMainInvokeEvent, requestedPath?: string | null) {
  const credentialPath = await resolveCodexUsageImportPath(event, requestedPath)
  if (!credentialPath) {
    return { imported: false, cancelled: true }
  }
  const raw = await fs.readFile(credentialPath, 'utf8')
  const credential = parseCodexUsageCredential(raw, credentialPath)
  storeCodexUsageCredential(credential)
  let snapshot: any = null
  try {
    snapshot = await fetchCodexUsageSnapshot()
  } catch (error) {
    snapshot = {
      configured: true,
      source: 'chatgpt-wham',
      accountId: redactAccountId(credential.accountId),
      importedAt: credential.importedAt,
      error: error instanceof Error ? error.message : String(error)
    }
  }
  return {
    imported: true,
    accountId: redactAccountId(credential.accountId),
    importedAt: credential.importedAt,
    source: credentialPath,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    snapshot
  }
}

function getStaticProviderModels(provider: ProviderId) {
  if (provider === 'claude') return CLAUDE_STATIC_MODELS
  if (provider === 'kimi') return KIMI_STATIC_MODELS
  return [
    { id: 'cli-default', label: 'CLI Default', isDefault: true },
    { id: 'auto', label: 'Auto' },
    { id: 'pro', label: 'Pro' },
    { id: 'flash', label: 'Flash' },
    { id: 'flash-lite', label: 'Flash Lite' }
  ]
}

function normalizeCliProviderModel(provider: ProviderId, model?: string | null): string {
  const trimmed = typeof model === 'string' ? model.trim() : ''
  if (!trimmed || trimmed === 'cli-default' || trimmed === 'custom') return 'default'
  if (provider === 'claude' && ['default', 'sonnet', 'opus', 'haiku', 'best'].includes(trimmed)) return trimmed
  if (provider === 'kimi' && ['default', 'kimi-k2', 'kimi-k2-turbo', 'kimi-latest'].includes(trimmed)) return trimmed
  return trimmed || 'default'
}

function claudePermissionModeForApproval(approvalMode?: string): string {
  if (approvalMode === 'plan') return 'plan'
  if (approvalMode === 'auto_edit') return 'acceptEdits'
  return 'default'
}

function contentPartsToText(value: any): string {
  if (typeof value === 'string') return value
  if (!value) return ''
  if (Array.isArray(value)) {
    return value.map(contentPartsToText).filter(Boolean).join('')
  }
  if (typeof value !== 'object') return ''
  if (typeof value.text === 'string') return value.text
  if (typeof value.think === 'string') return value.think
  if (typeof value.content === 'string') return value.content
  if (Array.isArray(value.content)) return contentPartsToText(value.content)
  if (Array.isArray(value.message?.content)) return contentPartsToText(value.message.content)
  return ''
}

function extractProviderText(event: any): string {
  if (!event) return ''
  if (typeof event === 'string') return event
  const params = event.params || {}
  const payload = params.payload || event.payload || {}
  if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') return event.delta.text || ''
  if (event.type === 'assistant' || event.type === 'message' || event.type === 'message_delta') return contentPartsToText(event.message?.content || event.content || event.delta)
  if (event.type === 'result' && typeof event.result === 'string') return event.result
  if (event.method === 'event' && params.type === 'ContentPart') return contentPartsToText(payload)
  if (params.type === 'ContentPart') return contentPartsToText(payload)
  if (typeof event.text === 'string') return event.text
  return ''
}

function extractProviderUsage(provider: ProviderId, event: any): any {
  const usage = event?.usage || event?.message?.usage || event?.params?.payload?.token_usage || event?.params?.token_usage
  if (!usage) return null
  if (provider === 'kimi') {
    const input = Number(usage.input_other || 0) + Number(usage.input_cache_read || 0) + Number(usage.input_cache_creation || 0)
    const output = Number(usage.output || 0)
    return { input_tokens: input, output_tokens: output, total_tokens: input + output }
  }
  return usage
}

function extractProviderSessionId(event: any): string | null {
  return event?.session_id || event?.sessionId || event?.session?.id || event?.message?.session_id || event?.params?.session_id || null
}

function emitCliProviderToolEvent(state: CliProviderStreamState, event: any) {
  const params = event?.params || {}
  const payload = params.payload || event?.payload || {}
  const contentItems = Array.isArray(event?.message?.content) ? event.message.content : Array.isArray(event?.content) ? event.content : []

  for (const item of contentItems) {
    if (item?.type === 'tool_use') {
      sendAgentCompatLine(state.sender, state.provider, {
        type: 'tool_use',
        tool_id: item.id || `tool-${Date.now()}`,
        tool_name: item.name || 'tool',
        parameters: item.input || {},
        provider: state.provider
      }, state)
    }
    if (item?.type === 'tool_result') {
      sendAgentCompatLine(state.sender, state.provider, {
        type: 'tool_result',
        tool_id: item.tool_use_id || `tool-${Date.now()}`,
        status: item.is_error ? 'error' : 'success',
        output: contentPartsToText(item.content || item),
        provider: state.provider
      }, state)
    }
  }

  if (event?.method === 'event' && params.type === 'ToolCall') {
    sendAgentCompatLine(state.sender, state.provider, {
      type: 'tool_use',
      tool_id: payload.id || `tool-${Date.now()}`,
      tool_name: payload.function?.name || payload.name || 'tool',
      parameters: payload.function?.arguments || payload.arguments || {},
      provider: state.provider
    }, state)
  }

  if (event?.method === 'event' && params.type === 'ToolResult') {
    sendAgentCompatLine(state.sender, state.provider, {
      type: 'tool_result',
      tool_id: payload.tool_call_id || `tool-${Date.now()}`,
      status: payload.return_value?.is_error ? 'error' : 'success',
      output: contentPartsToText(payload.return_value?.output || payload.return_value?.message || ''),
      provider: state.provider
    }, state)
  }

  if (event?.method === 'event' && params.type === 'PlanDisplay') {
    sendAgentCompatLine(state.sender, state.provider, {
      type: 'tool_use',
      tool_id: payload.id || `plan-${Date.now()}`,
      tool_name: `${state.provider}_plan`,
      parameters: { title: 'Plan', kind: 'plan' },
      provider: state.provider
    }, state)
    sendAgentCompatLine(state.sender, state.provider, {
      type: 'tool_result',
      tool_id: payload.id || `plan-${Date.now()}`,
      status: 'success',
      output: contentPartsToText(payload.content || payload.plan || payload),
      provider: state.provider
    }, state)
  }
}

function handleCliProviderJsonEvent(state: CliProviderStreamState, event: any) {
  const sessionId = extractProviderSessionId(event)
  if (sessionId) state.providerSessionId = sessionId
  const usage = extractProviderUsage(state.provider, event)
  if (usage) state.tokenUsage = usage
  emitCliProviderToolEvent(state, event)

  const text = extractProviderText(event)
  if (text) {
    let delta = text
    if (state.assistantText && text.startsWith(state.assistantText)) {
      delta = text.slice(state.assistantText.length)
    }
    if (delta) {
      state.assistantText += delta
      sendAgentCompatLine(state.sender, state.provider, {
        type: 'content',
        text: delta,
        provider: state.provider,
        providerThreadId: state.providerSessionId || undefined,
        fallback: state.fallback
      }, state)
    }
  }

  const eventType = String(event?.type || event?.method || event?.params?.type || '')
  if (eventType === 'result' || eventType === 'TurnEnd' || (event?.method === 'event' && event?.params?.type === 'TurnEnd')) {
    state.completed = true
    sendAgentCompatLine(state.sender, state.provider, {
      type: 'result',
      subtype: event?.subtype || event?.status || event?.result?.status || 'success',
      status: event?.status || event?.result?.status || 'success',
      stats: {
        ...(state.tokenUsage || {}),
        duration_ms: event?.duration_ms || event?.durationMs || Date.now() - state.startedAt,
        cost_usd: event?.cost_usd || event?.total_cost_usd
      },
      provider: state.provider,
      providerThreadId: state.providerSessionId || undefined,
      providerRunId: state.runId || undefined,
      fallback: state.fallback
    }, state)
  }
}

function runCliProviderProcess(
  event: Electron.IpcMainInvokeEvent,
  provider: ProviderId,
  command: string,
  args: string[],
  payload: AgentRunPayload,
  options: { fallback: boolean; warning?: string } = { fallback: true }
) {
  const route = routeWithRunId(provider, payload)
  const model = normalizeCliProviderModel(provider, payload.model)
  const state: CliProviderStreamState = {
    provider,
    sender: event.sender,
    startedAt: Date.now(),
    model,
    fallback: options.fallback,
    completed: false,
    assistantText: '',
    providerSessionId: payload.providerSessionId || null,
    ...route
  }
  registerRunSession(provider, event.sender, route, payload.workspace, state, payload.providerSessionId || null)
  void emitProviderCapabilityWarnings(event.sender, provider, payload.workspace, payload.approvalMode, state)

  if (options.warning) {
    sendAgentCompatLine(event.sender, provider, {
      type: 'provider_warning',
      provider,
      message: options.warning,
      fallback: options.fallback
    }, state)
  }

  sendAgentCompatLine(event.sender, provider, {
    type: 'init',
    session_id: state.providerSessionId || '',
    model,
    timestamp: new Date().toISOString(),
    provider,
    fallback: options.fallback
  }, state)

  const child = spawn(command, args, {
    cwd: payload.workspace,
    shell: false,
    env: createCliEnv({ FORCE_COLOR: '0', NO_COLOR: '1' }, command)
  })
  runManager.attachProcess(route.appRunId!, child)
  cliProviderProcesses.set(provider, child)

  let stdoutBuffer = ''
  child.stdout?.on('data', (chunk) => {
    stdoutBuffer += chunk.toString()
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        handleCliProviderJsonEvent(state, JSON.parse(trimmed))
      } catch {
        sendAgentCompatLine(event.sender, provider, {
          type: 'content',
          text: line + '\n',
          provider,
          fallback: options.fallback
        }, state)
      }
    }
  })

  child.stderr?.on('data', (chunk) => {
    sendAgentCompatError(event.sender, provider, chunk.toString(), state)
  })

  child.on('error', (error) => {
    sendAgentCompatError(event.sender, provider, `Failed to start ${providerDisplayName(provider)}: ${error.message}`, state)
    sendAgentCompatExit(event.sender, provider, 1, state)
    if (cliProviderProcesses.get(provider) === child) cliProviderProcesses.delete(provider)
    runManager.finish(route.appRunId, 'failed')
  })

  child.on('close', (code) => {
    const trailing = stdoutBuffer.trim()
    if (trailing) {
      try {
        handleCliProviderJsonEvent(state, JSON.parse(trailing))
      } catch {
        sendAgentCompatLine(event.sender, provider, { type: 'content', text: trailing + '\n', provider, fallback: options.fallback }, state)
      }
    }
    if (!state.completed) {
      sendAgentCompatLine(event.sender, provider, {
        type: 'result',
        status: code === 0 ? 'success' : 'failed',
        stats: {
          ...(state.tokenUsage || {}),
          duration_ms: Date.now() - state.startedAt
        },
        provider,
        providerThreadId: state.providerSessionId || undefined,
        fallback: options.fallback
      }, state)
    }
    sendAgentCompatExit(event.sender, provider, code, state)
    if (cliProviderProcesses.get(provider) === child) cliProviderProcesses.delete(provider)
    runManager.finish(route.appRunId, code === 0 ? 'completed' : 'failed')
  })
}

async function loadOptionalClaudeSdk(): Promise<any | null> {
  try {
    const importer = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>
    return await importer('@anthropic-ai/claude-agent-sdk')
  } catch {
    return null
  }
}

async function tryRunClaudeSdk(event: Electron.IpcMainInvokeEvent, payload: AgentRunPayload, sdk: any): Promise<boolean> {
  const query = sdk?.query || sdk?.default?.query
  if (typeof query !== 'function') return false
  const model = normalizeCliProviderModel('claude', payload.model)
  const route = routeWithRunId('claude', payload)
  const controller = new AbortController()
  cliProviderAbortControllers.set('claude', controller)
  const state: CliProviderStreamState = {
    provider: 'claude',
    sender: event.sender,
    startedAt: Date.now(),
    model,
    fallback: false,
    completed: false,
    assistantText: '',
    providerSessionId: payload.providerSessionId || null,
    ...route
  }
  registerRunSession('claude', event.sender, route, payload.workspace, state, payload.providerSessionId || null)
  runManager.attachAbortController(route.appRunId!, controller)
  void emitProviderCapabilityWarnings(event.sender, 'claude', payload.workspace, payload.approvalMode, state)
  sendAgentCompatLine(event.sender, 'claude', {
    type: 'init',
    session_id: state.providerSessionId || '',
    model,
    timestamp: new Date().toISOString(),
    provider: 'claude',
    fallback: false
  }, state)

  const stream = query({
    prompt: payload.prompt,
    options: {
      cwd: payload.workspace,
      model: model === 'default' ? undefined : model,
      permissionMode: claudePermissionModeForApproval(payload.approvalMode),
      resume: payload.providerSessionId || undefined,
      abortController: controller
    }
  })

  for await (const message of stream) {
    handleCliProviderJsonEvent(state, message)
  }

  if (!state.completed) {
    sendAgentCompatLine(event.sender, 'claude', {
      type: 'result',
      status: 'success',
      stats: { ...(state.tokenUsage || {}), duration_ms: Date.now() - state.startedAt },
      provider: 'claude',
      providerThreadId: state.providerSessionId || undefined,
      fallback: false
    }, state)
  }
  sendAgentCompatExit(event.sender, 'claude', 0, state)
  if (cliProviderAbortControllers.get('claude') === controller) cliProviderAbortControllers.delete('claude')
  runManager.finish(route.appRunId, 'completed')
  return true
}

async function runClaudeProvider(event: Electron.IpcMainInvokeEvent, payload: AgentRunPayload) {
  const sdk = await loadOptionalClaudeSdk()
  if (sdk) {
    try {
      if (await tryRunClaudeSdk(event, payload, sdk)) return
    } catch (error) {
      sendAgentCompatError(event.sender, 'claude', `Claude Agent SDK failed; falling back to Claude Code CLI. Reason: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      cliProviderAbortControllers.delete('claude')
    }
  }

  const resolved = await resolveCliProviderBinary('claude')
  if (!resolved.binaryPath) {
    sendAgentCompatError(event.sender, 'claude', resolved.error || 'Claude CLI is not configured.')
    sendAgentCompatLine(event.sender, 'claude', {
      type: 'result',
      status: 'failed',
      stats: {},
      provider: 'claude',
      setupRequired: true
    })
    sendAgentCompatExit(event.sender, 'claude', 1)
    return
  }

  const model = normalizeCliProviderModel('claude', payload.model)
  const args = ['-p', payload.prompt, '--output-format', 'stream-json', '--include-partial-messages', '--permission-mode', claudePermissionModeForApproval(payload.approvalMode)]
  if (model !== 'default') args.push('--model', model)
  if (payload.providerSessionId) args.push('--resume', payload.providerSessionId)
  runCliProviderProcess(event, 'claude', resolved.binaryPath, args, payload, {
    fallback: true,
    warning: sdk ? 'Using Claude Code CLI fallback for this run.' : 'Claude Agent SDK is not bundled in this app build; using Claude Code CLI stream-json fallback for this run.'
  })
}

function respondToKimiWireRequest(child: ChildProcess, requestId: string | number, result: any) {
  child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, result }) + '\n')
}

async function runKimiWireProvider(event: Electron.IpcMainInvokeEvent, payload: AgentRunPayload, binaryPath: string): Promise<boolean> {
  const model = normalizeCliProviderModel('kimi', payload.model)
  const route = routeWithRunId('kimi', payload)
  const state: CliProviderStreamState = {
    provider: 'kimi',
    sender: event.sender,
    startedAt: Date.now(),
    model,
    fallback: false,
    completed: false,
    assistantText: '',
    providerSessionId: payload.providerSessionId || null,
    ...route
  }
  registerRunSession('kimi', event.sender, route, payload.workspace, state, payload.providerSessionId || null)
  void emitProviderCapabilityWarnings(event.sender, 'kimi', payload.workspace, payload.approvalMode, state)

  sendAgentCompatLine(event.sender, 'kimi', {
    type: 'init',
    session_id: state.providerSessionId || '',
    model,
    timestamp: new Date().toISOString(),
    provider: 'kimi',
    fallback: false
  }, state)

  const args = ['--wire', '--work-dir', payload.workspace]
  if (model !== 'default') args.push('--model', model)
  if (payload.providerSessionId) args.push('--resume', payload.providerSessionId)

  return new Promise((resolveWire) => {
    const child = spawn(binaryPath, args, {
      cwd: payload.workspace,
      shell: false,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
    })
    cliProviderProcesses.set('kimi', child)
    runManager.attachProcess(route.appRunId!, child)
    let stdoutBuffer = ''
    let settled = false
    let promptSent = false
    const initializeId = `initialize-${Date.now()}`
    const promptId = `prompt-${Date.now()}`
    const timeout = setTimeout(() => {
      if (settled || promptSent) return
      settled = true
      child.kill()
      if (cliProviderProcesses.get('kimi') === child) cliProviderProcesses.delete('kimi')
      runManager.finish(route.appRunId, 'failed')
      resolveWire(false)
    }, 7_000)

    const sendPrompt = () => {
      if (promptSent) return
      promptSent = true
      if (payload.approvalMode === 'plan') {
        child.stdin?.write(JSON.stringify({
          jsonrpc: '2.0',
          id: `plan-${Date.now()}`,
          method: 'set_plan_mode',
          params: { enabled: true }
        }) + '\n')
      }
      const promptInput: any = payload.imagePaths?.length
        ? [{ type: 'text', text: payload.prompt }, ...payload.imagePaths.map((imagePath) => ({ type: 'image_url', image_url: { url: imagePath } }))]
        : payload.prompt
      child.stdin?.write(JSON.stringify({
        jsonrpc: '2.0',
        id: promptId,
        method: 'prompt',
        params: { user_input: promptInput }
      }) + '\n')
    }

    child.stdout?.on('data', (chunk) => {
      stdoutBuffer += chunk.toString()
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const message = JSON.parse(trimmed)
          if (message.id === initializeId) {
            sendPrompt()
            continue
          }
          if (message.id === promptId) {
            state.completed = true
            sendAgentCompatLine(event.sender, 'kimi', {
              type: 'result',
              status: message.result?.status === 'cancelled' ? 'cancelled' : message.error ? 'failed' : 'success',
              stats: { ...(state.tokenUsage || {}), duration_ms: Date.now() - state.startedAt },
              provider: 'kimi',
              providerThreadId: state.providerSessionId || undefined,
              fallback: false
            }, state)
            sendAgentCompatExit(event.sender, 'kimi', message.error ? 1 : 0, state)
            child.kill()
            settled = true
            clearTimeout(timeout)
            if (cliProviderProcesses.get('kimi') === child) cliProviderProcesses.delete('kimi')
            runManager.finish(route.appRunId, message.error ? 'failed' : 'completed')
            resolveWire(true)
            continue
          }
          if (message.method === 'request') {
            const requestType = message.params?.type
            if (requestType === 'ApprovalRequest') {
              const approvalId = Date.now() + '-' + Math.random().toString(36).slice(2)
              pendingKimiApprovals.set(approvalId, { child, rpcId: message.id, params: message.params, runId: route.appRunId })
              runManager.registerApproval(route.appRunId, approvalId)
              event.sender.send('agent-approval-request', {
                provider: 'kimi',
                appRunId: route.appRunId,
                appChatId: route.appChatId,
                id: approvalId,
                approvalId,
                requestId: message.id,
                method: 'request/ApprovalRequest',
                params: message.params,
                title: 'Approve Kimi action',
                body: message.params?.payload?.description || message.params?.payload?.action || 'Kimi is requesting permission to continue.',
                actions: ['accept', 'acceptForSession', 'decline', 'cancel'],
                preview: {
                  kind: 'tool',
                  toolName: message.params?.payload?.sender || message.params?.payload?.action || 'kimi_action',
                  params: message.params?.payload,
                  actions: ['accept', 'acceptForSession', 'decline', 'cancel']
                }
              })
            } else if (requestType === 'QuestionRequest') {
              respondToKimiWireRequest(child, message.id, { response: 'User input is not available in this non-interactive run.' })
            } else {
              respondToKimiWireRequest(child, message.id, {
                tool_call_id: message.params?.payload?.id,
                return_value: { is_error: true, output: '', message: 'External app tools are not wired in v1.', display: [] }
              })
            }
            continue
          }
          handleCliProviderJsonEvent(state, message)
        } catch {
          sendAgentCompatLine(event.sender, 'kimi', { type: 'content', text: line + '\n', provider: 'kimi', fallback: false }, state)
        }
      }
    })

    child.stderr?.on('data', (chunk) => {
      sendAgentCompatError(event.sender, 'kimi', chunk.toString(), state)
    })

    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (cliProviderProcesses.get('kimi') === child) cliProviderProcesses.delete('kimi')
      runManager.finish(route.appRunId, 'failed')
      resolveWire(false)
    })

    child.on('close', (code) => {
      if (settled) return
      clearTimeout(timeout)
      if (cliProviderProcesses.get('kimi') === child) cliProviderProcesses.delete('kimi')
      if (!promptSent) {
        settled = true
        runManager.finish(route.appRunId, 'failed')
        resolveWire(false)
        return
      }
      if (!state.completed) {
        sendAgentCompatLine(event.sender, 'kimi', {
          type: 'result',
          status: code === 0 ? 'success' : 'failed',
          stats: { ...(state.tokenUsage || {}), duration_ms: Date.now() - state.startedAt },
          provider: 'kimi',
          fallback: false
        })
        sendAgentCompatExit(event.sender, 'kimi', code, state)
      }
      runManager.finish(route.appRunId, code === 0 ? 'completed' : 'failed')
      settled = true
      resolveWire(true)
    })

    child.stdin?.write(JSON.stringify({
      jsonrpc: '2.0',
      id: initializeId,
      method: 'initialize',
      params: {
        protocol_version: '1.9',
        client: { name: 'GUIGemini', version: app.getVersion() },
        capabilities: { supports_question: false, supports_plan_mode: true }
      }
    }) + '\n')
  })
}

async function runKimiProvider(event: Electron.IpcMainInvokeEvent, payload: AgentRunPayload) {
  const resolved = await resolveCliProviderBinary('kimi')
  if (!resolved.binaryPath) {
    sendAgentCompatError(event.sender, 'kimi', resolved.error || 'Kimi CLI is not configured.')
    sendAgentCompatLine(event.sender, 'kimi', {
      type: 'result',
      status: 'failed',
      stats: {},
      provider: 'kimi',
      setupRequired: true
    })
    sendAgentCompatExit(event.sender, 'kimi', 1)
    return
  }

  if (await runKimiWireProvider(event, payload, resolved.binaryPath)) {
    return
  }

  if (payload.approvalMode !== 'plan') {
    sendAgentCompatError(event.sender, 'kimi', 'Kimi Wire mode did not complete startup. Print-mode fallback is skipped outside Plan/read-only because Kimi print mode is non-interactive and can auto-approve provider tool calls.')
    sendAgentCompatLine(event.sender, 'kimi', {
      type: 'result',
      status: 'failed',
      stats: {},
      provider: 'kimi',
      fallback: true
    })
    sendAgentCompatExit(event.sender, 'kimi', 1)
    return
  }

  const model = normalizeCliProviderModel('kimi', payload.model)
  const args = ['--print', '--plan', '--output-format', 'stream-json', '--work-dir', payload.workspace, '--prompt', payload.prompt]
  if (model !== 'default') args.push('--model', model)
  if (payload.providerSessionId) args.push('--resume', payload.providerSessionId)
  runCliProviderProcess(event, 'kimi', resolved.binaryPath, args, payload, {
    fallback: true,
    warning: 'Kimi Wire mode did not complete startup; using print-mode stream-json fallback for this one-shot run.'
  })
}

function getCodexClient(): CodexAppServerClient {
  if (!codexClient) {
    codexClient = new CodexAppServerClient()
  }
  return codexClient
}

function normalizeRunRoute(route?: AgentRunRoute | null): AgentRunRoute {
  return {
    ...(route?.appRunId ? { appRunId: String(route.appRunId) } : {}),
    ...(route?.appChatId ? { appChatId: String(route.appChatId) } : {})
  }
}

function createFallbackRunId(provider: ProviderId): string {
  return `${provider}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function routeWithRunId(provider: ProviderId, route?: AgentRunRoute | null): AgentRunRoute {
  const normalized = normalizeRunRoute(route)
  return {
    ...normalized,
    appRunId: normalized.appRunId || createFallbackRunId(provider)
  }
}

function registerRunSession(
  provider: ProviderId,
  sender: Electron.WebContents,
  route: AgentRunRoute | null | undefined,
  workspacePath?: string,
  state?: any,
  providerSessionId?: string | null
) {
  const routed = routeWithRunId(provider, route)
  const existing = runManager.get(routed.appRunId)
  if (existing) {
    runManager.update(existing.runId, {
      sender,
      workspacePath,
      appChatId: routed.appChatId,
      providerSessionId: providerSessionId || existing.providerSessionId,
      state,
      status: 'running'
    })
    return runManager.get(existing.runId)!
  }
  return runManager.create({
    runId: routed.appRunId!,
    provider,
    appChatId: routed.appChatId,
    workspacePath,
    providerSessionId: providerSessionId || undefined,
    sender,
    state,
    status: 'running'
  })
}

function getRuntimeSession(provider: ProviderId, route?: AgentRunRoute | null) {
  return runManager.resolve(provider, route)
}

function getCodexStateFromSession(session: ReturnType<typeof getRuntimeSession> | undefined): CodexRunState | null {
  const state = session?.state
  return state && typeof state === 'object' && (state as CodexRunState).threadId ? state as CodexRunState : null
}

function getActiveCodexRunState(): CodexRunState | null {
  const managed = getCodexStateFromSession(runManager.getLatestByProvider('codex'))
  if (managed) return managed
  if (!activeCodexRunState?.appRunId) return activeCodexRunState
  const session = runManager.get(activeCodexRunState.appRunId)
  return session && (session.status === 'starting' || session.status === 'running') ? activeCodexRunState : null
}

function setActiveCodexRunState(state: CodexRunState | null): void {
  activeCodexRunState = state
}

function findCodexRunStateForMessage(message: any): CodexRunState | null {
  const params = message?.params || {}
  const threadId = params.threadId || params.thread?.id || params.item?.threadId || params.turn?.threadId
  if (threadId) {
    const byThread = getCodexStateFromSession(runManager.getByProviderSession('codex', String(threadId)))
    if (byThread) return byThread
  }
  return getActiveCodexRunState()
}

function getGeminiToolContext(route?: AgentRunRoute | null): GeminiToolContext | null {
  const session = getRuntimeSession('gemini', route)
  const state = session?.state
  if (state && typeof state === 'object' && (state as GeminiToolContext).workspacePath && (state as GeminiToolContext).sender) {
    return state as GeminiToolContext
  }
  return activeGeminiToolContext
}

function enrichAgentPayload(provider: ProviderId, payload: any, route?: AgentRunRoute | null) {
  const inferredRoute: any = route || getRuntimeSession(provider, payload) || (provider === 'codex' ? getActiveCodexRunState() : activeGeminiToolContext)
  const resolvedRoute = normalizeRunRoute({
    appRunId: inferredRoute?.runId || inferredRoute?.appRunId || payload?.appRunId,
    appChatId: inferredRoute?.appChatId || payload?.appChatId
  })
  return {
    ...payload,
    provider,
    ...resolvedRoute
  }
}

function sendAgentCompatLine(sender: Electron.WebContents, provider: ProviderId, payload: any, route?: AgentRunRoute | null) {
  const routed = enrichAgentPayload(provider, payload, route)
  const line = `${JSON.stringify(routed)}\n`
  sender.send('agent-output', { provider, data: line, appRunId: routed.appRunId, appChatId: routed.appChatId })
  if (provider === 'gemini') {
    sender.send('gemini-output', { provider, data: line, appRunId: routed.appRunId, appChatId: routed.appChatId })
  }
}

function sendAgentCompatError(sender: Electron.WebContents, provider: ProviderId, error: string, route?: AgentRunRoute | null) {
  const routed = enrichAgentPayload(provider, { error }, route)
  sender.send('agent-error', routed)
  if (provider === 'gemini') {
    sender.send('gemini-error', routed)
  }
}

function sendAgentCompatExit(sender: Electron.WebContents, provider: ProviderId, code: number | null, route?: AgentRunRoute | null) {
  const routed = enrichAgentPayload(provider, { code }, route)
  sender.send('agent-exit', routed)
  if (provider === 'gemini') {
    sender.send('gemini-exit', routed)
  }
}

function normalizeCodexModel(model?: string | null): string {
  const trimmed = typeof model === 'string' ? model.trim() : ''
  if (!trimmed || ['cli-default', 'auto', 'pro', 'flash', 'flash-lite', 'custom'].includes(trimmed)) {
    return CODEX_STATIC_MODELS[0].id
  }
  return trimmed
}

function codexApprovalPolicyForMode(approvalMode?: string, settings: AppSettings = AppStore.getSettings()): 'never' | 'on-request' {
  if (approvalMode === 'plan') {
    return 'never'
  }
  if (approvalMode === 'auto_edit' && !codexNeedsApprovalGate(settings)) return 'never'
  return 'on-request'
}

function codexSandboxForMode(approvalMode?: string): 'read-only' | 'workspace-write' {
  return approvalMode === 'plan' ? 'read-only' : 'workspace-write'
}

function normalizeExternalPathGrants(grants?: ExternalPathGrant[]): ExternalPathGrant[] {
  if (!Array.isArray(grants)) return []
  const seen = new Set<string>()
  const normalized: ExternalPathGrant[] = []
  for (const grant of grants) {
    if (!grant || grant.provider !== 'codex' || typeof grant.path !== 'string') continue
    const grantPath = grant.path.trim()
    if (!grantPath || !isAbsolute(grantPath)) continue
    const resolvedPath = resolve(grantPath)
    const key = `${grant.access}:${resolvedPath}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({
      ...grant,
      path: resolvedPath,
      access: grant.access === 'write' ? 'write' : 'read',
      kind: grant.kind === 'directory' ? 'directory' : 'file',
      duration: grant.duration || 'thisThread'
    })
  }
  return normalized
}

function codexSandboxPolicyForMode(approvalMode: string | undefined, workspace: string, externalPathGrants?: ExternalPathGrant[], settings: AppSettings = AppStore.getSettings()) {
  const grants = normalizeExternalPathGrants(externalPathGrants)
  const readableRoots = [workspace, ...grants.map((grant) => grant.path)]
  const writableRoots = [workspace, ...grants.filter((grant) => grant.access === 'write').map((grant) => grant.path)]
  if (approvalMode === 'plan') {
    return { type: 'readOnly', readableRoots, networkAccess: false }
  }
  return {
    type: 'workspaceWrite',
    writableRoots,
    readableRoots,
    networkAccess: settings.agenticServices?.networkAccess !== 'deny',
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  }
}

function buildCodexUserInput(prompt: string, imagePaths: string[] = []) {
  const input: any[] = [{ type: 'text', text: prompt, text_elements: [] }]
  for (const imagePath of imagePaths) {
    if (typeof imagePath === 'string' && imagePath.trim()) {
      input.push({ type: 'localImage', path: imagePath.trim() })
    }
  }
  return input
}

function codexUsageToStats(tokenUsage: any, fallbackDurationMs = 0) {
  const last = tokenUsage?.last || tokenUsage?.total || {}
  const modelContextWindow = tokenUsage?.modelContextWindow
  return {
    input_tokens: Number(last.inputTokens || last.input_tokens || 0),
    output_tokens: Number(last.outputTokens || last.output_tokens || 0),
    total_tokens: Number(last.totalTokens || last.total_tokens || 0),
    totalTokenLimit: typeof modelContextWindow === 'number' ? modelContextWindow : undefined,
    duration_ms: fallbackDurationMs
  }
}

function normalizeCodexTurnStatus(status?: string): string {
  if (status === 'completed') return 'success'
  if (status === 'interrupted') return 'cancelled'
  if (status === 'failed') return 'failed'
  return status || 'success'
}

function createCodexRunState(sender: Electron.WebContents, threadId: string, model: string, workspacePath?: string, route?: AgentRunRoute | null): CodexRunState {
  return {
    sender,
    threadId,
    workspacePath,
    model,
    ...normalizeRunRoute(route),
    assistantTextByItemId: new Map(),
    timelineStartedItemIds: new Set(),
    reasoningTextByItemId: new Map(),
    commandOutputByItemId: new Map(),
    filePatchByItemId: new Map(),
    hostRerunRequestedItemIds: new Set(),
    completed: false
  }
}

function codexTimelineItemId(params: any, fallbackPrefix: string): string {
  const item = params?.item
  const rawId = params?.itemId || params?.item_id || item?.id || params?.id
  if (typeof rawId === 'string' && rawId.trim()) return rawId
  return fallbackPrefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2)
}

function codexString(value: any): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(codexString).filter(Boolean).join('')
  if (value === undefined || value === null) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    const nested = value.text || value.delta || value.content || value.output || value.value
    if (nested !== undefined) return codexString(nested)
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function codexCommandText(command: any): string {
  if (Array.isArray(command)) return command.map(codexString).join(' ')
  return codexString(command)
}

function summarizeCodexFileChanges(changes: any[]): string {
  if (!Array.isArray(changes) || changes.length === 0) return 'File change pending.'
  return changes
    .map((change) => {
      const kind = codexString(change?.kind || change?.type || change?.operation || 'update')
      const filePath = codexString(change?.path || change?.filePath || change?.file_path || change?.target || '')
      const additions = Number(change?.additions || change?.added || 0)
      const deletions = Number(change?.deletions || change?.deleted || 0)
      const stats = additions || deletions ? ' (+' + additions + ' -' + deletions + ')' : ''
      return (kind + (filePath ? ' ' + filePath : '') + stats).trim()
    })
    .filter(Boolean)
    .join('\\n')
}

function codexPatchPreviewFromValue(value: any): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(codexPatchPreviewFromValue).filter(Boolean).join('\\n')
  if (!value || typeof value !== 'object') return ''
  const direct = value.diff || value.patch || value.unifiedDiff || value.unified_diff || value.preview || value.output
  if (direct !== undefined) return codexPatchPreviewFromValue(direct)
  if (Array.isArray(value.changes)) return codexPatchPreviewFromValue(value.changes)
  return summarizeCodexFileChanges([value])
}

function sendCodexSyntheticToolUse(state: CodexRunState, itemId: string, toolName: string, parameters: Record<string, unknown>) {
  sendAgentCompatLine(state.sender, 'codex', {
    type: 'tool_use',
    tool_id: itemId,
    tool_name: toolName,
    parameters,
    provider: 'codex'
  }, state)
}

function sendCodexSyntheticToolResult(state: CodexRunState, itemId: string, output: string, status: 'running' | 'success' | 'warning' | 'error' = 'success') {
  sendAgentCompatLine(state.sender, 'codex', {
    type: 'tool_result',
    tool_id: itemId,
    output,
    status: status === 'running' ? 'warning' : status,
    provider: 'codex'
  }, state)
}

function ensureCodexTimelineTool(state: CodexRunState, itemId: string, toolName: string, parameters: Record<string, unknown>) {
  if (state.timelineStartedItemIds.has(itemId)) return
  state.timelineStartedItemIds.add(itemId)
  sendCodexSyntheticToolUse(state, itemId, toolName, parameters)
}

function emitCodexReasoningDelta(state: CodexRunState, params: any, label: string) {
  const itemId = codexTimelineItemId(params, 'codex-reasoning')
  const delta = codexString(params?.delta ?? params?.text ?? params?.summary ?? params?.content ?? params?.part)
  if (!delta) return
  ensureCodexTimelineTool(state, itemId, 'codex_reasoning', { title: label, kind: 'reasoning' })
  const next = (state.reasoningTextByItemId.get(itemId) || '') + delta
  state.reasoningTextByItemId.set(itemId, next)
  sendCodexSyntheticToolResult(state, itemId, next, 'running')
}

function emitCodexCommandOutputDelta(state: CodexRunState, params: any) {
  const itemId = codexTimelineItemId(params, 'codex-command')
  const delta = codexString(params?.delta ?? params?.output ?? params?.stdout ?? params?.stderr ?? params?.content)
  if (!delta) return
  ensureCodexTimelineTool(state, itemId, 'run_shell_command', {
    command: codexCommandText(params?.command || params?.item?.command || ''),
    cwd: codexString(params?.cwd || params?.item?.cwd || '')
  })
  const next = (state.commandOutputByItemId.get(itemId) || '') + delta
  state.commandOutputByItemId.set(itemId, next)
  sendCodexSyntheticToolResult(state, itemId, next, 'running')
}

function emitCodexPatchUpdate(state: CodexRunState, params: any) {
  const itemId = codexTimelineItemId(params, 'codex-file-change')
  const item = params?.item || {}
  const changes = params?.changes || item?.changes || params?.patch?.changes || []
  const preview = codexPatchPreviewFromValue(params?.patch ?? params?.diff ?? params?.changes ?? item)
  state.filePatchByItemId.set(itemId, { changes, preview, params })
  const firstChange = Array.isArray(changes) ? changes[0] : undefined
  const kind = firstChange?.kind || firstChange?.type || firstChange?.operation || 'update'
  const filePath = firstChange?.path || firstChange?.filePath || firstChange?.file_path || item?.path || ''
  ensureCodexTimelineTool(state, itemId, 'edit_file', {
    path: filePath,
    changes,
    kind,
    patchPreview: preview
  })
  sendCodexSyntheticToolResult(state, itemId, preview || summarizeCodexFileChanges(Array.isArray(changes) ? changes : []), 'running')
}

function emitCodexPlanItem(state: CodexRunState, item: any) {
  const itemId = codexTimelineItemId({ item }, 'codex-plan')
  const steps = item?.steps || item?.plan || item?.content || item?.text || item?.summary || item
  const output = codexString(steps)
  ensureCodexTimelineTool(state, itemId, 'codex_plan', { title: 'Plan update', kind: 'plan' })
  if (output) {
    sendCodexSyntheticToolResult(state, itemId, output, item?.status === 'failed' ? 'error' : 'success')
  }
}

function codexToolUseFromItem(item: any): any | null {
  if (!item || typeof item !== 'object') return null
  if (item.type === 'commandExecution') {
    return {
      type: 'tool_use',
      tool_id: item.id,
      tool_name: 'run_shell_command',
      parameters: {
        command: item.command || '',
        cwd: item.cwd || ''
      },
      provider: 'codex'
    }
  }
  if (item.type === 'fileChange') {
    const firstChange = Array.isArray(item.changes) ? item.changes[0] : undefined
    const kind = firstChange?.kind || 'update'
    const toolName = kind === 'create' || kind === 'add' ? 'create_file' : kind === 'delete' ? 'delete_file' : 'edit_file'
    return {
      type: 'tool_use',
      tool_id: item.id,
      tool_name: toolName,
      parameters: {
        path: firstChange?.path || '',
        changes: item.changes || []
      },
      provider: 'codex'
    }
  }
  if (item.type === 'mcpToolCall') {
    return {
      type: 'tool_use',
      tool_id: item.id,
      tool_name: item.tool || 'mcp_tool',
      parameters: item.arguments || {},
      provider: 'codex',
      server: item.server
    }
  }
  if (item.type === 'dynamicToolCall') {
    return {
      type: 'tool_use',
      tool_id: item.id,
      tool_name: item.tool || 'dynamic_tool',
      parameters: item.arguments || {},
      provider: 'codex',
      namespace: item.namespace
    }
  }
  return null
}

function codexToolResultFromItem(item: any): any | null {
  if (!item || typeof item !== 'object') return null
  if (item.type === 'commandExecution') {
    return {
      type: 'tool_result',
      tool_id: item.id,
      tool_name: 'run_shell_command',
      status: item.status === 'failed' ? 'error' : item.status === 'declined' ? 'warning' : 'success',
      output: item.aggregatedOutput || '',
      result: {
        exitCode: item.exitCode,
        durationMs: item.durationMs
      },
      provider: 'codex'
    }
  }
  if (item.type === 'fileChange') {
    return {
      type: 'tool_result',
      tool_id: item.id,
      tool_name: codexToolUseFromItem(item)?.tool_name || 'edit_file',
      status: item.status === 'failed' ? 'error' : item.status === 'declined' ? 'warning' : 'success',
      output: Array.isArray(item.changes) ? item.changes.map((change: any) => `${change.kind || 'update'} ${change.path || ''}`).join('\n') : '',
      result: item,
      provider: 'codex'
    }
  }
  if (item.type === 'mcpToolCall') {
    return {
      type: 'tool_result',
      tool_id: item.id,
      tool_name: item.tool || 'mcp_tool',
      status: item.status === 'failed' ? 'error' : 'success',
      output: item.error ? JSON.stringify(item.error) : JSON.stringify(item.result || {}),
      result: item.result || item.error || {},
      provider: 'codex'
    }
  }
  if (item.type === 'dynamicToolCall') {
    return {
      type: 'tool_result',
      tool_id: item.id,
      tool_name: item.tool || 'dynamic_tool',
      status: item.success === false || item.status === 'failed' ? 'error' : 'success',
      output: JSON.stringify(item.contentItems || {}),
      result: item,
      provider: 'codex'
    }
  }
  return null
}

function handleCodexNotification(message: any) {
  const state = findCodexRunStateForMessage(message)
  if (!state) return

  const params = message.params || {}
  const messageThreadId = params.threadId || params.thread?.id
  if (messageThreadId && params.threadId !== state.threadId && messageThreadId !== state.threadId) return

  if (message.method === 'turn/started') {
    state.turnId = params.turn?.id || params.turnId || state.turnId
    if (state.appRunId && state.turnId) {
      runManager.registerProviderRun(state.appRunId, state.turnId)
    }
    return
  }

  if (message.method === 'thread/tokenUsage/updated') {
    state.tokenUsage = params.tokenUsage || params.usage || params
    return
  }

  if (message.method === 'item/agentMessage/delta') {
    const itemId = codexTimelineItemId(params, 'codex-agent-message')
    const delta = codexString(params.delta ?? params.text ?? params.content)
    const nextText = (state.assistantTextByItemId.get(itemId) || '') + delta
    state.assistantTextByItemId.set(itemId, nextText)
    sendAgentCompatLine(state.sender, 'codex', {
      type: 'content',
      text: delta,
      provider: 'codex',
      itemId
    }, state)
    return
  }

  if (
    message.method === 'item/reasoning/textDelta' ||
    message.method === 'item/reasoning/summaryTextDelta' ||
    message.method === 'item/reasoning/summaryPartAdded'
  ) {
    emitCodexReasoningDelta(state, params, message.method === 'item/reasoning/summaryPartAdded' ? 'Reasoning summary' : 'Thinking note')
    return
  }

  if (message.method === 'item/commandExecution/outputDelta') {
    emitCodexCommandOutputDelta(state, params)
    return
  }

  if (message.method === 'item/fileChange/outputDelta') {
    const itemId = codexTimelineItemId(params, 'codex-file-output')
    const delta = codexString(params.delta ?? params.output ?? params.content)
    if (delta) {
      ensureCodexTimelineTool(state, itemId, 'edit_file', { path: codexString(params.path || params.item?.path || '') })
      sendCodexSyntheticToolResult(state, itemId, delta, 'running')
    }
    return
  }

  if (message.method === 'item/fileChange/patchUpdated') {
    emitCodexPatchUpdate(state, params)
    return
  }

  if (message.method === 'item/started') {
    const item = params.item
    if (item?.type === 'reasoning') {
      return
    }
    if (item?.type === 'plan') {
      emitCodexPlanItem(state, item)
      return
    }
    const toolUse = codexToolUseFromItem(item)
    if (toolUse) {
      state.timelineStartedItemIds.add(String(toolUse.tool_id))
      sendAgentCompatLine(state.sender, 'codex', toolUse, state)
    }
    return
  }

  if (message.method === 'item/completed') {
    const item = params.item
    if (item?.type === 'agentMessage') {
      const itemId = codexTimelineItemId(params, 'codex-agent-message')
      const text = state.assistantTextByItemId.get(itemId) || codexString(item.text || item.content || item.message || '')
      if (text) {
        sendAgentCompatLine(state.sender, 'codex', {
          type: 'content',
          text: '',
          provider: 'codex',
          itemId,
          complete: true
        }, state)
      }
      return
    }
    if (item?.type === 'plan') {
      emitCodexPlanItem(state, item)
      return
    }
    if (item?.type === 'reasoning') {
      const itemId = codexTimelineItemId(params, 'codex-reasoning')
      const text = state.reasoningTextByItemId.get(itemId) || codexString(item.summary || item.text || item.content || '')
      if (!text.trim()) return
      ensureCodexTimelineTool(state, itemId, 'codex_reasoning', { title: item.summary ? 'Reasoning summary' : 'Thinking note', kind: 'reasoning' })
      if (text) sendCodexSyntheticToolResult(state, itemId, text, item.status === 'failed' ? 'error' : 'success')
      return
    }
    if (item?.type === 'commandExecution') {
      const itemId = codexTimelineItemId(params, 'codex-command')
      const output = [state.commandOutputByItemId.get(itemId), codexString(item.output || item.stdout), codexString(item.stderr), codexString(item.error || item.errorMessage)]
        .filter(Boolean)
        .join('\\n')
      ensureCodexTimelineTool(state, itemId, 'run_shell_command', {
        command: codexCommandText(item.command || ''),
        cwd: codexString(item.cwd || '')
      })
      sendCodexSyntheticToolResult(state, itemId, output || 'Command exited with ' + (item.exitCode ?? item.status ?? 'unknown') + '.', item.status === 'failed' || item.exitCode ? 'error' : 'success')
      maybeRequestCodexHostRerun(state, item, itemId, output)
      return
    }
    if (item?.type === 'fileChange') {
      emitCodexPatchUpdate(state, { ...params, item, changes: item.changes })
      const itemId = codexTimelineItemId(params, 'codex-file-change')
      const cached = state.filePatchByItemId.get(itemId)
      sendCodexSyntheticToolResult(state, itemId, cached?.preview || summarizeCodexFileChanges(item.changes || []), item.status === 'failed' ? 'error' : 'success')
      return
    }
    const toolResult = codexToolResultFromItem(item)
    if (toolResult) {
      sendAgentCompatLine(state.sender, 'codex', toolResult, state)
    }
    return
  }

  if (message.method === 'turn/completed' || message.method === 'review/completed') {
    if (state.completed) return
    state.completed = true
    const turn = params.turn || params.review || {}
    const durationMs = Number(turn.durationMs || turn.duration_ms || 0)
    sendAgentCompatLine(state.sender, 'codex', {
      type: 'result',
      subtype: normalizeCodexTurnStatus(turn.status || params.status),
      stats: codexUsageToStats(state.tokenUsage, durationMs),
      provider: 'codex',
      providerThreadId: state.threadId,
      providerRunId: turn.id || state.turnId,
      codex: { turn, tokenUsage: state.tokenUsage }
    }, state)
    sendAgentCompatExit(state.sender, 'codex', 0, state)
    runManager.finish(state.appRunId, 'completed')
    if (activeCodexRunState === state) {
      setActiveCodexRunState(getCodexStateFromSession(runManager.getLatestByProvider('codex')))
    }
    return
  }

  if (message.method === 'error') {
    const error = params.message || params.error || 'Codex app-server error.'
    sendAgentCompatError(state.sender, 'codex', error, state)
    sendAgentCompatExit(state.sender, 'codex', 1, state)
    runManager.finish(state.appRunId, 'failed')
    if (activeCodexRunState === state) {
      setActiveCodexRunState(getCodexStateFromSession(runManager.getLatestByProvider('codex')))
    }
  }
}

function formatCodexApprovalRequest(method: string, params: any, state?: CodexRunState | null) {
  const kind = params?.approvalType || params?.type || params?.kind || method
  const command = codexCommandText(params?.command || params?.commandLine || params?.exec?.command || params?.item?.command || '')
  const cwd = codexString(params?.cwd || params?.workdir || params?.exec?.cwd || params?.item?.cwd || '')
  const itemId = params?.itemId || params?.item_id || params?.item?.id
  const cachedPatch = itemId && state ? state.filePatchByItemId.get(String(itemId)) : null
  const changes = params?.changes || params?.item?.changes || cachedPatch?.changes || []
  const patchPreview = codexPatchPreviewFromValue(params?.diff || params?.patch || params?.preview || cachedPatch?.preview || changes)
  const toolName = params?.toolName || params?.tool_name || params?.name || params?.mcpToolName

  if (command) {
    return {
      service: 'shellCommands' as AgenticServiceId,
      title: 'Approve Codex command',
      body: cwd ? command + '\\n' + cwd : command,
      preview: {
        kind: 'command',
        command,
        cwd,
        itemId,
        params,
        actions: ['accept', 'acceptForSession', 'decline', 'cancel']
      }
    }
  }

  if ((Array.isArray(changes) && changes.length > 0) || patchPreview) {
    return {
      service: 'fileChanges' as AgenticServiceId,
      title: 'Approve Codex file change',
      body: summarizeCodexFileChanges(Array.isArray(changes) ? changes : []),
      preview: {
        kind: 'fileChange',
        changes,
        patchPreview,
        itemId,
        params,
        actions: ['accept', 'acceptForSession', 'decline', 'cancel']
      }
    }
  }

  if (toolName || String(method).toLowerCase().includes('mcp') || String(kind).toLowerCase().includes('tool')) {
    return {
      service: 'mcpTools' as AgenticServiceId,
      title: 'Approve Codex tool call',
      body: codexString(toolName || kind),
      preview: {
        kind: 'tool',
        toolName,
        params,
        actions: ['accept', 'acceptForSession', 'decline', 'cancel']
      }
    }
  }

  return {
    service: undefined,
    title: 'Codex approval required',
    body: codexString(params?.message || params?.prompt || kind),
    preview: {
      kind: 'permission',
      params,
      actions: ['accept', 'acceptForSession', 'decline', 'cancel']
    }
  }
}

function handleCodexServerRequest(message: any) {
  const state = findCodexRunStateForMessage(message)
  if (!state || !codexClient) return
  const method = message.method || 'approval/request'
  const params = message.params || {}
  const approvalId = Date.now() + '-' + Math.random().toString(36).slice(2)
  const formatted = formatCodexApprovalRequest(method, params, state)
  const service = formatted.service
  const settings = AppStore.getSettings()
  const policy = service ? getAgenticServicePolicy(service, settings) : 'ask'

  if (service && policy === 'deny') {
    const label = AGENTIC_SERVICE_LABELS[service]
    codexClient.reject(message.id, `${label} are disabled in AgentBench settings.`)
    sendAgentCompatError(state.sender, 'codex', `${label} blocked by AgentBench settings.`, state)
    return
  }

  if (service && method === 'item/permissions/requestApproval') {
    const hasWorkspaceGrant = policy === 'workspace' && hasAgenticWorkspaceGrant(settings, 'codex', state.workspacePath, service)
    if (policy === 'allow' || hasWorkspaceGrant) {
      codexClient.respond(message.id, {
        permissions: params?.permissions || {},
        scope: hasWorkspaceGrant ? 'session' : 'turn'
      })
      return
    }
  }

  const actions: AgentApprovalAction[] = ['accept']
  if (service && method === 'item/permissions/requestApproval' && state.workspacePath && policy === 'workspace') {
    actions.push('acceptForWorkspace')
  }
  actions.push('acceptForSession', 'decline', 'cancel')
  formatted.preview = { ...(formatted.preview || {}), actions }

  pendingCodexApprovals.set(approvalId, { rpcId: message.id, method, params, service, workspacePath: state.workspacePath, runId: state.appRunId })
  runManager.registerApproval(state.appRunId, approvalId)
  state.sender.send('agent-approval-request', {
    provider: 'codex',
    appRunId: state.appRunId,
    appChatId: state.appChatId,
    id: approvalId,
    approvalId,
    requestId: message.id,
    method,
    params,
    title: formatted.title,
    body: formatted.body,
    preview: formatted.preview,
    actions
  })
}

function maybeRequestCodexHostRerun(state: CodexRunState, item: any, itemId: string, output: string): void {
  const settings = AppStore.getSettings()
  if (settings.codexSandboxFallback === 'off') return
  if (state.hostRerunRequestedItemIds.has(itemId)) return
  if (!state.workspacePath || !state.threadId) return
  const failed = item?.status === 'failed' || (typeof item?.exitCode === 'number' && item.exitCode !== 0)
  if (!failed) return
  if (!isCodexSandboxToolingFailure(output)) return

  const policy = getAgenticServicePolicy('shellCommands', settings)
  if (policy === 'deny') return

  const command = item.command || ''
  const commandText = codexCommandText(command)
  const cwd = codexString(item.cwd || state.workspacePath)
  if (!commandText.trim()) return

  let normalizedCwd: string
  try {
    normalizedCwd = resolveWorkspaceDirectory(state.workspacePath, cwd)
  } catch {
    return
  }

  state.hostRerunRequestedItemIds.add(itemId)
  const approvalId = `host-rerun-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const reason = 'Codex command failed in the command sandbox with a Swift/Xcode-style sandbox/tooling collision.'
  pendingHostCommandApprovals.set(approvalId, {
    sender: state.sender,
    provider: 'codex',
    command,
    commandText,
    cwd: normalizedCwd,
    workspacePath: state.workspacePath,
    threadId: state.threadId,
    model: state.model,
    appRunId: state.appRunId,
    appChatId: state.appChatId,
    reason,
    output
  })
  runManager.registerApproval(state.appRunId, approvalId)
  state.sender.send('agent-approval-request', {
    provider: 'codex',
    appRunId: state.appRunId,
    appChatId: state.appChatId,
    id: approvalId,
    approvalId,
    method: 'hostCommand/rerun',
    title: 'Rerun command outside sandbox',
    body: `${reason}\n\n${commandText}\n${normalizedCwd}`,
    preview: {
      kind: 'host-command-rerun',
      command: commandText,
      cwd: normalizedCwd,
      output: output.slice(0, 4000),
      actions: ['accept', 'decline']
    },
    actions: ['accept', 'decline']
  })
}

async function continueCodexAfterHostRerun(approval: HostCommandApproval, result: HostCommandResult, resultText: string): Promise<void> {
  if (!codexClient) return
  const settings = AppStore.getSettings()
  const continuationState = createCodexRunState(approval.sender, approval.threadId, approval.model, approval.workspacePath, approval)
  registerRunSession('codex', approval.sender, continuationState, approval.workspacePath, continuationState, approval.threadId)
  setActiveCodexRunState(continuationState)
  sendAgentCompatLine(approval.sender, 'codex', {
    type: 'init',
    session_id: approval.threadId,
    model: approval.model,
    timestamp: new Date().toISOString(),
    provider: 'codex',
    continuation: true
  }, continuationState)
  const prompt = [
    'AgentBench reran a previously failed shell command once from the app host process after explicit user approval.',
    `Command: ${approval.commandText}`,
    `Cwd: ${approval.cwd}`,
    `Exit code: ${result.exitCode ?? (result.timedOut ? 'timeout' : 'unknown')}`,
    'Rerun output:',
    resultText,
    '',
    'Continue from this real output. Do not rerun the command unless a new approval is needed.'
  ].join('\n')
  try {
    await codexClient.request('turn/start', {
      threadId: approval.threadId,
      input: buildCodexUserInput(prompt),
      cwd: approval.workspacePath,
      approvalPolicy: codexApprovalPolicyForMode('default', settings),
      sandboxPolicy: codexSandboxPolicyForMode('default', approval.workspacePath, [], settings),
      model: approval.model
    }, 60_000)
  } catch (error) {
    sendAgentCompatError(approval.sender, 'codex', `Codex continuation after approved host rerun failed: ${error instanceof Error ? error.message : String(error)}`, continuationState)
  }
}

async function runApprovedHostCommand(requestId: string): Promise<boolean> {
  const approval = pendingHostCommandApprovals.get(requestId)
  if (!approval) return false
  pendingHostCommandApprovals.delete(requestId)
  runManager.clearApproval(requestId)
  const toolId = `${requestId}-result`
  sendAgentCompatLine(approval.sender, 'codex', {
    type: 'tool_use',
    tool_id: toolId,
    tool_name: 'run_shell_command',
    parameters: {
      command: approval.commandText,
      cwd: approval.cwd,
      hostRerun: true,
      reason: approval.reason
    },
    provider: 'codex'
  }, approval)
  const result = await runHostCommand(approval.command, approval.cwd)
  const resultText = formatHostCommandResult(result)
  sendAgentCompatLine(approval.sender, 'codex', {
    type: 'tool_result',
    tool_id: toolId,
    tool_name: 'run_shell_command',
    status: result.error || result.timedOut || (result.exitCode !== null && result.exitCode !== 0) ? 'error' : 'success',
    output: resultText,
    result: { exitCode: result.exitCode, durationMs: result.durationMs, hostRerun: true },
    provider: 'codex'
  }, approval)
  await continueCodexAfterHostRerun(approval, result, resultText)
  return true
}

async function runCodexAppServer(event: Electron.IpcMainInvokeEvent, payload: AgentRunPayload) {
  const client = getCodexClient()
  client.setNotificationHandler(handleCodexNotification)
  client.setRequestHandler(handleCodexServerRequest)
  client.setStderrHandler((chunk) => {
    const state = getActiveCodexRunState()
    if (state?.sender) {
      sendAgentCompatError(state.sender, 'codex', chunk, state)
    }
  })

  await client.ensureStarted(app.getVersion())

  const settings = AppStore.getSettings()
  const model = normalizeCodexModel(payload.model)
  const approvalPolicy = codexApprovalPolicyForMode(payload.approvalMode, settings)
  const sandbox = codexSandboxForMode(payload.approvalMode)
  const startOrResumeParams = {
    cwd: payload.workspace,
    model,
    ...(payload.serviceTier ? { serviceTier: payload.serviceTier } : {}),
    approvalPolicy,
    sandbox,
    experimentalRawEvents: false,
    persistExtendedHistory: true
  }

  let threadResponse: any
  if (payload.providerSessionId) {
    threadResponse = await client.request('thread/resume', {
      threadId: payload.providerSessionId,
      persistExtendedHistory: true
    }, 30_000)
  } else {
    threadResponse = await client.request('thread/start', startOrResumeParams, 30_000)
  }

  const thread = threadResponse?.thread || {}
  const threadId = thread.id || payload.providerSessionId
  if (!threadId) {
    throw new Error('Codex app-server did not return a thread id.')
  }

  const route = routeWithRunId('codex', payload)
  const codexState = createCodexRunState(event.sender, threadId, threadResponse?.model || model, payload.workspace, route)
  registerRunSession('codex', event.sender, codexState, payload.workspace, codexState, threadId)
  setActiveCodexRunState(codexState)
  void emitProviderCapabilityWarnings(event.sender, 'codex', payload.workspace, payload.approvalMode, codexState)

  sendAgentCompatLine(event.sender, 'codex', {
    type: 'init',
    session_id: threadId,
    model: threadResponse?.model || model,
    timestamp: new Date().toISOString(),
    provider: 'codex'
  }, codexState)

  await client.request('turn/start', {
    threadId,
    input: buildCodexUserInput(payload.prompt, payload.imagePaths),
    cwd: payload.workspace,
    approvalPolicy,
    sandboxPolicy: codexSandboxPolicyForMode(payload.approvalMode, payload.workspace, payload.externalPathGrants, settings),
    model,
    ...(payload.reasoningEffort ? { effort: payload.reasoningEffort } : {}),
    ...(payload.serviceTier ? { serviceTier: payload.serviceTier } : {})
  }, 60_000)
}

function runCodexExecFallback(event: Electron.IpcMainInvokeEvent, payload: AgentRunPayload, reason: string) {
  const route = routeWithRunId('codex', payload)
  const settings = AppStore.getSettings()
  if (codexNeedsApprovalGate(settings) || settings.agenticServices?.networkAccess === 'deny') {
    sendAgentCompatError(event.sender, 'codex', `Codex app-server unavailable and agentic service gates are active, so exec fallback is blocked. Reason: ${reason}`, route)
    sendAgentCompatExit(event.sender, 'codex', 1, route)
    return
  }

  const model = normalizeCodexModel(payload.model)
  const sandbox = codexSandboxForMode(payload.approvalMode)
  const args = ['exec', '--json', '--color', 'never', '-C', payload.workspace, '--sandbox', sandbox, '--model', model]
  for (const imagePath of payload.imagePaths || []) {
    args.push('--image', imagePath)
  }
  args.push(payload.prompt)

  registerRunSession('codex', event.sender, route, payload.workspace, undefined)
  void emitProviderCapabilityWarnings(event.sender, 'codex', payload.workspace, payload.approvalMode, route)

  sendAgentCompatError(event.sender, 'codex', `Codex app-server unavailable; falling back to codex exec --json for this one-shot run. Rich thread resume and approvals are unavailable. Reason: ${reason}`, route)
  if (normalizeExternalPathGrants(payload.externalPathGrants).length > 0) {
    sendAgentCompatError(event.sender, 'codex', 'Codex external path grants are not applied in exec fallback mode; app-server is required for scoped outside-workspace roots.', route)
  }
  sendAgentCompatLine(event.sender, 'codex', {
    type: 'init',
    session_id: `codex-exec-${Date.now()}`,
    model,
    timestamp: new Date().toISOString(),
    provider: 'codex',
    fallback: true
  }, route)

  const child = spawn('codex', args, {
    cwd: payload.workspace,
    shell: false,
    env: createCliEnv({
      FORCE_COLOR: '0',
      NO_COLOR: '1'
    })
  })
  codexExecProcess = child
  runManager.attachProcess(route.appRunId!, child)

  child.stdout?.on('data', (data) => {
    const text = data.toString()
    event.sender.send('agent-output', { provider: 'codex', data: text, ...route })
  })

  child.stderr?.on('data', (data) => {
    sendAgentCompatError(event.sender, 'codex', data.toString(), route)
  })

  child.on('close', (code) => {
    sendAgentCompatLine(event.sender, 'codex', {
      type: 'result',
      status: code === 0 ? 'success' : 'failed',
      stats: {},
    timestamp: new Date().toISOString(),
    provider: 'codex',
    fallback: true
    }, route)
    sendAgentCompatExit(event.sender, 'codex', code, route)
    if (codexExecProcess === child) codexExecProcess = null
    runManager.finish(route.appRunId, code === 0 ? 'completed' : 'failed')
  })

  child.on('error', (error) => {
    sendAgentCompatError(event.sender, 'codex', `Failed to start codex exec fallback: ${error.message}`, route)
    sendAgentCompatExit(event.sender, 'codex', -1, route)
    if (codexExecProcess === child) codexExecProcess = null
    runManager.finish(route.appRunId, 'failed')
  })
}

async function readCliVersion(command: string): Promise<string> {
  const provider = ['gemini', 'codex', 'claude', 'kimi'].includes(command)
    ? command as ProviderId
    : null
  const resolvedCommand = provider ? (await resolveCliProviderBinary(provider)).binaryPath || command : command

  return new Promise((resolve) => {
    const proc = spawn(resolvedCommand, ['--version'], {
      shell: false,
      env: createCliEnv({ FORCE_COLOR: '0', NO_COLOR: '1' }, resolvedCommand)
    })
    let stdout = ''
    proc.stdout?.on('data', (data) => { stdout += data.toString() })
    proc.on('close', (code) => {
      resolve(code === 0 && stdout.trim() ? stdout.trim() : 'unknown')
    })
    proc.on('error', () => resolve('unknown'))
  })
}

function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === 'solid' || value === 'soft_glass' || value === 'native_glass'
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}

function appendLimitedOutput(current: string, chunk: Buffer): { value: string; truncated: boolean } {
  const next = current + chunk.toString('utf8')
  if (next.length <= MAX_CAPABILITY_OUTPUT_CHARS) {
    return { value: next, truncated: false }
  }

  return {
    value: `${next.slice(0, MAX_CAPABILITY_OUTPUT_CHARS)}\n[output truncated]`,
    truncated: true
  }
}

function stringifyJsonFragment(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function readStringField(record: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = record[field]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
  }
  return undefined
}

function extractCapabilityJsonEntries(value: unknown, kind: GeminiCapabilityKind): Array<{ key?: string; value: unknown }> {
  if (Array.isArray(value)) {
    return value.map((entry) => ({ value: entry }))
  }

  const record = asRecord(value)
  if (!record) {
    return value === undefined || value === null ? [] : [{ value }]
  }

  const candidateKeys = [
    kind,
    kind === 'mcp' ? 'servers' : kind,
    kind === 'mcp' ? 'mcpServers' : kind,
    'items',
    'data',
    'results'
  ]

  for (const key of candidateKeys) {
    const candidate = record[key]
    if (Array.isArray(candidate)) {
      return candidate.map((entry) => ({ value: entry }))
    }

    const candidateRecord = asRecord(candidate)
    if (candidateRecord) {
      return Object.entries(candidateRecord).map(([entryKey, entryValue]) => ({ key: entryKey, value: entryValue }))
    }
  }

  if (Object.values(record).every((entry) => entry && typeof entry === 'object')) {
    return Object.entries(record).map(([entryKey, entryValue]) => ({ key: entryKey, value: entryValue }))
  }

  return [{ value }]
}

function parseCapabilityJsonItems(value: unknown, kind: GeminiCapabilityKind): GeminiCapabilityItem[] {
  return extractCapabilityJsonEntries(value, kind).map((entry, index) => {
    const record = asRecord(entry.value)
    const fallbackName = entry.key || `${kind} ${index + 1}`

    if (!record) {
      const raw = stringifyJsonFragment(entry.value)
      return {
        id: fallbackName,
        name: String(entry.value || fallbackName),
        raw
      }
    }

    const name = readStringField(record, ['name', 'displayName', 'title', 'id', 'server', 'extension', 'skill']) || fallbackName
    const id = readStringField(record, ['id', 'name', 'server', 'extension', 'skill']) || name
    const status =
      readStringField(record, ['status', 'state', 'lifecycleState', 'connectionStatus']) ||
      (typeof record.enabled === 'boolean' ? (record.enabled ? 'enabled' : 'disabled') : undefined) ||
      (typeof record.active === 'boolean' ? (record.active ? 'active' : 'inactive') : undefined) ||
      (typeof record.installed === 'boolean' ? (record.installed ? 'installed' : 'not installed') : undefined)
    const detail = readStringField(record, ['description', 'summary', 'path', 'command', 'version'])

    return {
      id,
      name,
      status,
      detail,
      raw: stringifyJsonFragment(entry.value)
    }
  })
}

function parseCapabilityRawItems(stdout: string, kind: GeminiCapabilityKind): GeminiCapabilityItem[] {
  return stripAnsi(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[-+|=\s]+$/.test(line))
    .filter((line) => !/^(name|id)\b.*\b(status|state|description|command)\b/i.test(line))
    .filter((line) => !/^no\s+.+\s+(configured|found|installed|available)\.?$/i.test(line))
    .filter((line) => !/^.+:\s*$/.test(line))
    .map((line, index) => {
      const normalized = line.replace(/^[*•-]\s*/, '')
      const columns = normalized.split(/\s*\|\s*|\t+|\s{2,}/).map((part) => part.trim()).filter(Boolean)
      const statusMatch = normalized.match(/\b(active|enabled|disabled|installed|running|connected|disconnected|ok|error|failed|unavailable|loaded|trusted|untrusted|inactive)\b/i)
      const name = columns[0] || normalized
      const detail = columns.length > 1 ? columns.slice(1).join(' · ') : undefined

      return {
        id: `${kind}-${index + 1}`,
        name,
        status: statusMatch?.[1],
        detail,
        raw: line
      }
    })
}

async function runGeminiCapabilityCommand(args: string[], cwd?: string): Promise<GeminiCapabilityProcessResult> {
  const resolved = await resolveCliProviderBinary('gemini')
  if (!resolved.binaryPath) {
    return {
      args,
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: false,
      error: resolved.error || 'Gemini CLI is not configured.'
    }
  }
  const geminiBinaryPath = resolved.binaryPath

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let truncated = false
    let timedOut = false
    let finished = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    const finish = (exitCode: number | null, error?: string): void => {
      if (finished) return
      finished = true
      if (timeout) clearTimeout(timeout)
      resolve({
        args,
        stdout,
        stderr,
        exitCode,
        timedOut,
        error,
        truncated
      })
    }

    let proc: ChildProcess
    try {
      proc = spawn(geminiBinaryPath, args, {
        cwd,
        shell: false,
        env: createCliEnv({ FORCE_COLOR: '0', NO_COLOR: '1' }, geminiBinaryPath)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      resolve({ args, stdout, stderr, exitCode: null, timedOut: false, error: message })
      return
    }

    timeout = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, GEMINI_CAPABILITY_TIMEOUT_MS)

    proc.stdout?.on('data', (data: Buffer) => {
      const appended = appendLimitedOutput(stdout, data)
      stdout = appended.value
      truncated = truncated || appended.truncated
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const appended = appendLimitedOutput(stderr, data)
      stderr = appended.value
      truncated = truncated || appended.truncated
    })

    proc.on('close', (code) => finish(code))
    proc.on('error', (error) => finish(null, error.message))
  })
}

function localDaylightState(): boolean {
  const hour = new Date().getHours()
  return hour >= 7 && hour < 19
}

function parseLocalAstronomyTime(value?: string): Date | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null

  const match = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
  if (!match) return null

  let hour = Number(match[1])
  const minute = Number(match[2])
  const meridiem = match[3]?.toUpperCase()

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null
  }

  if (meridiem === 'PM' && hour < 12) hour += 12
  if (meridiem === 'AM' && hour === 12) hour = 0
  if (hour < 0 || hour > 23) return null

  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0)
}

function resolveAstronomyDaylight(sunrise?: string, sunset?: string): boolean | null {
  const sunriseAt = parseLocalAstronomyTime(sunrise)
  const sunsetAt = parseLocalAstronomyTime(sunset)
  if (!sunriseAt || !sunsetAt) return null

  const now = new Date()
  const effectiveSunset = sunsetAt <= sunriseAt
    ? new Date(sunsetAt.getTime() + 24 * 60 * 60 * 1000)
    : sunsetAt

  return now >= sunriseAt && now < effectiveSunset
}

function createFallbackHostWeather(error?: string): HostWeatherState {
  const fallback: HostWeatherState = {
    kind: 'unknown',
    description: localDaylightState() ? 'Local daytime sky' : 'Local night sky',
    isDay: localDaylightState(),
    updatedAt: new Date().toISOString(),
    source: 'fallback'
  }
  if (error) {
    fallback.error = error
  }
  return fallback
}

function classifyHostWeather(weatherCode: number | null, description: string): HostWeatherKind {
  const normalizedDescription = description.toLowerCase()

  if ([200, 386, 389, 392, 395].includes(weatherCode ?? -1) || /thunder|storm/.test(normalizedDescription)) {
    return 'storm'
  }

  if (
    [
      179, 227, 230, 317, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377, 392, 395
    ].includes(weatherCode ?? -1) ||
    /snow|sleet|blizzard|ice|freezing/.test(normalizedDescription)
  ) {
    return 'snow'
  }

  if (
    [302, 305, 308, 356, 359].includes(weatherCode ?? -1) ||
    /heavy|torrential|downpour/.test(normalizedDescription)
  ) {
    return 'heavy_rain'
  }

  if (
    [
      176, 182, 185, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308, 311, 314, 353, 356, 359, 386, 389
    ].includes(weatherCode ?? -1) ||
    /rain|drizzle|shower/.test(normalizedDescription)
  ) {
    return 'rain'
  }

  if ([248, 260].includes(weatherCode ?? -1) || /fog/.test(normalizedDescription)) {
    return 'fog'
  }

  if (weatherCode === 143 || /mist|haze/.test(normalizedDescription)) {
    return 'mist'
  }

  if (weatherCode === 116 || /partly|patchy/.test(normalizedDescription)) {
    return 'partly_cloudy'
  }

  if (weatherCode === 122 || /overcast/.test(normalizedDescription)) {
    return 'overcast'
  }

  if (weatherCode === 119 || /cloud/.test(normalizedDescription)) {
    return 'cloudy'
  }

  if (weatherCode === 113 || /sunny|clear/.test(normalizedDescription)) {
    return 'clear'
  }

  return 'unknown'
}

function runHostWeatherCommand(): Promise<{ stdout: string; error?: string }> {
  return new Promise((resolve) => {
    const command = os.platform() === 'darwin' ? '/usr/bin/curl' : 'curl'
    const args = ['-fsSL', '--max-time', '5', 'https://wttr.in/?format=j1']
    let stdout = ''
    let stderr = ''
    let finished = false
    let timedOut = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    const finish = (error?: string): void => {
      if (finished) return
      finished = true
      if (timeout) clearTimeout(timeout)
      resolve({ stdout, error })
    }

    let proc: ChildProcess
    try {
      proc = spawn(command, args, { shell: false })
    } catch (error) {
      finish(error instanceof Error ? error.message : String(error))
      return
    }

    timeout = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
      finish('weather command timed out')
    }, HOST_WEATHER_TIMEOUT_MS)

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < 1_000_000) {
        stdout += chunk.toString('utf8')
      }
    })

    proc.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 20_000) {
        stderr += chunk.toString('utf8')
      }
    })

    proc.on('error', (error) => finish(error.message))
    proc.on('close', (code) => {
      if (timedOut) return
      finish(code === 0 ? undefined : stderr.trim() || `weather command exited with ${code}`)
    })
  })
}

async function readHostWeather(): Promise<HostWeatherState> {
  const result = await runHostWeatherCommand()
  if (result.error) {
    return createFallbackHostWeather(result.error)
  }

  try {
    const parsed = JSON.parse(result.stdout)
    const current = Array.isArray(parsed?.current_condition) ? parsed.current_condition[0] : null
    const nearestArea = Array.isArray(parsed?.nearest_area) ? parsed.nearest_area[0] : null
    const todayWeather = Array.isArray(parsed?.weather) ? parsed.weather[0] : null
    const astronomy = Array.isArray(todayWeather?.astronomy) ? todayWeather.astronomy[0] : null
    const description = current?.weatherDesc?.[0]?.value || 'Local sky'
    const weatherCode = Number.isFinite(Number(current?.weatherCode)) ? Number(current.weatherCode) : null
    const temperatureC = Number.isFinite(Number(current?.temp_C)) ? Number(current.temp_C) : undefined
    const areaName = nearestArea?.areaName?.[0]?.value
    const region = nearestArea?.region?.[0]?.value
    const country = nearestArea?.country?.[0]?.value
    const location = [areaName, region, country].filter(Boolean).join(', ') || undefined
    const isDay = resolveAstronomyDaylight(astronomy?.sunrise, astronomy?.sunset) ?? localDaylightState()

    return {
      kind: classifyHostWeather(weatherCode, description),
      description,
      isDay,
      updatedAt: new Date().toISOString(),
      source: 'wttr',
      ...(temperatureC !== undefined ? { temperatureC } : {}),
      ...(location ? { location } : {})
    }
  } catch (error) {
    return createFallbackHostWeather(error instanceof Error ? error.message : String(error))
  }
}

async function getCachedHostWeather(): Promise<HostWeatherState> {
  const now = Date.now()
  if (hostWeatherCache && now - hostWeatherCacheAt < HOST_WEATHER_CACHE_MS) {
    return hostWeatherCache
  }

  hostWeatherCache = await readHostWeather()
  hostWeatherCacheAt = now
  return hostWeatherCache
}

async function resolveCapabilityWorkspace(workspace?: string): Promise<string | undefined> {
  if (typeof workspace !== 'string' || !workspace.trim()) {
    return undefined
  }

  const workspaceRoot = resolve(workspace)
  const workspaceStat = await fs.stat(workspaceRoot)
  if (!workspaceStat.isDirectory()) {
    throw new Error('Workspace path is not a directory.')
  }
  return workspaceRoot
}

async function readGeminiCapabilitySection(kind: GeminiCapabilityKind, cwd?: string): Promise<GeminiCapabilitySection> {
  const baseCommand = [...GEMINI_CAPABILITY_COMMANDS[kind]]
  const jsonResult = await runGeminiCapabilityCommand([...baseCommand, '--json'], cwd)

  if (jsonResult.exitCode === 0 && jsonResult.stdout.trim()) {
    try {
      const parsed = JSON.parse(stripAnsi(jsonResult.stdout))
      return {
        kind,
        command: ['gemini', ...jsonResult.args],
        format: 'json',
        items: parseCapabilityJsonItems(parsed, kind),
        stdout: jsonResult.stdout,
        stderr: jsonResult.stderr,
        status: jsonResult.exitCode,
        timedOut: jsonResult.timedOut,
        error: jsonResult.error,
        truncated: jsonResult.truncated
      }
    } catch (error) {
      const rawResult = await runGeminiCapabilityCommand(baseCommand, cwd)
      return {
        kind,
        command: ['gemini', ...rawResult.args],
        format: rawResult.error || rawResult.timedOut ? 'error' : 'raw',
        items: rawResult.exitCode === 0 ? parseCapabilityRawItems(rawResult.stdout, kind) : [],
        stdout: rawResult.stdout,
        stderr: rawResult.stderr,
        status: rawResult.exitCode,
        timedOut: rawResult.timedOut,
        error: rawResult.error,
        parsingError: error instanceof Error ? error.message : String(error),
        truncated: rawResult.truncated
      }
    }
  }

  const rawResult = await runGeminiCapabilityCommand(baseCommand, cwd)
  return {
    kind,
    command: ['gemini', ...rawResult.args],
    format: rawResult.error || rawResult.timedOut ? 'error' : 'raw',
    items: rawResult.exitCode === 0 ? parseCapabilityRawItems(rawResult.stdout, kind) : [],
    stdout: rawResult.stdout,
    stderr: rawResult.stderr,
    status: rawResult.exitCode,
    timedOut: rawResult.timedOut,
    error: rawResult.error,
    truncated: rawResult.truncated
  }
}

function geminiMcpSocketPath(): string {
  return join(app.getPath('userData'), 'agentbench-gemini-mcp.sock')
}

function normalizeMcpToolArguments(value: unknown): Record<string, any> {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value }
    } catch {
      return { value }
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>
  }
  return { value }
}

function isAgentBenchMcpToolName(value: unknown): value is AgentBenchMcpToolName {
  return AGENTBENCH_MCP_TOOLS.includes(value as AgentBenchMcpToolName)
}

function formatHostCommandResult(result: HostCommandResult): string {
  const parts = [
    `Exit code: ${result.exitCode ?? (result.timedOut ? 'timeout' : 'unknown')}`,
    result.stdout ? `stdout:\n${result.stdout}` : '',
    result.stderr ? `stderr:\n${result.stderr}` : '',
    result.error ? `error:\n${result.error}` : ''
  ].filter(Boolean)
  return parts.join('\n\n')
}

async function executeGeminiMcpTool(toolName: AgentBenchMcpToolName, rawArgs: unknown, route?: AgentRunRoute | null): Promise<{ text: string; isError?: boolean }> {
  const context = getGeminiToolContext(route)
  if (!context) {
    return { text: 'AgentBench has no active Gemini workspace context for this MCP tool call.', isError: true }
  }

  const workspacePath = resolve(context.workspacePath)
  const args = normalizeMcpToolArguments(rawArgs)
  const cwd = resolveWorkspaceDirectory(workspacePath, String(args.cwd || args.working_directory || args.workdir || ''))
  const approvalPreview = previewForGeminiMcpTool(toolName, args, cwd, workspacePath)
  const allowed = await requestAgenticServiceApproval(context.sender, 'gemini', approvalPreview.service, workspacePath, {
    method: `gemini-mcp/${toolName}`,
    title: approvalPreview.title,
    body: approvalPreview.body,
    preview: approvalPreview.preview,
    runId: context.appRunId
  })
  const toolId = `gemini-mcp-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2)}`

  sendAgentCompatLine(context.sender, 'gemini', {
    type: 'tool_use',
    tool_id: toolId,
    tool_name: toolName,
    parameters: { ...args, cwd },
    provider: 'gemini',
    server: GEMINI_MCP_SERVER_NAME
  })

  if (!allowed) {
    const text = `${AGENTIC_SERVICE_LABELS[approvalPreview.service]} denied by AgentBench.`
    sendAgentCompatLine(context.sender, 'gemini', {
      type: 'tool_result',
      tool_id: toolId,
      tool_name: toolName,
      status: 'error',
      output: text,
      provider: 'gemini',
      server: GEMINI_MCP_SERVER_NAME
    })
    return { text, isError: true }
  }

  try {
    let text = ''

    if (toolName === 'run_shell_command') {
      const command = String(args.command || '').trim()
      if (!command) throw new Error('command is required.')
      const result = await runHostCommand(command, cwd)
      text = formatHostCommandResult(result)
      const isError = Boolean(result.error || result.timedOut || (result.exitCode !== null && result.exitCode !== 0))
      sendAgentCompatLine(context.sender, 'gemini', {
        type: 'tool_result',
        tool_id: toolId,
        tool_name: toolName,
        status: isError ? 'error' : 'success',
        output: text,
        result: { exitCode: result.exitCode, durationMs: result.durationMs },
        provider: 'gemini',
        server: GEMINI_MCP_SERVER_NAME
      })
      return { text, isError }
    }

    if (toolName === 'read_file') {
      const targetPath = resolveGeminiMcpPath(workspacePath, String(args.path || args.file_path || ''))
      const stat = await fs.stat(targetPath)
      if (!stat.isFile()) throw new Error('Selected path is not a file.')
      if (stat.size > MAX_EDITOR_FILE_BYTES) throw new Error('File is too large to read through the MCP bridge.')
      const buffer = await fs.readFile(targetPath)
      assertTextBuffer(buffer)
      text = buffer.toString('utf8')
    } else if (toolName === 'list_directory') {
      const targetPath = resolveGeminiMcpPath(workspacePath, String(args.path || args.directory || '.'))
      const stat = await fs.stat(targetPath)
      if (!stat.isDirectory()) throw new Error('Selected path is not a directory.')
      const entries = await fs.readdir(targetPath, { withFileTypes: true })
      text = entries
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        .slice(0, 300)
        .map((entry) => `${entry.isDirectory() ? 'directory' : 'file'}\t${entry.name}`)
        .join('\n')
    } else if (toolName === 'write_file') {
      const targetPath = resolveGeminiMcpPath(workspacePath, String(args.path || args.file_path || ''))
      const content = String(args.content ?? '')
      await fs.mkdir(dirname(targetPath), { recursive: true })
      await fs.writeFile(targetPath, content, 'utf8')
      text = `Wrote ${toWorkspaceRelativePath(workspacePath, targetPath)} (${content.length} chars).`
    } else if (toolName === 'replace') {
      const targetPath = resolveGeminiMcpPath(workspacePath, String(args.path || args.file_path || ''))
      const oldString = String(args.old_string ?? args.oldString ?? '')
      const newString = String(args.new_string ?? args.newString ?? '')
      if (!oldString) throw new Error('old_string is required.')
      const original = await fs.readFile(targetPath, 'utf8')
      if (!original.includes(oldString)) throw new Error('old_string was not found in the target file.')
      const updated = args.replace_all === true || args.replaceAll === true
        ? original.split(oldString).join(newString)
        : original.replace(oldString, newString)
      await fs.writeFile(targetPath, updated, 'utf8')
      text = `Edited ${toWorkspaceRelativePath(workspacePath, targetPath)}.`
    }

    sendAgentCompatLine(context.sender, 'gemini', {
      type: 'tool_result',
      tool_id: toolId,
      tool_name: toolName,
      status: 'success',
      output: text,
      provider: 'gemini',
      server: GEMINI_MCP_SERVER_NAME
    })
    return { text }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    sendAgentCompatLine(context.sender, 'gemini', {
      type: 'tool_result',
      tool_id: toolId,
      tool_name: toolName,
      status: 'error',
      output: text,
      provider: 'gemini',
      server: GEMINI_MCP_SERVER_NAME
    })
    return { text, isError: true }
  }
}

async function handleGeminiMcpBrokerRequest(request: any): Promise<any> {
  const toolName = request?.tool || request?.name
  if (!isAgentBenchMcpToolName(toolName)) {
    return { ok: false, error: `Unknown AgentBench MCP tool: ${String(toolName || 'unknown')}` }
  }
  const result = await executeGeminiMcpTool(toolName, request?.arguments ?? request?.args ?? request?.input, normalizeRunRoute(request))
  return { ok: !result.isError, ...result }
}

async function startGeminiMcpBroker(): Promise<void> {
  if (geminiMcpBroker) return
  const socketPath = geminiMcpSocketPath()
  await fs.mkdir(dirname(socketPath), { recursive: true }).catch(() => {})
  await fs.unlink(socketPath).catch(() => {})

  geminiMcpBroker = createServer((socket: Socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let parsed: any
        try {
          parsed = JSON.parse(trimmed)
        } catch (error) {
          socket.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
          continue
        }
        handleGeminiMcpBrokerRequest(parsed)
          .then((result) => socket.write(`${JSON.stringify({ id: parsed.id, ...result })}\n`))
          .catch((error) => socket.write(`${JSON.stringify({ id: parsed.id, ok: false, error: error instanceof Error ? error.message : String(error) })}\n`))
      }
    })
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    const server = geminiMcpBroker
    if (!server) {
      rejectListen(new Error('Gemini MCP broker failed to initialize.'))
      return
    }
    const handleError = (error: Error) => {
      server.off('listening', handleListening)
      rejectListen(error)
    }
    const handleListening = () => {
      server.off('error', handleError)
      resolveListen()
    }
    server.once('error', handleError)
    server.once('listening', handleListening)
    server.listen(socketPath)
  })
}

function brokerRequest(socketPath: string, request: any): Promise<any> {
  return new Promise((resolveRequest) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    let settled = false
    const finish = (result: any) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolveRequest(result)
    }
    const timeout = setTimeout(() => finish({ ok: false, error: 'AgentBench MCP broker timed out.' }), 130_000)
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`)
    })
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const lineEnd = buffer.indexOf('\n')
      if (lineEnd < 0) return
      clearTimeout(timeout)
      const line = buffer.slice(0, lineEnd).trim()
      try {
        finish(JSON.parse(line))
      } catch (error) {
        finish({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
    socket.on('error', (error) => {
      clearTimeout(timeout)
      finish({ ok: false, error: error.message })
    })
    socket.on('close', () => {
      clearTimeout(timeout)
      if (!settled) finish({ ok: false, error: 'AgentBench MCP broker closed before responding.' })
    })
  })
}

function mcpToolDefinitions() {
  return [
    {
      name: 'run_shell_command',
      description: 'Run a shell command in the active AgentBench workspace after AgentBench approval policy allows it.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          cwd: { type: 'string', description: 'Optional workspace-relative or in-workspace absolute cwd.' }
        },
        required: ['command']
      }
    },
    {
      name: 'write_file',
      description: 'Write a UTF-8 text file inside the active AgentBench workspace after approval.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      }
    },
    {
      name: 'replace',
      description: 'Replace text in a UTF-8 file inside the active AgentBench workspace after approval.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
          replace_all: { type: 'boolean' }
        },
        required: ['path', 'old_string', 'new_string']
      }
    },
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file inside the active AgentBench workspace after tool policy allows it.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    },
    {
      name: 'list_directory',
      description: 'List a directory inside the active AgentBench workspace after tool policy allows it.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        }
      }
    }
  ]
}

function parseBridgeSocketArg(): string {
  const index = process.argv.indexOf(GEMINI_MCP_SOCKET_ARG)
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1]
  }
  return geminiMcpSocketPath()
}

function writeMcpFrame(payload: unknown): void {
  const body = JSON.stringify(payload)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
}

function writeMcpResponse(id: unknown, result: unknown): void {
  writeMcpFrame({ jsonrpc: '2.0', id, result })
}

function writeMcpError(id: unknown, code: number, message: string): void {
  writeMcpFrame({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
}

function handleMcpJsonRpcMessage(socketPath: string, message: any): void {
  const id = message?.id
  const method = String(message?.method || '')
  if (!method) {
    writeMcpError(id, -32600, 'Invalid MCP request.')
    return
  }
  if (method.startsWith('notifications/')) {
    return
  }
  if (method === 'initialize') {
    writeMcpResponse(id, {
      protocolVersion: message?.params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'AgentBench Gemini Bridge', version: app.getVersion() || '1.0.0' }
    })
    return
  }
  if (method === 'tools/list') {
    writeMcpResponse(id, { tools: mcpToolDefinitions() })
    return
  }
  if (method === 'tools/call') {
    const name = message?.params?.name
    const args = message?.params?.arguments || {}
    brokerRequest(socketPath, {
      id: id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      tool: name,
      arguments: args,
      appRunId: process.env.AGENTBENCH_RUN_ID,
      appChatId: process.env.AGENTBENCH_CHAT_ID
    }).then((result) => {
      const text = result?.text || result?.error || ''
      writeMcpResponse(id, {
        content: [{ type: 'text', text }],
        isError: result?.ok === false
      })
    })
    return
  }
  writeMcpError(id, -32601, `Unsupported MCP method: ${method}`)
}

function startGeminiMcpBridgeProcess(): void {
  const socketPath = parseBridgeSocketArg()
  let buffer = Buffer.alloc(0)

  const parseMessages = () => {
    while (buffer.length > 0) {
      const text = buffer.toString('utf8')
      if (text.startsWith('Content-Length:')) {
        const headerEnd = text.indexOf('\r\n\r\n')
        if (headerEnd < 0) return
        const header = text.slice(0, headerEnd)
        const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
        const contentLength = lengthMatch ? Number(lengthMatch[1]) : 0
        if (!Number.isFinite(contentLength) || contentLength <= 0) {
          buffer = buffer.subarray(headerEnd + 4)
          continue
        }
        const bodyStart = Buffer.byteLength(text.slice(0, headerEnd + 4), 'utf8')
        if (buffer.length < bodyStart + contentLength) return
        const body = buffer.subarray(bodyStart, bodyStart + contentLength).toString('utf8')
        buffer = buffer.subarray(bodyStart + contentLength)
        try {
          handleMcpJsonRpcMessage(socketPath, JSON.parse(body))
        } catch (error) {
          writeMcpError(null, -32700, error instanceof Error ? error.message : String(error))
        }
        continue
      }

      const lineEnd = text.indexOf('\n')
      if (lineEnd < 0) return
      const lineBytes = Buffer.byteLength(text.slice(0, lineEnd + 1), 'utf8')
      const line = text.slice(0, lineEnd).trim()
      buffer = buffer.subarray(lineBytes)
      if (!line) continue
      try {
        handleMcpJsonRpcMessage(socketPath, JSON.parse(line))
      } catch (error) {
        writeMcpError(null, -32700, error instanceof Error ? error.message : String(error))
      }
    }
  }

  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    parseMessages()
  })
  process.stdin.resume()
}

async function getGeminiMcpBridgeStatus(): Promise<GeminiMcpBridgeStatus> {
  const settings = AppStore.getSettings()
  const socketPath = geminiMcpSocketPath()
  const section = await readGeminiCapabilitySection('mcp')
  const raw = [section.stdout, section.stderr].filter(Boolean).join('\n')
  const bridgeItem = section.items.find((item) => {
    const haystack = `${item.id} ${item.name} ${item.detail || ''} ${item.raw || ''}`.toLowerCase()
    return haystack.includes(GEMINI_MCP_SERVER_NAME)
  })
  const installed = Boolean(bridgeItem || raw.toLowerCase().includes(GEMINI_MCP_SERVER_NAME))
  const disabled = Boolean(bridgeItem && /disabled|inactive|off/i.test(`${bridgeItem.status || ''} ${bridgeItem.raw || ''}`))
  const available = Boolean(installed && !disabled && section.status === 0 && !section.error && !section.timedOut)
  const status: GeminiMcpBridgeStatus = {
    checkedAt: new Date().toISOString(),
    enabled: Boolean(settings.geminiMcpBridgeEnabled),
    installed,
    available,
    serverName: GEMINI_MCP_SERVER_NAME,
    socketPath,
    command: ['gemini', 'mcp', 'list'],
    raw,
    ...(section.error || section.parsingError ? { error: section.error || section.parsingError } : {}),
    message: available
      ? 'AgentBench Gemini MCP bridge is installed and enabled.'
      : installed && disabled
        ? 'AgentBench Gemini MCP bridge is installed but disabled.'
        : installed
          ? 'AgentBench Gemini MCP bridge is installed but did not report as available.'
          : 'AgentBench Gemini MCP bridge is not installed.'
  }
  AppStore.updateSettings({ geminiMcpBridgeLastStatus: status })
  return status
}

async function installGeminiMcpBridge(): Promise<GeminiMcpBridgeStatus> {
  await startGeminiMcpBroker()
  const resolved = await resolveCliProviderBinary('gemini')
  if (!resolved.binaryPath) {
    throw new Error(resolved.error || 'Gemini CLI is not configured.')
  }
  const socketPath = geminiMcpSocketPath()
  await captureProcessOutput(resolved.binaryPath, ['mcp', 'remove', GEMINI_MCP_SERVER_NAME], undefined, 8_000)
  const addResult = await captureProcessOutput(resolved.binaryPath, [
    'mcp',
    'add',
    GEMINI_MCP_SERVER_NAME,
    process.execPath,
    GEMINI_MCP_BRIDGE_ARG,
    GEMINI_MCP_SOCKET_ARG,
    socketPath
  ], undefined, 15_000)
  if (addResult.code !== 0) {
    throw new Error((addResult.stderr || addResult.stdout || addResult.error || 'gemini mcp add failed.').trim())
  }
  await captureProcessOutput(resolved.binaryPath, ['mcp', 'enable', GEMINI_MCP_SERVER_NAME], undefined, 8_000)
  AppStore.updateSettings({ geminiMcpBridgeEnabled: true })
  return getGeminiMcpBridgeStatus()
}

async function setGeminiMcpBridgeEnabled(enabled: boolean): Promise<GeminiMcpBridgeStatus> {
  AppStore.updateSettings({ geminiMcpBridgeEnabled: Boolean(enabled) })
  const statusBefore = await getGeminiMcpBridgeStatus()
  if (statusBefore.installed) {
    const resolved = await resolveCliProviderBinary('gemini')
    if (resolved.binaryPath) {
      await captureProcessOutput(resolved.binaryPath, ['mcp', enabled ? 'enable' : 'disable', GEMINI_MCP_SERVER_NAME], undefined, 8_000)
    }
  }
  const status = await getGeminiMcpBridgeStatus()
  AppStore.updateSettings({ geminiMcpBridgeEnabled: Boolean(enabled), geminiMcpBridgeLastStatus: status })
  return { ...status, enabled: Boolean(enabled) }
}

async function prepareGeminiMcpBridgeForRun(sender: Electron.WebContents, workspace: string, channel: 'gemini-output' | 'gemini-session-data', route?: AgentRunRoute | null): Promise<void> {
  const routed = routeWithRunId('gemini', route)
  activeGeminiToolContext = {
    sender,
    workspacePath: resolve(workspace),
    ...routed
  }
  registerRunSession('gemini', sender, routed, resolve(workspace), activeGeminiToolContext, activeGeminiToolContext.providerSessionId || null)
  const settings = AppStore.getSettings()
  if (!settings.geminiMcpBridgeEnabled) {
    return
  }
  try {
    await startGeminiMcpBroker()
    const status = await getGeminiMcpBridgeStatus()
    if (!status.available) {
      const message = `AgentBench Gemini MCP bridge is enabled but unavailable: ${status.message || status.error || 'unknown status'}. Shell and file tools from AgentBench will not be advertised for this run.`
      if (channel === 'gemini-session-data') {
        sender.send(channel, `${message}\r\n`)
      } else {
        sendAgentCompatError(sender, 'gemini', message, route)
      }
    }
  } catch (error) {
    const message = `AgentBench Gemini MCP bridge preflight failed: ${error instanceof Error ? error.message : String(error)}`
    if (channel === 'gemini-session-data') {
      sender.send(channel, `${message}\r\n`)
    } else {
      sendAgentCompatError(sender, 'gemini', message, route)
    }
  }
}

function resolveNativeVibrancy(useNativeGlass: boolean): BrowserWindowConstructorOptions['vibrancy'] | undefined {
  return useNativeGlass ? NATIVE_GLASS_VIBRANCY : undefined
}

function resolveWorkspaceChild(workspace: string, filePath: string): string {
  const workspaceRoot = resolve(workspace)
  const targetPath = isAbsolute(filePath) ? resolve(filePath) : resolve(workspaceRoot, filePath)
  const rel = relative(workspaceRoot, targetPath)
  if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Path is outside the workspace.')
  }
  return targetPath
}

function toWorkspaceRelativePath(workspace: string, targetPath: string): string {
  return relative(resolve(workspace), resolve(targetPath)).replace(/\\/g, '/')
}

function appendGeminiCliWorktreeArgs(args: string[], worktree: GeminiWorktreeLaunchOption = null): string | null {
  if (!worktree) {
    return null
  }

  let enabled = false
  let name: string | undefined

  if (typeof worktree === 'boolean') {
    enabled = worktree
  } else if (typeof worktree === 'string') {
    enabled = true
    name = worktree
  } else {
    enabled = Boolean(worktree.enabled)
    name = typeof worktree.name === 'string' ? worktree.name : undefined
  }

  if (!enabled) {
    return null
  }

  const normalizedName = name?.trim()
  if (normalizedName) {
    const hasParentTraversal = normalizedName.split(/[\\/]+/).some((part) => part === '..')
    if (
      normalizedName.startsWith('-') ||
      isAbsolute(normalizedName) ||
      hasParentTraversal ||
      !/^[a-zA-Z0-9._/-]+$/.test(normalizedName)
    ) {
      return 'Invalid Gemini worktree name provided. Execution blocked.'
    }
    args.push('--worktree', normalizedName)
    return null
  }

  args.push('--worktree')
  return null
}

async function listWorkspaceFileEntries(workspace: string): Promise<WorkspaceFileEntry[]> {
  const workspaceRoot = resolve(workspace)
  const entries: WorkspaceFileEntry[] = []

  async function walk(dirPath: string, depth: number): Promise<void> {
    if (entries.length >= MAX_EDITOR_FILES || depth > MAX_EDITOR_DEPTH) {
      return
    }

    let dirEntries
    try {
      dirEntries = await fs.readdir(dirPath, { withFileTypes: true })
    } catch {
      return
    }

    dirEntries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    for (const dirent of dirEntries) {
      if (entries.length >= MAX_EDITOR_FILES) break
      if (dirent.name.startsWith('.') && dirent.name !== '.env') continue
      if (dirent.isDirectory() && SKIP_EDITOR_DIRS.has(dirent.name)) continue

      const fullPath = join(dirPath, dirent.name)
      const relPath = toWorkspaceRelativePath(workspaceRoot, fullPath)
      let sizeBytes: number | undefined

      if (!dirent.isDirectory()) {
        try {
          sizeBytes = (await fs.stat(fullPath)).size
        } catch {
          sizeBytes = undefined
        }
      }

      entries.push({
        path: relPath,
        name: dirent.name,
        isDirectory: dirent.isDirectory(),
        sizeBytes,
        depth
      })

      if (dirent.isDirectory()) {
        await walk(fullPath, depth + 1)
      }
    }
  }

  await walk(workspaceRoot, 0)
  return entries
}

function assertTextBuffer(buffer: Buffer): void {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096))
  if (sample.includes(0)) {
    throw new Error('This looks like a binary file, so the basic editor will not open it.')
  }
}

function normalizeGeminiResumeTarget(value?: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const target = value.trim()
  if (!target) {
    return null
  }

  return /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,511}$/.test(target) ? target : null
}

function sanitizeGeminiSessionLine(line: string): string {
  return stripAnsi(line)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_GEMINI_SESSION_LINE_LENGTH)
}

function normalizeSessionField(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined
  }

  const normalized = sanitizeGeminiSessionLine(String(value))
  return normalized || undefined
}

function collectGeminiSessionRawLines(...outputs: string[]): string[] {
  const lines = outputs
    .flatMap((output) => output.split(/\r?\n/))
    .map(sanitizeGeminiSessionLine)
    .filter(Boolean)

  return lines.slice(0, MAX_GEMINI_SESSION_LINES)
}

function parseGeminiSessionJson(stdout: string): GeminiSessionSummary[] {
  const trimmed = stdout.trim()
  if (!trimmed || !/^[\[{]/.test(trimmed)) {
    return []
  }

  try {
    const parsed = JSON.parse(trimmed)
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.sessions)
        ? parsed.sessions
        : Array.isArray(parsed?.data)
          ? parsed.data
          : []

    return entries
      .map((entry: unknown): GeminiSessionSummary | null => {
        if (typeof entry === 'string' || typeof entry === 'number') {
          const id = normalizeSessionField(entry)
          return id ? { id } : null
        }

        if (!entry || typeof entry !== 'object') {
          return null
        }

        const session = entry as Record<string, unknown>
        const id = normalizeSessionField(session.session_id ?? session.sessionId ?? session.id ?? session.name)
        if (!id) {
          return null
        }

        return {
          id,
          title: normalizeSessionField(session.title ?? session.label ?? session.description),
          createdAt: normalizeSessionField(session.created_at ?? session.createdAt),
          updatedAt: normalizeSessionField(session.updated_at ?? session.updatedAt ?? session.last_modified ?? session.lastModified)
        }
      })
      .filter((entry): entry is GeminiSessionSummary => Boolean(entry))
      .slice(0, MAX_GEMINI_SESSION_LINES)
  } catch {
    return []
  }
}

async function listGeminiSessions(): Promise<GeminiSessionListResult> {
  const resolved = await resolveCliProviderBinary('gemini')
  if (!resolved.binaryPath) {
    return {
      ok: false,
      sessions: [],
      rawLines: [],
      error: resolved.error || 'Gemini CLI is not configured.'
    }
  }
  const geminiBinaryPath = resolved.binaryPath

  return new Promise((resolve) => {
    const proc: ChildProcess = spawn(geminiBinaryPath, ['--list-sessions'], {
      shell: false,
      env: createCliEnv({ FORCE_COLOR: '0', NO_COLOR: '1' }, geminiBinaryPath)
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    const finish = (result: GeminiSessionListResult): void => {
      if (settled) {
        return
      }
      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      resolve(result)
    }

    timeout = setTimeout(() => {
      proc.kill()
      finish({
        ok: false,
        sessions: [],
        rawLines: collectGeminiSessionRawLines(stdout, stderr),
        error: 'gemini --list-sessions timed out.'
      })
    }, 8000)

    proc.stdout?.on('data', (data) => { stdout += data.toString() })
    proc.stderr?.on('data', (data) => { stderr += data.toString() })
    proc.on('close', (code) => {
      const rawLines = collectGeminiSessionRawLines(stdout, stderr)
      if (code !== 0) {
        finish({
          ok: false,
          sessions: [],
          rawLines,
          error: sanitizeGeminiSessionLine(stderr) || `gemini --list-sessions exited with code ${code ?? 'unknown'}.`
        })
        return
      }

      finish({
        ok: true,
        sessions: parseGeminiSessionJson(stdout),
        rawLines
      })
    })
    proc.on('error', (err) => {
      finish({
        ok: false,
        sessions: [],
        rawLines: collectGeminiSessionRawLines(stdout, stderr),
        error: `Failed to list Gemini sessions: ${sanitizeGeminiSessionLine(err.message)}`
      })
    })
  })
}

function appendGeminiCliSessionArgs(
  args: string[],
  model: string = 'cli-default',
  approvalMode: string = 'default',
  sessionTrust: boolean = false,
  resumeSessionId?: string | null,
  checkpointingEnabled: boolean = false,
  worktree: GeminiWorktreeLaunchOption = null
): string | null {
  args.push('--sandbox', '--approval-mode', approvalMode)

  if (checkpointingEnabled) {
    args.push('--checkpointing')
  }

  if (model && model !== 'cli-default') {
    if (/^[a-zA-Z0-9.\-_]+$/.test(model)) {
      args.push('--model', model)
    } else {
      return 'Invalid model string provided. Execution blocked.'
    }
  }

  if (sessionTrust) {
    args.push('--skip-trust')
  }

  if (typeof resumeSessionId === 'string' && resumeSessionId.trim()) {
    const resumeTarget = normalizeGeminiResumeTarget(resumeSessionId)
    if (!resumeTarget) {
      return 'Invalid Gemini resume session id provided. Execution blocked.'
    }
    args.push('--resume', resumeTarget)
  }

  const worktreeError = appendGeminiCliWorktreeArgs(args, worktree)
  if (worktreeError) {
    return worktreeError
  }

  return null
}

type GeminiCommandDiscoveryRecord = {
  command: string
  label: string
  description?: string
  scope: 'workspace' | 'global'
  sourcePath: string
}

type GeminiMemoryDiscoveryRecord = {
  id: string
  scope: 'workspace' | 'global'
  path: string
  displayPath: string
  content?: string
  sizeBytes?: number
  error?: string
}

async function geminiDiscoveryFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readTextFileForGeminiDiscovery(filePath: string): Promise<{ content?: string; sizeBytes?: number; error?: string }> {
  try {
    const fileStat = await fs.stat(filePath)
    if (!fileStat.isFile()) {
      return { error: 'Not a file.' }
    }
    if (fileStat.size > MAX_EDITOR_FILE_BYTES) {
      return { sizeBytes: fileStat.size, error: 'File is too large to inspect.' }
    }

    const buffer = await fs.readFile(filePath)
    assertTextBuffer(buffer)
    return {
      content: buffer.toString('utf8'),
      sizeBytes: fileStat.size
    }
  } catch (error) {
    return { error: String(error) }
  }
}

function parseGeminiCommandMetadata(content: string): { command?: string; description?: string } {
  const commandMatch = content.match(/^\s*(?:command|name)\s*=\s*["']([^"']+)["']/m)
  const descriptionMatch = content.match(/^\s*description\s*=\s*["']([^"']+)["']/m)
  const headingMatch = content.match(/^\s*#\s+(.+)$/m)

  return {
    command: commandMatch?.[1]?.trim(),
    description: descriptionMatch?.[1]?.trim() || headingMatch?.[1]?.trim()
  }
}

function inferGeminiCommandName(scope: 'workspace' | 'global', relativeFilePath: string): string {
  const normalized = relativeFilePath.replace(/\\/g, '/')
  const ext = extname(normalized)
  const withoutExt = ext ? normalized.slice(0, -ext.length) : normalized
  const namespace = withoutExt
    .split('/')
    .map((segment) => segment.trim().replace(/\s+/g, '-'))
    .filter(Boolean)
    .join(':')
  const prefix = scope === 'global' ? 'user' : 'project'
  return `/${prefix}:${namespace}`
}

async function discoverGeminiCommandDir(
  rootPath: string,
  displayRoot: string,
  scope: 'workspace' | 'global'
): Promise<GeminiCommandDiscoveryRecord[]> {
  const commands: GeminiCommandDiscoveryRecord[] = []
  if (!(await geminiDiscoveryFileExists(rootPath))) {
    return commands
  }

  async function walk(dirPath: string, depth: number): Promise<void> {
    if (commands.length >= MAX_GEMINI_DISCOVERY_FILES || depth > MAX_GEMINI_DISCOVERY_DEPTH) {
      return
    }

    let entries
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true })
    } catch {
      return
    }

    entries.sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of entries) {
      if (commands.length >= MAX_GEMINI_DISCOVERY_FILES) {
        break
      }
      if (entry.name.startsWith('.')) {
        continue
      }

      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1)
        continue
      }
      if (!entry.isFile() || !/\.(toml|md|markdown)$/i.test(entry.name)) {
        continue
      }

      const relPath = relative(rootPath, fullPath).replace(/\\/g, '/')
      const readResult = await readTextFileForGeminiDiscovery(fullPath)
      const metadata = parseGeminiCommandMetadata(readResult.content || '')
      const command = metadata.command
        ? metadata.command.startsWith('/') ? metadata.command : `/${metadata.command}`
        : inferGeminiCommandName(scope, relPath)

      commands.push({
        command,
        label: command,
        description: metadata.description || `Custom ${scope} command discovered from ${displayRoot}.`,
        scope,
        sourcePath: `${displayRoot}/${relPath}`
      })
    }
  }

  await walk(rootPath, 0)
  return commands
}

async function discoverGeminiCommands(workspace: string): Promise<GeminiCommandDiscoveryRecord[]> {
  const workspaceRoot = resolve(workspace)
  const homeRoot = os.homedir()
  const discovered = [
    ...(await discoverGeminiCommandDir(join(workspaceRoot, '.gemini', 'commands'), '.gemini/commands', 'workspace')),
    ...(await discoverGeminiCommandDir(join(homeRoot, '.gemini', 'commands'), '~/.gemini/commands', 'global'))
  ]
  const seen = new Set<string>()

  return discovered.filter((item) => {
    const key = item.command.toLowerCase()
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

async function discoverGeminiMemory(workspace: string): Promise<GeminiMemoryDiscoveryRecord[]> {
  const workspaceRoot = resolve(workspace)
  const homeRoot = os.homedir()
  const records: GeminiMemoryDiscoveryRecord[] = []
  const seen = new Set<string>()

  const addMemoryFile = async (filePath: string, scope: 'workspace' | 'global', displayPath: string): Promise<void> => {
    if (records.length >= MAX_GEMINI_MEMORY_FILES) {
      return
    }
    const resolvedPath = resolve(filePath)
    if (seen.has(resolvedPath) || !(await geminiDiscoveryFileExists(resolvedPath))) {
      return
    }
    seen.add(resolvedPath)

    const readResult = await readTextFileForGeminiDiscovery(resolvedPath)
    records.push({
      id: `${scope}:${displayPath}`,
      scope,
      path: resolvedPath,
      displayPath,
      ...readResult
    })
  }

  await addMemoryFile(join(homeRoot, '.gemini', 'GEMINI.md'), 'global', '~/.gemini/GEMINI.md')
  await addMemoryFile(join(workspaceRoot, 'GEMINI.md'), 'workspace', 'GEMINI.md')
  await addMemoryFile(join(workspaceRoot, '.gemini', 'GEMINI.md'), 'workspace', '.gemini/GEMINI.md')

  async function walk(dirPath: string, depth: number): Promise<void> {
    if (records.length >= MAX_GEMINI_MEMORY_FILES || depth > MAX_EDITOR_DEPTH) {
      return
    }

    let entries
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (records.length >= MAX_GEMINI_MEMORY_FILES) {
        break
      }
      if (entry.name.startsWith('.') && entry.name !== '.gemini') {
        continue
      }
      if (entry.isDirectory() && SKIP_EDITOR_DIRS.has(entry.name)) {
        continue
      }

      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1)
      } else if (entry.isFile() && entry.name.toLowerCase() === 'gemini.md') {
        await addMemoryFile(fullPath, 'workspace', toWorkspaceRelativePath(workspaceRoot, fullPath))
      }
    }
  }

  await walk(workspaceRoot, 0)
  return records
}

const applyNativeGlassToWindow = (targetWindow: BrowserWindow, settings: AppSettings): void => {
  const isMac = process.platform === 'darwin'
  const useNativeGlass = isMac && settings.appearanceMode === 'native_glass' && !settings.reduceTransparency
  if (useNativeGlass) {
    targetWindow.setVibrancy(NATIVE_GLASS_VIBRANCY)
    targetWindow.setBackgroundColor('#00000000')
  } else {
    targetWindow.setVibrancy(null)
    targetWindow.setBackgroundColor('#1e1e1e')
  }
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const settings = AppStore.getSettings()
  const useNativeGlass = isMac && settings.appearanceMode === 'native_glass' && !settings.reduceTransparency
  const nativeVibrancy = resolveNativeVibrancy(useNativeGlass)

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    vibrancy: nativeVibrancy,
    backgroundMaterial: (!isMac && settings.appearanceMode === 'native_glass' && !settings.reduceTransparency) ? 'acrylic' : undefined,
    visualEffectState: 'active',
    transparent: false,
    backgroundColor: useNativeGlass ? '#00000000' : '#1e1e1e',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    emitDueScheduledTasks()
  })
  mainWindow.on('focus', () => {
    if (mainWindow) {
      applyNativeGlassToWindow(mainWindow, AppStore.getSettings())
    }
  })
  mainWindow.on('blur', () => {
    if (mainWindow) {
      applyNativeGlassToWindow(mainWindow, AppStore.getSettings())
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (isGeminiMcpBridgeProcess) {
  startGeminiMcpBridgeProcess()
} else {
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')
  AppStore.recoverInterruptedRunQueueJobs()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Settings
  ipcMain.handle('get-settings', () => AppStore.getSettings())
  ipcMain.handle('update-settings', (_, partial: Partial<AppSettings>) => AppStore.updateSettings(partial))

  // Workspaces
  ipcMain.handle('get-workspaces', () => AppStore.getWorkspaces())
  ipcMain.handle('add-or-update-workspace', (_, path: string, partial: Partial<WorkspaceRecord>) => AppStore.addOrUpdateWorkspace(path, partial))
  ipcMain.handle('remove-workspace', (_, id: string) => AppStore.removeWorkspace(id))
  ipcMain.handle('clear-workspaces', () => AppStore.clearWorkspaces())

  // Chats
  ipcMain.handle('get-chats', (_, workspaceId?: string) => AppStore.getChats(workspaceId))
  ipcMain.handle('get-chat', (_, chatId: string) => AppStore.getChat(chatId))
  ipcMain.handle('create-chat', (_, workspaceId: string, workspacePath: string) => AppStore.createChat(workspaceId, workspacePath))
  ipcMain.handle('save-chat', (_, chat: ChatRecord) => AppStore.saveChat(chat))
  ipcMain.handle('delete-chat', (_, chatId: string) => AppStore.deleteChat(chatId))
  ipcMain.handle('clear-chats', (_, workspaceId?: string) => AppStore.clearChats(workspaceId))
  
  // Usage
  ipcMain.handle('record-usage', (_, usage: any) => AppStore.recordUsage(usage))
  ipcMain.handle('get-usage', (_, workspaceId?: string, chatId?: string) => AppStore.getUsage(workspaceId, chatId))

  // Scheduled tasks
  ipcMain.handle('get-scheduled-tasks', (_, workspaceId?: string) => AppStore.getScheduledTasks(workspaceId))
  ipcMain.handle('save-scheduled-task', (_, task: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'status'> & Partial<Pick<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'status'>>) => {
    const saved = AppStore.saveScheduledTask(task)
    mainWindow?.webContents.send('scheduled-tasks-changed', AppStore.getScheduledTasks())
    scheduleNextTaskTimer()
    emitDueScheduledTasks()
    return saved
  })
  ipcMain.handle('update-scheduled-task', (_, id: string, partial: Partial<ScheduledTask>) => {
    const updated = AppStore.updateScheduledTask(id, partial)
    mainWindow?.webContents.send('scheduled-tasks-changed', AppStore.getScheduledTasks())
    scheduleNextTaskTimer()
    return updated
  })
  ipcMain.handle('delete-scheduled-task', (_, id: string) => {
    AppStore.deleteScheduledTask(id)
    mainWindow?.webContents.send('scheduled-tasks-changed', AppStore.getScheduledTasks())
    scheduleNextTaskTimer()
  })

  // Durable run queue
  ipcMain.handle('get-run-queue-jobs', (_, filter?: RunQueueJobFilter) => AppStore.getRunQueueJobs(filter || {}))
  ipcMain.handle('save-run-queue-job', (_, job: any) => {
    const saved = AppStore.saveRunQueueJob(job)
    emitRunQueueChanged()
    return saved
  })
  ipcMain.handle('update-run-queue-job', (_, runIdOrId: string, partial: Partial<RunQueueJob>) => {
    const updated = AppStore.updateRunQueueJob(runIdOrId, partial)
    emitRunQueueChanged()
    return updated
  })
  ipcMain.handle('delete-run-queue-job', (_, runIdOrId: string) => {
    AppStore.deleteRunQueueJob(runIdOrId)
    emitRunQueueChanged()
  })

  ipcMain.handle('set-appearance-mode', (_, payload: { mode?: string; reduceTransparency?: boolean } | string) => {
    const isMac = process.platform === 'darwin'
    if (isMac && mainWindow) {
      const settings = AppStore.getSettings()
      const requestMode = typeof payload === 'string' ? payload : payload?.mode
      const requestReduce =
        typeof payload === 'string'
          ? settings.reduceTransparency
          : payload?.reduceTransparency ?? settings.reduceTransparency
      const nextMode: AppearanceMode = isAppearanceMode(requestMode) ? requestMode : settings.appearanceMode || 'soft_glass'
      applyNativeGlassToWindow(mainWindow, {
        ...settings,
        appearanceMode: nextMode,
        reduceTransparency: requestReduce
      })
    }
    return true
  })

  ipcMain.handle('get-host-weather', async () => getCachedHostWeather())

  ipcMain.handle('get-file-icon', async (_, requestedPath: string) => {
    if (typeof requestedPath !== 'string') {
      return null
    }

    const normalizedPath = requestedPath.trim()
    if (!normalizedPath) {
      return null
    }

    if (FILE_ICON_CACHE.has(normalizedPath)) {
      return FILE_ICON_CACHE.get(normalizedPath) ?? null
    }

    try {
      const icon = await app.getFileIcon(normalizedPath, { size: 'small' })
      const dataUrl = icon.toDataURL()
      FILE_ICON_CACHE.set(normalizedPath, dataUrl)
      return dataUrl
    } catch {
      FILE_ICON_CACHE.set(normalizedPath, null)
      return null
    }
  })

  // Gemini Version
  ipcMain.handle('get-gemini-version', async () => {
    const resolved = await resolveCliProviderBinary('gemini')
    if (!resolved.binaryPath) return 'unknown'
    const geminiBinaryPath = resolved.binaryPath

    return new Promise((resolve) => {
      const proc: ChildProcess = spawn(geminiBinaryPath, ['--version'], {
        shell: false,
        env: createCliEnv({ FORCE_COLOR: '0', NO_COLOR: '1' }, geminiBinaryPath)
      })
      let stdout = ''
      let stderr = ''
      proc.stdout?.on('data', (data) => { stdout += data.toString() })
      proc.stderr?.on('data', (data) => { stderr += data.toString() })
      proc.on('close', (code) => {
        if (code !== 0 || !stdout.trim()) resolve('unknown')
        else resolve(stdout.trim())
      })
      proc.on('error', () => {
        resolve('unknown')
      })
    })
  })

  ipcMain.handle('get-gemini-capabilities', async (_, workspace?: string): Promise<GeminiCapabilitiesState> => {
    const capabilityWorkspace = await resolveCapabilityWorkspace(workspace)
    const capabilitySections = await Promise.all(
      GEMINI_CAPABILITY_KINDS.map((kind) => readGeminiCapabilitySection(kind, capabilityWorkspace))
    )

    return {
      refreshedAt: new Date().toISOString(),
      workspace: capabilityWorkspace,
      sections: capabilitySections.reduce((acc, section) => {
        acc[section.kind] = section
        return acc
      }, {} as Record<GeminiCapabilityKind, GeminiCapabilitySection>)
    }
  })

  ipcMain.handle('get-gemini-mcp-bridge-status', async () => getGeminiMcpBridgeStatus())
  ipcMain.handle('install-gemini-mcp-bridge', async () => installGeminiMcpBridge())
  ipcMain.handle('set-gemini-mcp-bridge-enabled', async (_, enabled: boolean) => setGeminiMcpBridgeEnabled(Boolean(enabled)))
  ipcMain.handle('run-approved-host-command', async (_, requestId: string) => runApprovedHostCommand(requestId))

  ipcMain.handle('list-gemini-sessions', async () => listGeminiSessions())

  // IPC Handlers
  ipcMain.handle('select-workspace', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const path = result.filePaths[0]
    return AppStore.addOrUpdateWorkspace(path)
  })

  ipcMain.handle('select-image-files', async () => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select attachments',
      properties: ['openFile', 'multiSelections']
    })

    if (result.canceled) {
      return []
    }
    return result.filePaths || []
  })

  ipcMain.handle('select-external-path-grant', async (_, access: 'read' | 'write' = 'read') => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: access === 'write'
        ? 'Select file or folder Codex can edit'
        : 'Select file or folder Codex can view',
      properties: ['openFile', 'openDirectory', 'createDirectory'],
      securityScopedBookmarks: process.platform === 'darwin'
    } as Electron.OpenDialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const selectedPath = resolve(result.filePaths[0])
    let kind: ExternalPathGrant['kind'] = 'file'
    try {
      const stat = await fs.stat(selectedPath)
      kind = stat.isDirectory() ? 'directory' : 'file'
    } catch {
      kind = 'file'
    }

    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      provider: 'codex',
      path: selectedPath,
      kind,
      access: access === 'write' ? 'write' : 'read',
      duration: 'thisThread',
      securityScopedBookmark: Array.isArray((result as any).bookmarks) ? (result as any).bookmarks[0] : undefined,
      createdAt: new Date().toISOString()
    } satisfies ExternalPathGrant
  })

  ipcMain.handle('list-workspace-files', async (_, workspace: string): Promise<WorkspaceFileEntry[]> => {
    return listWorkspaceFileEntries(workspace)
  })

  ipcMain.handle('read-workspace-file', async (_, workspace: string, filePath: string): Promise<WorkspaceFileReadResult> => {
    const targetPath = resolveWorkspaceChild(workspace, filePath)
    const fileStat = await fs.stat(targetPath)
    if (!fileStat.isFile()) {
      throw new Error('Selected item is not a file.')
    }
    if (fileStat.size > MAX_EDITOR_FILE_BYTES) {
      throw new Error('File is too large for the basic editor.')
    }

    const buffer = await fs.readFile(targetPath)
    assertTextBuffer(buffer)

    return {
      path: toWorkspaceRelativePath(workspace, targetPath),
      content: buffer.toString('utf8'),
      sizeBytes: fileStat.size
    }
  })

  ipcMain.handle('discover-gemini-commands', async (_, workspace: string): Promise<GeminiCommandDiscoveryRecord[]> => {
    return discoverGeminiCommands(workspace)
  })

  ipcMain.handle('discover-gemini-memory', async (_, workspace: string): Promise<GeminiMemoryDiscoveryRecord[]> => {
    return discoverGeminiMemory(workspace)
  })

  ipcMain.handle('write-workspace-file', async (_, workspace: string, filePath: string, content: string): Promise<WorkspaceFileReadResult> => {
    const targetPath = resolveWorkspaceChild(workspace, filePath)
    await fs.mkdir(dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, content, 'utf8')
    const fileStat = await fs.stat(targetPath)

    return {
      path: toWorkspaceRelativePath(workspace, targetPath),
      content,
      sizeBytes: fileStat.size
    }
  })

  ipcMain.handle('get-agent-status', async (_, provider: ProviderId) => {
    return getAgentStatusSnapshot(provider)
  })

  ipcMain.handle('get-agent-rate-limits', async (_, provider: ProviderId) => {
    if (provider !== 'codex') {
      return null
    }
    const client = getCodexClient()
    await client.ensureStarted(app.getVersion())
    return client.request('account/rateLimits/read', {}, 15_000)
  })

  ipcMain.handle('import-codex-usage-credential', async (event, filePath?: string | null) => {
    return importCodexUsageCredential(event, filePath)
  })

  ipcMain.handle('clear-codex-usage-credential', async () => {
    clearCodexUsageCredential()
    return true
  })

  ipcMain.handle('get-codex-usage-snapshot', async () => {
    return fetchCodexUsageSnapshot()
  })

  ipcMain.handle('get-agent-mcp-status', async (_, provider: ProviderId) => {
    return getAgentMcpStatusSnapshot(provider)
  })

  ipcMain.handle('get-provider-capabilities', async (_, provider: ProviderId, workspacePath?: string, approvalMode?: string) => {
    return getProviderCapabilityContract(provider, workspacePath, approvalMode)
  })

  ipcMain.handle('list-agent-threads', async (_, provider: ProviderId, params: any = {}) => {
    if (provider !== 'codex') {
      return { data: [], nextCursor: null }
    }
    const client = getCodexClient()
    await client.ensureStarted(app.getVersion())
    return client.request('thread/list', {
      limit: params.limit || 40,
      cursor: params.cursor || null,
      cwd: params.cwd || null,
      archived: Boolean(params.archived),
      searchTerm: params.searchTerm || null,
      sortKey: params.sortKey || 'updated_at',
      sortDirection: params.sortDirection || 'desc'
    }, 20_000)
  })

  ipcMain.handle('fork-agent-thread', async (_, provider: ProviderId, threadId: string, params: any = {}) => {
    if (provider !== 'codex') {
      throw new Error(`Thread fork is not available for ${providerDisplayName(provider)} in this version.`)
    }
    const client = getCodexClient()
    await client.ensureStarted(app.getVersion())
    return client.request('thread/fork', {
      threadId,
      excludeTurns: Boolean(params.excludeTurns),
      persistExtendedHistory: true,
      ...(params.cwd ? { cwd: params.cwd } : {}),
      ...(params.model ? { model: params.model } : {})
    }, 30_000)
  })

  ipcMain.handle('rollback-agent-thread', async (_, provider: ProviderId, threadId: string, numTurns: number = 1) => {
    if (provider !== 'codex') {
      throw new Error(`Thread rollback is not available for ${providerDisplayName(provider)} in this version. File rollback still belongs to Diff Studio/git workflow.`)
    }
    const client = getCodexClient()
    await client.ensureStarted(app.getVersion())
    return client.request('thread/rollback', {
      threadId,
      numTurns: Math.max(1, Math.trunc(Number(numTurns) || 1))
    }, 30_000)
  })

  ipcMain.handle('start-agent-review', async (event, provider: ProviderId, threadId: string, params: any = {}) => {
    if (provider !== 'codex') {
      throw new Error(`Native review is not available for ${providerDisplayName(provider)} in this version.`)
    }
    if (!threadId || typeof threadId !== 'string') {
      throw new Error('Codex thread id is required for native review.')
    }
    const client = getCodexClient()
    await client.ensureStarted(app.getVersion())
    const model = normalizeCodexModel(params?.model)
    const route = routeWithRunId('codex', params)
    const reviewState = createCodexRunState(event.sender, threadId, model, params?.cwd, route)
    registerRunSession('codex', event.sender, reviewState, params?.cwd, reviewState, threadId)
    setActiveCodexRunState(reviewState)
    sendAgentCompatLine(event.sender, 'codex', {
      type: 'init',
      provider: 'codex',
      model,
      providerThreadId: threadId,
      message: 'Starting native Codex review.'
    }, reviewState)
    try {
      const result = await client.request('review/start', {
        threadId,
        target: params.target || { type: 'uncommittedChanges' },
        delivery: params.delivery || 'inline',
        model
      }, 30_000)
      const turnId = result?.turn?.id || result?.turnId || result?.review?.id
      if (turnId) {
        reviewState.turnId = turnId
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendAgentCompatError(reviewState.sender, 'codex', message, reviewState)
      sendAgentCompatExit(reviewState.sender, 'codex', 1, reviewState)
      runManager.finish(reviewState.appRunId, 'failed')
      if (activeCodexRunState === reviewState) setActiveCodexRunState(getCodexStateFromSession(runManager.getLatestByProvider('codex')))
      throw error
    }
  })

  ipcMain.handle('get-agent-models', async (_, provider: ProviderId) => {
    if (provider !== 'codex') {
      return getStaticProviderModels(provider)
    }

    try {
      const client = getCodexClient()
      await client.ensureStarted(app.getVersion())
      const response: any = await client.request('model/list', {}, 15_000)
      const models = Array.isArray(response?.data) ? response.data : []
      const normalized = models
        .filter((model: any) => model && typeof model.id === 'string' && !model.hidden)
        .map((model: any) => ({
          id: model.id,
          label: model.displayName || model.model || model.id,
          description: model.description,
          isDefault: Boolean(model.isDefault),
          supportedReasoningEfforts: model.supportedReasoningEfforts || [],
          defaultReasoningEffort: model.defaultReasoningEffort || null,
          additionalSpeedTiers: model.additionalSpeedTiers || []
        }))
      return normalized.length > 0 ? normalized : CODEX_STATIC_MODELS
    } catch {
      return CODEX_STATIC_MODELS
    }
  })

  ipcMain.handle('run-agent', async (event, payload: AgentRunPayload) => {
    if (!payload || payload.provider === 'gemini') {
      throw new Error('Generic runAgent routes non-Gemini providers. Use runGemini for Gemini compatibility runs.')
    }

    if (payload.provider === 'codex') {
      try {
        await runCodexAppServer(event, payload)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        runCodexExecFallback(event, payload, message)
      }
      return
    }

    if (payload.provider === 'claude') {
      await runClaudeProvider(event, payload)
      return
    }

    if (payload.provider === 'kimi') {
      await runKimiProvider(event, payload)
      return
    }
  })

  ipcMain.handle('cancel-agent-run', async (_, provider: ProviderId = 'gemini', runId?: string) => {
    const queuedJob = runId ? AppStore.getRunQueueJob(runId) : null
    if (queuedJob && (queuedJob.status === 'queued' || queuedJob.status === 'paused')) {
      AppStore.updateRunQueueJob(queuedJob.runId, {
        status: 'cancelled',
        statusReason: 'Cancelled before the queued run started.'
      })
      emitRunQueueChanged()
      return
    }
    const session = runManager.get(runId) || runManager.getLatestByProvider(provider)
    if (session) {
      session.abortController?.abort()
      session.process?.kill()
      runManager.finish(session.runId, 'cancelled')
      if (provider === 'codex') {
        const codexState = getCodexStateFromSession(session)
        if (codexState?.threadId && codexState.turnId && codexClient) {
          await codexClient.request('turn/interrupt', {
            threadId: codexState.threadId,
            turnId: codexState.turnId
          }, 10_000).catch(() => {})
        }
      }
      return
    }

    if (provider === 'claude' || provider === 'kimi') {
      const child = cliProviderProcesses.get(provider)
      if (child) {
        child.kill()
        cliProviderProcesses.delete(provider)
      }
      const controller = cliProviderAbortControllers.get(provider)
      if (controller) {
        controller.abort()
        cliProviderAbortControllers.delete(provider)
      }
      return
    }

    if (provider !== 'codex') {
      if (geminiProcess) {
        geminiProcess.kill()
        geminiProcess = null
        if (!geminiSessionProcess) {
          activeGeminiToolContext = null
        }
      }
      return
    }

    if (codexExecProcess) {
      codexExecProcess.kill()
      codexExecProcess = null
    }

    if (activeCodexRunState?.threadId && activeCodexRunState.turnId && codexClient) {
      await codexClient.request('turn/interrupt', {
        threadId: activeCodexRunState.threadId,
        turnId: activeCodexRunState.turnId
      }, 10_000).catch(() => {})
    }
  })

  ipcMain.handle('respond-agent-approval', async (_, requestId: string, action: AgentApprovalAction) => {
    const pendingGeminiTool = pendingGeminiToolApprovals.get(requestId)
    if (pendingGeminiTool) {
      pendingGeminiToolApprovals.delete(requestId)
      runManager.clearApproval(requestId)
      if (action === 'acceptForWorkspace') {
        upsertAgenticWorkspaceGrant(pendingGeminiTool.provider, pendingGeminiTool.workspacePath, pendingGeminiTool.service)
      }
      if (action === 'acceptForSession') {
        addAgenticSessionGrant(pendingGeminiTool.provider, pendingGeminiTool.workspacePath, pendingGeminiTool.service, pendingGeminiTool.runId)
      }
      pendingGeminiTool.resolve(action === 'accept' || action === 'acceptForSession' || action === 'acceptForWorkspace')
      return true
    }

    const pendingHostCommand = pendingHostCommandApprovals.get(requestId)
    if (pendingHostCommand) {
      runManager.clearApproval(requestId)
      if (action === 'accept') {
        return runApprovedHostCommand(requestId)
      }
      pendingHostCommandApprovals.delete(requestId)
      sendAgentCompatLine(pendingHostCommand.sender, 'codex', {
        type: 'tool_result',
        tool_id: `${requestId}-denied`,
        tool_name: 'run_shell_command',
        status: 'warning',
        output: `User ${action}ed host rerun of ${pendingHostCommand.commandText}.`,
        provider: 'codex'
      }, pendingHostCommand)
      return true
    }

    const pendingKimi = pendingKimiApprovals.get(requestId)
    if (pendingKimi) {
      pendingKimiApprovals.delete(requestId)
      runManager.clearApproval(requestId)
      const payload = pendingKimi.params?.payload || {}
      const response = action === 'acceptForSession' || action === 'acceptForWorkspace' ? 'approve_for_session' : action === 'accept' ? 'approve' : 'reject'
      respondToKimiWireRequest(pendingKimi.child, pendingKimi.rpcId, {
        request_id: payload.id || requestId,
        response,
        ...(response === 'reject' ? { feedback: `User ${action}ed Kimi approval request.` } : {})
      })
      if (action === 'cancel') {
        pendingKimi.child.kill()
        cliProviderProcesses.delete('kimi')
      }
      return true
    }

    const pending = pendingCodexApprovals.get(requestId)
    if (!pending || !codexClient) {
      return false
    }
    pendingCodexApprovals.delete(requestId)
    runManager.clearApproval(requestId)

    if (pending.method === 'item/permissions/requestApproval') {
      if (action === 'acceptForWorkspace' && pending.service) {
        upsertAgenticWorkspaceGrant('codex', pending.workspacePath, pending.service)
      }
      if (action === 'accept' || action === 'acceptForSession' || action === 'acceptForWorkspace') {
        codexClient.respond(pending.rpcId, {
          permissions: pending.params?.permissions || {},
          scope: action === 'accept' ? 'turn' : 'session'
        })
      } else {
        codexClient.reject(pending.rpcId, `User ${action}ed Codex permission request.`)
      }
      return true
    }

    if (pending.method === 'mcp/elicitation/request') {
      codexClient.respond(pending.rpcId, {
        action: action === 'acceptForSession' ? 'accept' : action,
        content: null,
        _meta: null
      })
      return true
    }

    if (pending.method === 'tool/requestUserInput') {
      if (action === 'accept' || action === 'acceptForSession') {
        codexClient.respond(pending.rpcId, { answers: {} })
      } else {
        codexClient.reject(pending.rpcId, `User ${action}ed Codex input request.`)
      }
      return true
    }

    codexClient.respond(pending.rpcId, { decision: action })
    return true
  })

  ipcMain.handle('run-gemini', async (
    event,
    workspace: string,
    prompt: string,
    model: string = 'cli-default',
    approvalMode: string = 'default',
    sessionTrust: boolean = false,
    imageAttachments: string[] = [],
    resumeSessionId?: string | null,
    worktree: GeminiWorktreeLaunchOption = null,
    runRoute: AgentRunRoute | null = null
  ) => {
    const route = routeWithRunId('gemini', runRoute)
    void emitProviderCapabilityWarnings(event.sender, 'gemini', workspace, approvalMode, route, {
      excludeIds: ['gemini-bridge-unavailable']
    })

    const args: string[] = []
    const settings = AppStore.getSettings()
    const effectiveApprovalMode = resolveGeminiApprovalModeForServices(approvalMode, settings)
    if (effectiveApprovalMode !== approvalMode) {
      sendAgentCompatError(event.sender, 'gemini', `Gemini approval mode changed from ${approvalMode} to ${effectiveApprovalMode} by AgentBench service settings.`, route)
    }
    const argsError = appendGeminiCliSessionArgs(args, model, effectiveApprovalMode, sessionTrust, resumeSessionId, settings.geminiCheckpointingEnabled, worktree)
    if (argsError) {
      sendAgentCompatError(event.sender, 'gemini', argsError, route)
      sendAgentCompatExit(event.sender, 'gemini', -1, route)
      return
    }

    const includeDirs = Array.from(
      imageAttachments.reduce((acc, attachmentPath) => {
        if (attachmentPath && typeof attachmentPath === 'string') {
          const normalized = attachmentPath.trim()
          if (!normalized) {
            return acc
          }

          const pathToInclude = isAbsolute(normalized) ? dirname(normalized) : dirname(join(workspace, normalized))
          if (pathToInclude) {
            acc.add(pathToInclude)
          }
        }
        return acc
      }, new Set<string>())
    )

    includeDirs.forEach((imageDir) => {
      args.push('--include-directories', imageDir)
    })

    args.push(
      '--prompt',
      prompt,
      '--output-format',
      'stream-json'
    )

    const resolved = await resolveCliProviderBinary('gemini')
    if (!resolved.binaryPath) {
      sendAgentCompatError(event.sender, 'gemini', resolved.error || 'Gemini CLI is not configured.', route)
      sendAgentCompatExit(event.sender, 'gemini', -1, route)
      return
    }

    await prepareGeminiMcpBridgeForRun(event.sender, workspace, 'gemini-output', route)

    const env = createCliEnv({
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      GEMINI_SANDBOX: 'true',
      AGENTBENCH_RUN_ID: route.appRunId || '',
      AGENTBENCH_CHAT_ID: route.appChatId || ''
    }, resolved.binaryPath)

    const child = spawn(resolved.binaryPath, args, {
      cwd: workspace,
      shell: false,
      env
    })
    geminiProcess = child
    runManager.attachProcess(route.appRunId!, child)

    child.stdout?.on('data', (data) => {
      event.sender.send('gemini-output', { provider: 'gemini', data: data.toString(), ...route })
    })

    child.stderr?.on('data', (data) => {
      event.sender.send('gemini-error', { provider: 'gemini', error: data.toString(), ...route })
    })

    child.on('close', (code) => {
      event.sender.send('gemini-exit', { provider: 'gemini', code, ...route })
      if (geminiProcess === child) {
        geminiProcess = null
      }
      runManager.finish(route.appRunId, code === 0 ? 'completed' : 'failed')
      if (!geminiSessionProcess) {
        const latestGemini = runManager.getLatestByProvider('gemini')?.state as GeminiToolContext | undefined
        activeGeminiToolContext = latestGemini?.workspacePath ? latestGemini : null
      }
    })

    child.on('error', (err) => {
      event.sender.send('gemini-error', { provider: 'gemini', error: `Failed to start process: ${err.message}`, ...route })
      event.sender.send('gemini-exit', { provider: 'gemini', code: -1, ...route })
      if (geminiProcess === child) {
        geminiProcess = null
      }
      runManager.finish(route.appRunId, 'failed')
      if (!geminiSessionProcess) {
        const latestGemini = runManager.getLatestByProvider('gemini')?.state as GeminiToolContext | undefined
        activeGeminiToolContext = latestGemini?.workspacePath ? latestGemini : null
      }
    })
  })

  ipcMain.handle('cancel-gemini', async (_, runId?: string) => {
    const queuedJob = runId ? AppStore.getRunQueueJob(runId) : null
    if (queuedJob && (queuedJob.status === 'queued' || queuedJob.status === 'paused')) {
      AppStore.updateRunQueueJob(queuedJob.runId, {
        status: 'cancelled',
        statusReason: 'Cancelled before the queued run started.'
      })
      emitRunQueueChanged()
      return
    }
    const session = runManager.get(runId) || runManager.getLatestByProvider('gemini')
    if (session?.process) {
      session.process.kill()
      runManager.finish(session.runId, 'cancelled')
      if (geminiProcess === session.process) {
        geminiProcess = null
      }
      if (!geminiSessionProcess) {
        const latestGemini = runManager.getLatestByProvider('gemini')?.state as GeminiToolContext | undefined
        activeGeminiToolContext = latestGemini?.workspacePath ? latestGemini : null
      }
      return
    }
    if (geminiProcess) {
      geminiProcess.kill()
      geminiProcess = null
      if (!geminiSessionProcess) {
        activeGeminiToolContext = null
      }
    }
  })

  ipcMain.handle('write-gemini-input', async (_, data: string) => {
    if (typeof data !== 'string' || !data.length) {
      return false
    }

    try {
      if (geminiSessionProcess) {
        geminiSessionProcess.write(data)
        return true
      }

      if (geminiProcess?.stdin && !geminiProcess.killed) {
        geminiProcess.stdin.write(data)
        return true
      }
    } catch {
      return false
    }

    return false
  })

  ipcMain.handle('start-gemini-session', async (
    event,
    workspace: string,
    model: string = 'cli-default',
    approvalMode: string = 'default',
    sessionTrust: boolean = false,
    cols: number = 80,
    rows: number = 24,
    resumeSessionId?: string | null,
    worktree: GeminiWorktreeLaunchOption = null
  ) => {
    if (geminiSessionProcess) {
      geminiSessionProcess.kill()
      geminiSessionProcess = null
    }

    const args: string[] = []
    const settings = AppStore.getSettings()
    const effectiveApprovalMode = resolveGeminiApprovalModeForServices(approvalMode, settings)
    if (effectiveApprovalMode !== approvalMode) {
      event.sender.send('gemini-session-data', `Gemini approval mode changed from ${approvalMode} to ${effectiveApprovalMode} by AgentBench service settings.\r\n`)
    }
    const argsError = appendGeminiCliSessionArgs(args, model, effectiveApprovalMode, sessionTrust, resumeSessionId, settings.geminiCheckpointingEnabled, worktree)
    if (argsError) {
      event.sender.send('gemini-session-data', `${argsError}\r\n`)
      event.sender.send('gemini-session-exit', -1)
      return
    }

    const resolved = await resolveCliProviderBinary('gemini')
    if (!resolved.binaryPath) {
      event.sender.send('gemini-session-data', `${resolved.error || 'Gemini CLI is not configured.'}\r\n`)
      event.sender.send('gemini-session-exit', -1)
      return
    }

    await prepareGeminiMcpBridgeForRun(event.sender, workspace, 'gemini-session-data')

    const env: Record<string, string> = createCliEnv({
      FORCE_COLOR: '1',
      GEMINI_SANDBOX: 'true'
    }, resolved.binaryPath)

    try {
      geminiSessionProcess = pty.spawn(resolved.binaryPath, args, {
        name: 'xterm-color',
        cols,
        rows,
        cwd: workspace,
        env
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      event.sender.send('gemini-session-data', `Failed to start Gemini session: ${message}\r\n`)
      event.sender.send('gemini-session-exit', -1)
      geminiSessionProcess = null
      return
    }

    geminiSessionProcess.onData((data) => {
      event.sender.send('gemini-session-data', data)
    })

    geminiSessionProcess.onExit((e) => {
      event.sender.send('gemini-session-exit', e.exitCode)
      geminiSessionProcess = null
      if (!geminiProcess) {
        activeGeminiToolContext = null
      }
    })
  })

  ipcMain.handle('stop-gemini-session', async () => {
    if (geminiSessionProcess) {
      geminiSessionProcess.kill()
      geminiSessionProcess = null
      if (!geminiProcess) {
        activeGeminiToolContext = null
      }
    }
  })

  ipcMain.handle('write-gemini-session', (_, data: string) => {
    if (geminiSessionProcess) {
      geminiSessionProcess.write(data)
    }
  })

  ipcMain.handle('resize-gemini-session', (_, cols: number, rows: number) => {
    if (geminiSessionProcess) {
      geminiSessionProcess.resize(cols, rows)
    }
  })

  ipcMain.handle('get-diff', async (_, workspace: string) => {
    return getWorkspaceDiff(workspace)
  })

  ipcMain.handle('capture-snapshot', async (_, workspace: string) => {
    return captureWorkspaceSnapshot(workspace)
  })

  ipcMain.handle('compute-run-diff', async (_, runId: string, preSnapshot: any, postSnapshot: any) => {
    return computeRunDiff(preSnapshot, postSnapshot, runId)
  })

  // Trust Status
  ipcMain.handle('check-trust', (_, workspacePath: string) => {
    return TrustStatusService.checkTrust(workspacePath)
  })

  // PTY for Trust Assistant
  let ptyProcess: pty.IPty | null = null

  ipcMain.handle('start-pty', (event, workspacePath: string) => {
    if (ptyProcess) {
      ptyProcess.kill()
      ptyProcess = null
    }
    
    const shellCommand = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash'

    ptyProcess = pty.spawn(shellCommand, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: workspacePath,
      env: process.env as Record<string, string>
    })

    ptyProcess.onData((data) => {
      event.sender.send('pty-data', data)
    })

    ptyProcess.onExit((e) => {
      event.sender.send('pty-exit', e.exitCode)
      ptyProcess = null
    })
  })

  ipcMain.handle('pty-write', (_, data: string) => {
    if (ptyProcess) {
      ptyProcess.write(data)
    }
  })

  ipcMain.handle('pty-resize', (_, cols: number, rows: number) => {
    if (ptyProcess) {
      ptyProcess.resize(cols, rows)
    }
  })

  void startGeminiMcpBroker().catch((error) => {
    console.error('Failed to start Gemini MCP broker', error)
  })

  createWindow()
  scheduleNextTaskTimer()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (geminiSessionProcess) {
    geminiSessionProcess.kill()
    geminiSessionProcess = null
  }
  if (geminiProcess) {
    geminiProcess.kill()
    geminiProcess = null
  }
  activeGeminiToolContext = null
  if (codexExecProcess) {
    codexExecProcess.kill()
    codexExecProcess = null
  }
  if (codexClient) {
    codexClient.dispose()
    codexClient = null
  }
  if (geminiMcpBroker) {
    geminiMcpBroker.close()
    geminiMcpBroker = null
  }

  if (process.platform !== 'darwin') {
    app.quit()
  }
})
}
