import { app, shell, BrowserWindow, ipcMain, dialog, safeStorage, screen, powerMonitor } from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import { delimiter, dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { spawn, ChildProcess } from 'child_process'
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { promises as fs } from 'fs'
import * as fsSync from 'fs'
import { createConnection, createServer, Socket, Server as NetServer } from 'net'
import * as pty from 'node-pty'
import os from 'os'
import icon from '../../resources/icon.png?asset'
import { CodexAppServerClient } from './CodexAppServerClient'
import { BridgeDaemonClient } from './BridgeDaemonClient'
import { BridgeActionRouter } from './BridgeActionRouter'
import { RemoteWorkspaceAllowlist } from './RemoteWorkspaceAllowlist'
import { createBridgeApnsPusher, type BridgeApnsPusher } from './BridgeApnsPusher'
import { BridgeApnsTokenStore } from './BridgeApnsTokenStore'
import { isUserAtDesktop as pureIsUserAtDesktop } from './ApnsIdleGate'
import {
  ApprovalTimeoutScheduler,
  DEFAULT_APPROVAL_TIMEOUT_POLICY,
  type ApprovalTimeoutReason
} from './ApprovalTimeoutScheduler'
import { detectTailscale } from './TailscaleDetector'
import { UpdateService, type UpdateStateSnapshot } from './UpdateService'
import { AuditService } from './services/AuditService'
import { ApprovalService, handleApprovalTimeout } from './services/ApprovalService'
import { ChatService } from './services/ChatService'
import { ComposerService, type ComposerInput } from './services/ComposerService'
import { RunCoordinator } from './services/RunCoordinator'
import { RunQueueService } from './services/RunQueueService'
import { SettingsService } from './services/SettingsService'
import { WorkspaceService } from './services/WorkspaceService'
import { MainProcessActionExecutor } from './BridgeActionExecutor'
import { makeBridgeRunEventSink } from './BridgeRunEventSink'
import { runEventBus, makeElectronIpcSink, makeDebugLoggerSink, type RunEventChannel } from './RunEventBus'
import { AppStore } from './store'
import { AppSettings, WorkspaceRecord, ChatRecord, ChatMessage, ChatScope, AppearanceMode, WorkspaceFileEntry, WorkspaceFileReadResult, GeminiSessionListResult, GeminiSessionSummary, GeminiWorktreeLaunchOption, ProviderId, ExternalPathGrant, ScheduledTask, AgenticServiceId, GeminiMcpBridgeStatus, ProviderCapabilityContract, RunQueueJob, RunQueueJobFilter, RunQueueJobStatus, RunEventInput, AgentApprovalAction, ApprovalLedgerFilter, ApprovalLedgerRequestInput, ProviderAdapterDescriptor, RunRecoveryFilter, RunRecoveryRecord, WorkspaceChangeFilter, WorkspaceRunChangeInput, ProductCrashFilter, ProductCrashInput, ProductDiagnosticsExportResult, ProductOperationsStatus, RuntimeProfile, HandoffCard, HandoffCardFilter } from './store/types'
import { TrustStatusService } from './TrustStatusService'
import { getWorkspaceDiff, captureWorkspaceSnapshot, computeRunDiff } from './DiffService'
import { isCodexSandboxToolingFailure, isSwiftPmNestedSandboxFailure } from './SandboxFallback'
import { isPathInsideWorkspace } from './AgenticPolicy'
import { RunManager } from './RunManager'
import { decideKimiWireClose } from './KimiWireExitDecision'
import { RunRepository } from './RunRepository'
import { PermissionService } from './PermissionService'
import { ProviderPreflightService } from './ProviderPreflightService'
import { buildProviderCapabilityContract } from './ProviderCapabilities'
import { createProviderAdapterRegistry, defaultProviderDescriptor, providerLabel } from './ProviderAdapters'
import { buildDiagnosticsSnapshot, buildProductOperationsStatus, serializeDiagnosticsSnapshot } from './ProductOperations'
import { installIpcValidation } from './IpcValidation'
import { resolveGeminiCliResumePolicy } from './GeminiSessionPolicy'
import { detectCrossProviderDelegationMisuse, crossProviderDelegationWarningMessage } from './CrossProviderDelegationDetector'
import { buildClaudeCliArgs } from './ClaudeCliArgs'

let mainWindow: BrowserWindow | null = null
let geminiProcess: ChildProcess | null = null
let geminiSessionProcess: pty.IPty | null = null
let codexClient: CodexAppServerClient | null = null
let codexExecProcess: ChildProcess | null = null
let scheduledTaskTimer: ReturnType<typeof setTimeout> | null = null
let geminiMcpBroker: NetServer | null = null
let geminiMcpBridgeRepairPromise: Promise<GeminiMcpBridgeStatus> | null = null
let activeGeminiToolContext: GeminiToolContext | null = null
const NATIVE_GLASS_VIBRANCY: BrowserWindowConstructorOptions['vibrancy'] = 'sidebar'
let appliedNativeGlassState: string | null = null
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
const GEMINI_CAPABILITY_KINDS = ['mcp', 'extensions', 'skills', 'agents'] as const
const GEMINI_CAPABILITY_COMMANDS = {
  mcp: ['mcp', 'list'],
  extensions: ['extensions', 'list'],
  skills: ['skills', 'list'],
  agents: ['agents', 'list']
} as const
const GEMINI_CAPABILITY_TIMEOUT_MS = 8_000
const MAX_CAPABILITY_OUTPUT_CHARS = 200_000
const MAX_SCHEDULE_TIMER_DELAY_MS = 2_147_000_000
const GEMINI_MCP_SERVER_NAME = 'agentbench'
const GEMINI_MCP_BRIDGE_ARG = '--agentbench-gemini-mcp-bridge'
const GEMINI_MCP_SOCKET_ARG = '--socket'
const GEMINI_MCP_TOKEN_ARG = '--token'
const isGeminiMcpBridgeProcess = process.argv.includes(GEMINI_MCP_BRIDGE_ARG)
const AGENTBENCH_MCP_TOOLS = ['run_shell_command', 'write_file', 'replace', 'read_file', 'list_directory', 'delegate_to_subthread'] as const
type AGBenchMcpToolName = typeof AGENTBENCH_MCP_TOOLS[number]
type GeminiMcpRegistrationScope = 'user' | 'project'
const GEMINI_MCP_ALLOWED_TOOL_NAMES = [
  ...AGENTBENCH_MCP_TOOLS,
  ...AGENTBENCH_MCP_TOOLS.map((tool) => `${GEMINI_MCP_SERVER_NAME}__${tool}`)
]
const externalGrantSigningSecret = loadOrCreateExternalGrantSigningSecret()
const geminiMcpBrokerToken = randomBytes(32).toString('hex')
let geminiMcpBridgeInstalledForCurrentToken = false

// Late-bound APNs handles. Constructed inside `app.whenReady()` (because
// the token store needs `app.getPath('userData')`). Kept at module scope
// so the ApprovalService can read them via the `getApnsPusher` /
// `getApnsTokenStore` deps it's constructed with.
let bridgeApnsTokenStoreRef: BridgeApnsTokenStore | null = null
let bridgeApnsPusherRef: BridgeApnsPusher | null = null

// Phase B3: late-bound ApprovalService. Owns the five pending-approval
// registries + the scheduled-timeout integration + the APNs wake-push
// fan-out. Stays null until whenReady constructs it; the module-level
// `scheduleApprovalTimeout` / `notifyPairedDevicesOfApproval` /
// `workspaceIdForApprovalPush` helpers are thin proxies that no-op
// until the service is ready.
let approvalService: ApprovalService | null = null

// Phase F3: late-bound RunCoordinator ref. The coordinator is
// constructed in whenReady (it needs the in-scope `providerAdapters`
// + the inline helper functions for normalize / preflight / etc.),
// but exposed at module scope so the agent-driven sub-thread
// delegation path (MCP tool `delegate_to_subthread`, executed from
// the top-level `executeGeminiMcpTool`) can fire-and-forget a run on
// the newly-created sub-thread without going through the renderer.
// Stays null until whenReady; the consumer null-checks.
let runCoordinatorRef: RunCoordinator | null = null

/**
 * Phase B3 — thin proxy. Delegates to `approvalService.scheduleTimeout`
 * once the service is initialized. Kept at module scope so the
 * existing `pending*Approvals.set` call sites (which currently live
 * scattered through `runXxxProvider` functions) can call into the
 * service without changing every site to pass the service explicitly.
 */
function scheduleApprovalTimeout(args: {
  approvalId: string
  provider: ProviderId
  route?: AgentRunRoute | null
  isMainAuthority?: boolean
  kind?: string
}): void {
  approvalService?.scheduleTimeout(args)
}

/**
 * Live wrapper around `isUserAtDesktop` (pure logic in
 * `./ApnsIdleGate.ts`). Reads window-focus + system-idle from the
 * Electron runtime; the pure helper handles the env-var gating and
 * threshold logic. Fail-open: any throw returns false so an approval
 * push always goes out when in doubt.
 */
function userIsAtDesktop(): boolean {
  try {
    return pureIsUserAtDesktop({
      idleGateEnv: process.env.AGBENCH_APNS_IDLE_GATE,
      idleThresholdEnv: process.env.AGBENCH_APNS_IDLE_THRESHOLD_S,
      windowFocused: mainWindow?.isFocused?.() === true,
      idleSec: typeof powerMonitor?.getSystemIdleTime === 'function'
        ? powerMonitor.getSystemIdleTime()
        : 0
    })
  } catch {
    return false
  }
}

/**
 * Notify all paired iOS devices that an approval needs the user's
 * decision. Best-effort: fires per-device pushes via APNs in parallel,
 * doesn't block the caller, and silently no-ops when APNs is
 * un-configured (the factory returns `NoopApnsPusher` which doesn't
 * expose `pushApprovalToToken`).
 *
 * Token cleanup: when Apple replies with `Unregistered` /
 * `BadDeviceToken`, the device token is permanently invalid; we prune
 * it from `BridgeApnsTokenStore` so subsequent approvals don't waste a
 * request on a dead phone.
 *
 * Call sites: every place a `pendingXxxApprovals.set(approvalId, ...)`
 * happens — host commands, Codex permissions/elicitation/userInput,
 * Gemini tool prompts, Kimi prompts, main approval flow.
 */
/** Phase B3 — thin proxy. Delegates to `approvalService.notifyPairedDevices`
 * once the service is initialized; no-op until then. */
function notifyPairedDevicesOfApproval(args: {
  approvalId: string
  workspaceId: string
  threadId: string
  summary: string
}): void {
  approvalService?.notifyPairedDevices(args)
}

/**
 * Resolve a workspace path to its store-managed `WorkspaceRecord.id`,
 * falling back to a stable derivation (the canonical path itself) when
 * the workspace isn't registered. The iOS app uses the id for routing,
 * but a push notification is still useful even when the workspace is
 * outside the curated allowlist — better to send "tap to approve" with
 * a less-precise destination than to drop the push entirely.
 */
function workspaceIdForApprovalPush(workspacePath: string | undefined): string {
  if (!workspacePath) return 'global'
  try {
    const record = findRegisteredWorkspace(workspacePath)
    return record?.id ?? workspacePath
  } catch {
    return workspacePath
  }
}

installIpcValidation(ipcMain)

// Ask Chromium to keep expensive renderer visuals on the GPU raster path where supported.
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')

type GeminiCapabilityKind = typeof GEMINI_CAPABILITY_KINDS[number]

function loadOrCreateExternalGrantSigningSecret(): Buffer {
  const secretPath = join(app.getPath('userData'), 'external-grant-signing-secret')
  try {
    const existing = fsSync.readFileSync(secretPath, 'utf-8').trim()
    if (/^[0-9a-f]{64}$/i.test(existing)) {
      return Buffer.from(existing, 'hex')
    }
  } catch {
    // Missing or unreadable secrets are replaced below.
  }

  const secret = randomBytes(32)
  fsSync.mkdirSync(dirname(secretPath), { recursive: true })
  fsSync.writeFileSync(secretPath, secret.toString('hex'), { mode: 0o600 })
  try {
    fsSync.chmodSync(secretPath, 0o600)
  } catch {
    // chmod is best-effort on platforms without POSIX permissions.
  }
  return secret
}
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

// Phase B1: AgentRunPayload + AgentRunRoute exported so the extracted
// `services/RunCoordinator.ts` can type its public surface without an
// awkward import-from-index. Future Phase B slices will follow the
// same pattern.
export interface AgentRunRoute {
  appRunId?: string
  appChatId?: string
}

export interface AgentRunPayload {
  provider: ProviderId
  scope: ChatScope
  workspace?: string
  prompt: string
  appRunId?: string
  appChatId?: string
  model?: string
  reasoningEffort?: string | null
  serviceTier?: string | null
  claudeReasoningEffort?: string | null
  kimiThinking?: boolean | null
  approvalMode?: string
  imagePaths?: string[]
  providerSessionId?: string | null
  externalPathGrants?: ExternalPathGrant[]
  sessionTrust?: boolean
  geminiWorktree?: GeminiWorktreeLaunchOption
  runtimeProfileId?: string
  handoffSourceRunId?: string
  runtimeProfile?: RuntimeProfile
}

interface CodexRunState {
  sender: Electron.WebContents
  threadId: string
  scope?: ChatScope
  cwd: string
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
  scope: ChatScope
  cwd: string
  workspacePath?: string
  appRunId?: string
  appChatId?: string
  providerSessionId?: string | null
}

// Phase B3: AgenticApprovalWaiter moved into
// `src/main/services/ApprovalService.ts` as `PendingGeminiToolApproval`.
// HostCommandApproval is still referenced by `HostCommandResult` callers
// in `continueCodexAfterHostRerun`, so the interface stays here.

interface HostCommandApproval {
  sender: Electron.WebContents
  provider: 'codex'
  command: unknown
  commandText: string
  cwd: string
  workspacePath?: string
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
const CLAUDE_THINKING_EFFORTS = [
  { reasoningEffort: 'off' },
  { reasoningEffort: 'low' },
  { reasoningEffort: 'medium' },
  { reasoningEffort: 'high' }
]
const CLAUDE_THINKING_BUDGET: Record<string, number> = { low: 2048, medium: 8000, high: 16000 }
const CLAUDE_STATIC_MODELS = [
  { id: 'default', label: 'Default', description: 'Claude Code configured default', isDefault: true, supportedReasoningEfforts: CLAUDE_THINKING_EFFORTS },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', description: 'Most capable — extended thinking', supportedReasoningEfforts: CLAUDE_THINKING_EFFORTS },
  { id: 'claude-opus-4-7-1m', label: 'Claude Opus 4.7 1M', description: '1M context window — extended thinking', supportedReasoningEfforts: CLAUDE_THINKING_EFFORTS },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Balanced — extended thinking', supportedReasoningEfforts: CLAUDE_THINKING_EFFORTS },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'Fast & efficient' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6 Legacy', description: 'Previous Opus generation', supportedReasoningEfforts: CLAUDE_THINKING_EFFORTS },
  { id: 'custom', label: 'Custom model ID' }
]
const KIMI_STATIC_MODELS = [
  { id: 'kimi-k2.6', label: 'Kimi K2.6', description: 'Kimi Code CLI configured default model', isDefault: true }
]
const KIMI_DEFAULT_MODEL = 'kimi-k2.6'
const KIMI_CLI_MODEL_IDS = new Set(KIMI_STATIC_MODELS.map((model) => model.id))
const KIMI_CLI_MODEL_ALIASES = new Map<string, string>([
  ['default', 'kimi-k2.6'],
  ['cli-default', 'kimi-k2.6'],
  ['custom', 'kimi-k2.6'],
  ['best', 'kimi-k2.6'],
  ['kimi-latest', 'kimi-k2.6'],
  ['kimi-k2', 'kimi-k2.6'],
  ['kimi-k2-1t', 'kimi-k2.6'],
  ['kimi-thinking-preview', 'kimi-k2.6'],
  ['kimi-k2.5', 'kimi-k2.6'],
  ['kimi-k2-thinking-turbo', 'kimi-k2.6'],
  ['kimi-k2-thinking', 'kimi-k2.6'],
  ['kimi-k2-turbo-preview', 'kimi-k2.6'],
  ['kimi-k2-0905-preview', 'kimi-k2.6'],
  ['kimi-k2-0711-preview', 'kimi-k2.6'],
  ['kimi-k2-0905', 'kimi-k2.6'],
  ['kimi-k2-0711', 'kimi-k2.6'],
  ['kimi-k2-turbo', 'kimi-k2.6']
])
// Phase B3: the five pending-approval registries (pendingCodexApprovals,
// pendingKimiApprovals, pendingGeminiToolApprovals, pendingHostCommandApprovals,
// pendingMainApprovals) now live inside the ApprovalService instance
// constructed in whenReady. All previous `pending*Approvals.set(...)` call
// sites now call `approvalService.registerXxx(...)`; the unified
// `processAgentApprovalResponse` is now `approvalService.resolve(...)`.
const agenticSessionGrants = new Set<string>()
let activeCodexRunState: CodexRunState | null = null
const cliProviderProcesses = new Map<ProviderId, ChildProcess>()
const cliProviderAbortControllers = new Map<ProviderId, AbortController>()
const PROVIDER_IDS = new Set<ProviderId>(['gemini', 'codex', 'claude', 'kimi'])
const DEFAULT_AGENTIC_SERVICES_FOR_PROFILE: AppSettings['agenticServices'] = {
  shellCommands: 'workspace',
  fileChanges: 'ask',
  mcpTools: 'ask',
  subThreadDelegation: 'ask',
  networkAccess: 'allow'
}
const SETTINGS_PATCH_KEYS = new Set<keyof AppSettings>([
  'activeProvider',
  'windowBounds',
  'claudeBinaryPath',
  'kimiBinaryPath',
  'codexUsageCredential',
  'storeLocalChatHistory',
  'storeRawEvents',
  'storePromptResponseInUsage',
  'geminiCheckpointingEnabled',
  'chatContextTurns',
  'appearanceMode',
  'visualEffectStyle',
  'themeAppearance',
  'themeCornerStyle',
  'themeAccentStyle',
  'promptSurfaceStyle',
  'composerStyle',
  'transcriptFontFamily',
  'composerFontFamily',
  'reduceTransparency',
  'reduceMotion',
  'compactDensity',
  'showInspector',
  'inspectorWidth',
  'sidebarWidth',
  'funFxEnabled',
  'funFxMode',
  'advancedFx',
  'agenticServices',
  'geminiMcpBridgeEnabled',
  'geminiMcpBridgeLastStatus',
  'codexSandboxFallback',
  'updateChannel'
])
const MIN_INSPECTOR_WIDTH = 300;
const MAX_INSPECTOR_WIDTH = 720;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 440;
const DEFAULT_WINDOW_WIDTH = 1400;
const DEFAULT_WINDOW_HEIGHT = 900;
const MIN_WINDOW_WIDTH = 900;
const MIN_WINDOW_HEIGHT = 600;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value
}

function assertProviderId(value: unknown): ProviderId {
  if (typeof value === 'string' && PROVIDER_IDS.has(value as ProviderId)) {
    return value as ProviderId
  }
  throw new Error('Provider is invalid.')
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`)
  }
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function optionalStringOrNull(value: unknown): string | null | undefined {
  if (value === null) return null
  return optionalString(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function clampDimension(value: unknown, min: number, max: number, fallback = 0): number {
  const next = typeof value === 'number' && Number.isFinite(value)
    ? value
    : Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.max(min, Math.min(max, Math.round(next)))
}

function sanitizeWindowBounds(value: unknown): AppSettings['windowBounds'] | undefined {
  if (!isRecord(value)) return undefined
  const width = clampDimension(value.width, MIN_WINDOW_WIDTH, 10_000, DEFAULT_WINDOW_WIDTH)
  const height = clampDimension(value.height, MIN_WINDOW_HEIGHT, 10_000, DEFAULT_WINDOW_HEIGHT)
  const x = optionalNumber(value.x)
  const y = optionalNumber(value.y)
  return {
    ...(x !== undefined ? { x: Math.round(x) } : {}),
    ...(y !== undefined ? { y: Math.round(y) } : {}),
    width,
    height,
    ...(typeof value.isMaximized === 'boolean' ? { isMaximized: value.isMaximized } : {})
  }
}

function canonicalPath(value: string): string {
  return resolve(expandHomePath(value))
}

function chatScope(chat: Pick<ChatRecord, 'scope'> | null | undefined): ChatScope {
  return chat?.scope === 'global' ? 'global' : 'workspace'
}

function globalRunCwd(): string {
  return canonicalPath(app.getPath('home'))
}

function requireGlobalChat(chatId: unknown, label = 'Global chat'): ChatRecord {
  const id = requireNonEmptyString(chatId, label)
  const chat = AppStore.getChat(id)
  if (!chat || chatScope(chat) !== 'global') {
    throw new Error(`${label} must be a saved global chat.`)
  }
  return chat
}

function validateChatWorkspaceIdentity(chatId: string | undefined, workspace: WorkspaceRecord | undefined): void {
  if (!chatId) return
  const chat = AppStore.getChat(chatId)
  if (!chat) return
  if (chatScope(chat) === 'global') {
    throw new Error('Global chats cannot be used for workspace-scoped runs.')
  }
  if (workspace && chat.workspaceId && chat.workspaceId !== workspace.id) {
    throw new Error('Chat workspace does not match the selected workspace.')
  }
}

function sanitizeChatForSave(chat: ChatRecord): ChatRecord {
  const scope = chatScope(chat)
  if (scope === 'global') {
    const { workspaceId: _workspaceId, workspacePath: _workspacePath, ...rest } = chat
    return {
      ...rest,
      scope: 'global'
    }
  }
  if (!chat.workspacePath || !chat.workspaceId) {
    throw new Error('Workspace chat must include a workspace id and path.')
  }
  const workspace = findRegisteredWorkspace(chat.workspacePath)
  if (!workspace || workspace.id !== chat.workspaceId) {
    throw new Error('Chat workspace must be a registered AGBench workspace.')
  }
  return {
    ...chat,
    scope: 'workspace',
    workspaceId: workspace.id,
    workspacePath: canonicalPath(workspace.path)
  }
}

function assertSafeWorkspaceRoot(workspacePath: string): void {
  const normalized = canonicalPath(workspacePath)
  const root = parse(normalized).root
  if (normalized === root) {
    throw new Error('Filesystem roots cannot be registered as workspaces.')
  }
}

function findRegisteredWorkspace(workspacePath: string): WorkspaceRecord | undefined {
  const normalized = canonicalPath(workspacePath)
  return AppStore.getWorkspaces().find((workspace) => canonicalPath(workspace.path) === normalized)
}

function requireRegisteredWorkspace(workspacePath: string, label = 'Workspace'): string {
  const normalized = canonicalPath(requireNonEmptyString(workspacePath, label))
  assertSafeWorkspaceRoot(normalized)
  if (!findRegisteredWorkspace(normalized)) {
    throw new Error(`${label} must be selected through AGBench before it can be used.`)
  }
  return normalized
}

function externalGrantSigningPayload(grant: Pick<ExternalPathGrant, 'id' | 'provider' | 'path' | 'kind' | 'access' | 'duration' | 'createdAt'>): string {
  return JSON.stringify({
    id: grant.id,
    provider: grant.provider,
    path: canonicalPath(grant.path),
    kind: grant.kind,
    access: grant.access,
    duration: grant.duration,
    createdAt: grant.createdAt
  })
}

function signExternalPathGrant(grant: Pick<ExternalPathGrant, 'id' | 'provider' | 'path' | 'kind' | 'access' | 'duration' | 'createdAt'>): string {
  return createHmac('sha256', externalGrantSigningSecret)
    .update(externalGrantSigningPayload(grant))
    .digest('hex')
}

function issueExternalPathGrant(grant: Omit<ExternalPathGrant, 'issuedBy' | 'signature'>): ExternalPathGrant {
  const normalizedGrant: ExternalPathGrant = {
    ...grant,
    path: canonicalPath(grant.path),
    issuedBy: 'main',
    signature: ''
  }
  normalizedGrant.signature = signExternalPathGrant(normalizedGrant)
  return normalizedGrant
}

function isMainIssuedExternalPathGrant(grant: ExternalPathGrant): boolean {
  if (!grant || grant.issuedBy !== 'main' || typeof grant.signature !== 'string') return false
  const expected = Buffer.from(signExternalPathGrant(grant), 'hex')
  const actual = Buffer.from(grant.signature, 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function sanitizeAgenticServicePolicy(value: unknown, fallback: 'ask' | 'workspace' | 'allow' | 'deny'): 'ask' | 'workspace' | 'allow' | 'deny' {
  return value === 'ask' || value === 'workspace' || value === 'allow' || value === 'deny'
    ? value
    : fallback
}

function sanitizeAgenticNetworkPolicy(value: unknown, fallback: 'allow' | 'deny'): 'allow' | 'deny' {
  return value === 'allow' || value === 'deny' ? value : fallback
}

function normalizeAgentRunPayload(rawPayload: unknown): AgentRunPayload {
  const payload = requireRecord(rawPayload, 'Run payload')
  const provider = assertProviderId(payload.provider)
  const scope: ChatScope = payload.scope === 'global' ? 'global' : 'workspace'
  const rawExternalPathGrants = Array.isArray(payload.externalPathGrants)
    ? payload.externalPathGrants as ExternalPathGrant[]
    : []
  const externalPathGrants = rawExternalPathGrants.length
    ? normalizeExternalPathGrants(rawExternalPathGrants)
    : []
  if (rawExternalPathGrants.length && externalPathGrants.length !== rawExternalPathGrants.length) {
    throw new Error('External path grants must be issued by AGBench in this app session.')
  }
  const appChatId = optionalString(payload.appChatId) || optionalString(payload.chatId)
  let workspace: string | undefined
  let scopedExternalPathGrants = externalPathGrants
  if (scope === 'global') {
    requireGlobalChat(appChatId, 'Run global chat')
    workspace = globalRunCwd()
    if (rawExternalPathGrants.length > 0) {
      throw new Error('Global chats use approval prompts instead of external path grants.')
    }
    scopedExternalPathGrants = []
  } else {
    workspace = canonicalPath(requireNonEmptyString(payload.workspace, 'Workspace'))
  }
  return {
    provider,
    scope,
    workspace,
    prompt: typeof payload.prompt === 'string' ? payload.prompt : String(payload.prompt ?? ''),
    appRunId: optionalString(payload.appRunId),
    appChatId,
    model: optionalString(payload.model),
    reasoningEffort: optionalStringOrNull(payload.reasoningEffort),
    serviceTier: optionalStringOrNull(payload.serviceTier),
    claudeReasoningEffort: optionalStringOrNull(payload.claudeReasoningEffort),
    kimiThinking: typeof payload.kimiThinking === 'boolean' ? payload.kimiThinking : undefined,
    approvalMode: scope === 'global'
      ? (optionalString(payload.approvalMode) === 'plan' ? 'plan' : 'default')
      : optionalString(payload.approvalMode),
    imagePaths: stringArray(payload.imagePaths),
    providerSessionId: optionalStringOrNull(payload.providerSessionId),
    externalPathGrants: scopedExternalPathGrants,
    sessionTrust: Boolean(payload.sessionTrust),
    geminiWorktree: (payload.geminiWorktree ?? null) as GeminiWorktreeLaunchOption,
    runtimeProfileId: optionalString(payload.runtimeProfileId),
    handoffSourceRunId: optionalString(payload.handoffSourceRunId)
  }
}

async function ensureProviderRunPreflight(
  sender: Electron.WebContents,
  payload: AgentRunPayload
): Promise<boolean> {
  const route = routeWithRunId(payload.provider, payload)
  payload.appRunId = route.appRunId
  if (payload.scope === 'global') {
    try {
      requireGlobalChat(payload.appChatId, 'Run global chat')
      payload.workspace = globalRunCwd()
    } catch (error) {
      sendAgentCompatError(sender, payload.provider, error instanceof Error ? error.message : String(error), route)
      sendAgentCompatExit(sender, payload.provider, -1, route)
      return false
    }
  } else {
    try {
      payload.workspace = requireRegisteredWorkspace(payload.workspace || '')
      validateChatWorkspaceIdentity(payload.appChatId, findRegisteredWorkspace(payload.workspace))
    } catch (error) {
      sendAgentCompatError(sender, payload.provider, error instanceof Error ? error.message : String(error), route)
      sendAgentCompatExit(sender, payload.provider, -1, route)
      return false
    }
  }

  if (!(await ensureWorkspaceTrustForRun(sender, payload))) {
    return false
  }

  const adapter = providerAdapters.require(payload.provider)
  const contract = await adapter.getCapabilityContract({
    workspacePath: payload.workspace,
    approvalMode: payload.approvalMode
  })
  const preflight = providerPreflightService.evaluate(
    {
      provider: payload.provider,
      workspacePath: payload.workspace,
      approvalMode: payload.approvalMode,
      model: payload.model
    },
    contract,
    adapter
  )
  if (preflight.state === 'ready') {
    return true
  }
  sendAgentCompatError(
    sender,
    payload.provider,
    preflight.reason,
    route
  )
  sendAgentCompatExit(sender, payload.provider, -1, route)
  return false
}

function normalizeScheduledTaskExternalGrants(value: unknown): ExternalPathGrant[] | undefined {
  const rawGrants = Array.isArray(value) ? value as ExternalPathGrant[] : []
  const grants = normalizeExternalPathGrants(rawGrants)
  if (rawGrants.length && grants.length !== rawGrants.length) {
    throw new Error('Scheduled task external path grants must be issued by AGBench in this app session.')
  }
  return grants.length ? grants : undefined
}

function assertScheduledTaskWorkspaceIdentity(workspacePath: string, workspaceId?: unknown): WorkspaceRecord {
  const registeredPath = requireRegisteredWorkspace(workspacePath, 'Scheduled task workspace')
  const workspace = findRegisteredWorkspace(registeredPath)
  if (!workspace) {
    throw new Error('Scheduled task workspace must be registered.')
  }
  if (typeof workspaceId === 'string' && workspaceId && workspaceId !== workspace.id) {
    throw new Error('Scheduled task workspace id does not match the registered workspace.')
  }
  return workspace
}

function sanitizeScheduledTaskForSave(task: unknown): Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'status'> & Partial<Pick<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'status'>> {
  const input = requireRecord(task, 'Scheduled task')
  const workspace = assertScheduledTaskWorkspaceIdentity(
    requireNonEmptyString(input.workspacePath, 'Scheduled task workspace'),
    input.workspaceId
  )
  return {
    ...input,
    workspaceId: workspace.id,
    workspacePath: canonicalPath(workspace.path),
    provider: assertProviderId(input.provider),
    externalPathGrants: normalizeScheduledTaskExternalGrants(input.externalPathGrants),
    runtimeProfileId: optionalString(input.runtimeProfileId),
    handoffSourceRunId: optionalString(input.handoffSourceRunId)
  } as Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'status'> & Partial<Pick<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'status'>>
}

function sanitizeScheduledTaskPatch(id: string, partial: unknown): Partial<ScheduledTask> | null {
  const input = requireRecord(partial, 'Scheduled task update')
  const existing = AppStore.getScheduledTasks().find((task) => task.id === id)
  if (!existing) return null
  const workspace = assertScheduledTaskWorkspaceIdentity(existing.workspacePath, existing.workspaceId)
  if ('workspacePath' in input && input.workspacePath !== undefined && canonicalPath(String(input.workspacePath)) !== canonicalPath(workspace.path)) {
    throw new Error('Scheduled task workspace path cannot be changed by the renderer.')
  }
  if ('workspaceId' in input && input.workspaceId !== undefined && input.workspaceId !== workspace.id) {
    throw new Error('Scheduled task workspace id cannot be changed by the renderer.')
  }

  const sanitized: Partial<ScheduledTask> = {
    ...(input as Partial<ScheduledTask>),
    workspaceId: workspace.id,
    workspacePath: canonicalPath(workspace.path)
  }
  if ('provider' in input && input.provider !== undefined) {
    sanitized.provider = assertProviderId(input.provider)
  }
  if ('externalPathGrants' in input) {
    sanitized.externalPathGrants = normalizeScheduledTaskExternalGrants(input.externalPathGrants)
  }
  if ('runtimeProfileId' in input) {
    sanitized.runtimeProfileId = optionalString(input.runtimeProfileId)
  }
  if ('handoffSourceRunId' in input) {
    sanitized.handoffSourceRunId = optionalString(input.handoffSourceRunId)
  }
  return sanitized
}

function sanitizeRuntimeProfileForSave(profile: unknown): Partial<RuntimeProfile> & Pick<RuntimeProfile, 'name' | 'provider'> {
  const input = requireRecord(profile, 'Runtime profile')
  const env: Record<string, string> = {}
  if (isRecord(input.env)) {
    for (const [key, value] of Object.entries(input.env)) {
      if (typeof key === 'string' && key.trim() && typeof value === 'string') {
        env[key] = value
      }
    }
  }
  const workspaceMode = input.workspaceMode === 'worktree' || input.workspaceMode === 'container'
    ? input.workspaceMode
    : 'local'
  const networkPolicy = input.networkPolicy === 'allow' || input.networkPolicy === 'deny'
    ? input.networkPolicy
    : 'inherit'
  const persistence = input.persistence === 'ephemeral' ? 'ephemeral' : 'reusable'
  return {
    id: optionalString(input.id),
    name: requireNonEmptyString(input.name, 'Runtime profile name'),
    provider: assertProviderId(input.provider),
    scope: input.scope === 'global' ? 'global' : 'workspace',
    workspaceMode,
    binaryPath: optionalString(input.binaryPath),
    env,
    mcpProfileId: optionalString(input.mcpProfileId),
    approvalMode: optionalString(input.approvalMode),
    agenticServices: isRecord(input.agenticServices) ? {
      shellCommands: sanitizeAgenticServicePolicy(input.agenticServices.shellCommands, DEFAULT_AGENTIC_SERVICES_FOR_PROFILE.shellCommands),
      fileChanges: sanitizeAgenticServicePolicy(input.agenticServices.fileChanges, DEFAULT_AGENTIC_SERVICES_FOR_PROFILE.fileChanges),
      mcpTools: sanitizeAgenticServicePolicy(input.agenticServices.mcpTools, DEFAULT_AGENTIC_SERVICES_FOR_PROFILE.mcpTools),
      subThreadDelegation: sanitizeAgenticServicePolicy(
        input.agenticServices.subThreadDelegation,
        DEFAULT_AGENTIC_SERVICES_FOR_PROFILE.subThreadDelegation
      ),
      networkAccess: sanitizeAgenticNetworkPolicy(input.agenticServices.networkAccess, DEFAULT_AGENTIC_SERVICES_FOR_PROFILE.networkAccess)
    } : undefined,
    networkPolicy,
    persistence,
    containerConfig: isRecord(input.containerConfig) ? {
      image: optionalString(input.containerConfig.image),
      workdir: optionalString(input.containerConfig.workdir),
      mounts: Array.isArray(input.containerConfig.mounts)
        ? input.containerConfig.mounts.filter(isRecord).map((mount) => ({
          source: requireNonEmptyString(mount.source, 'Runtime mount source'),
          target: requireNonEmptyString(mount.target, 'Runtime mount target'),
          access: mount.access === 'write' ? 'write' : 'read'
        }))
        : undefined
    } : undefined
  }
}

function sanitizeHandoffStatus(value: unknown): HandoffCard['status'] {
  return value === 'dispatched' || value === 'archived' ? value : 'draft'
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : []
}

function sanitizeHandoffCardForSave(card: unknown): Partial<HandoffCard> & Pick<HandoffCard, 'sourceChatId' | 'sourceProvider' | 'summary' | 'finalPrompt'> {
  const input = requireRecord(card, 'Handoff card')
  const sourceChatId = requireNonEmptyString(input.sourceChatId, 'Handoff source chat')
  const sourceProvider = assertProviderId(input.sourceProvider)
  const recommendedProvider = input.recommendedProvider === undefined ? undefined : assertProviderId(input.recommendedProvider)
  return {
    id: optionalString(input.id),
    status: sanitizeHandoffStatus(input.status),
    sourceChatId,
    sourceRunId: optionalString(input.sourceRunId),
    sourceProvider,
    workspaceId: optionalString(input.workspaceId),
    workspacePath: optionalString(input.workspacePath),
    summary: requireNonEmptyString(input.summary, 'Handoff summary'),
    selectedFiles: stringList(input.selectedFiles),
    workspaceChangeSetIds: stringList(input.workspaceChangeSetIds),
    rawEventRunIds: stringList(input.rawEventRunIds),
    recommendedProvider,
    recommendedModel: optionalString(input.recommendedModel),
    recommendedApprovalMode: optionalString(input.recommendedApprovalMode),
    targetChatId: optionalString(input.targetChatId),
    dispatchedRunId: optionalString(input.dispatchedRunId),
    finalPrompt: requireNonEmptyString(input.finalPrompt, 'Handoff prompt'),
    dispatchedAt: optionalString(input.dispatchedAt)
  }
}

function sanitizeHandoffCardPatch(partial: unknown): Partial<HandoffCard> {
  const input = requireRecord(partial, 'Handoff card update')
  const sanitized: Partial<HandoffCard> = {}
  if ('status' in input) sanitized.status = sanitizeHandoffStatus(input.status)
  if ('summary' in input && input.summary !== undefined) sanitized.summary = requireNonEmptyString(input.summary, 'Handoff summary')
  if ('finalPrompt' in input && input.finalPrompt !== undefined) sanitized.finalPrompt = requireNonEmptyString(input.finalPrompt, 'Handoff prompt')
  if ('sourceRunId' in input) sanitized.sourceRunId = optionalString(input.sourceRunId)
  if ('selectedFiles' in input) sanitized.selectedFiles = stringList(input.selectedFiles)
  if ('workspaceChangeSetIds' in input) sanitized.workspaceChangeSetIds = stringList(input.workspaceChangeSetIds)
  if ('rawEventRunIds' in input) sanitized.rawEventRunIds = stringList(input.rawEventRunIds)
  if ('recommendedProvider' in input) sanitized.recommendedProvider = input.recommendedProvider === undefined ? undefined : assertProviderId(input.recommendedProvider)
  if ('recommendedModel' in input) sanitized.recommendedModel = optionalString(input.recommendedModel)
  if ('recommendedApprovalMode' in input) sanitized.recommendedApprovalMode = optionalString(input.recommendedApprovalMode)
  if ('targetChatId' in input) sanitized.targetChatId = optionalString(input.targetChatId)
  if ('dispatchedRunId' in input) sanitized.dispatchedRunId = optionalString(input.dispatchedRunId)
  if ('dispatchedAt' in input) sanitized.dispatchedAt = optionalString(input.dispatchedAt)
  return sanitized
}

function sanitizeHandoffCardFilter(filter: unknown): HandoffCardFilter {
  if (!isRecord(filter)) return {}
  return {
    sourceChatId: optionalString(filter.sourceChatId),
    sourceRunId: optionalString(filter.sourceRunId),
    status: filter.status === 'draft' || filter.status === 'dispatched' || filter.status === 'archived' ? filter.status : undefined
  }
}

function sanitizeAdvancedFxSettings(value: unknown, current: AppSettings['advancedFx']): AppSettings['advancedFx'] {
  const source = isRecord(value) ? value : {}
  const rawIntensity = source.intensity
  const intensity =
    rawIntensity === 'subtle' || rawIntensity === 'cinematic' || rawIntensity === 'epic'
      ? rawIntensity
      : current.intensity || 'cinematic'

  return {
    agentAura: 'agentAura' in source ? Boolean(source.agentAura) : current.agentAura,
    livingWorkspace: 'livingWorkspace' in source ? Boolean(source.livingWorkspace) : current.livingWorkspace,
    dataViz: 'dataViz' in source ? Boolean(source.dataViz) : current.dataViz,
    intensity
  }
}

function sanitizeSettingsPatch(partial: unknown): Partial<AppSettings> {
  const input = requireRecord(partial, 'Settings patch')
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!SETTINGS_PATCH_KEYS.has(key as keyof AppSettings)) continue
    sanitized[key] = value
  }
  if ('activeProvider' in sanitized && sanitized.activeProvider !== undefined) {
    sanitized.activeProvider = assertProviderId(sanitized.activeProvider)
  }
  if ('agenticServices' in sanitized) {
    const services = requireRecord(sanitized.agenticServices, 'Agentic services')
    const current = AppStore.getSettings().agenticServices
    sanitized.agenticServices = {
      shellCommands: sanitizeAgenticServicePolicy(services.shellCommands, current.shellCommands),
      fileChanges: sanitizeAgenticServicePolicy(services.fileChanges, current.fileChanges),
      mcpTools: sanitizeAgenticServicePolicy(services.mcpTools, current.mcpTools),
      subThreadDelegation: sanitizeAgenticServicePolicy(
        services.subThreadDelegation,
        current.subThreadDelegation
      ),
      networkAccess: sanitizeAgenticNetworkPolicy(services.networkAccess, current.networkAccess)
    }
  }
  if ('advancedFx' in sanitized) {
    sanitized.advancedFx = sanitizeAdvancedFxSettings(sanitized.advancedFx, AppStore.getSettings().advancedFx)
  }
  if ('windowBounds' in sanitized) {
    const bounds = sanitizeWindowBounds(sanitized.windowBounds)
    if (bounds) {
      sanitized.windowBounds = bounds
    } else {
      delete sanitized.windowBounds
    }
  }
  for (const key of ['chatContextTurns', 'inspectorWidth', 'sidebarWidth'] as const) {
    if (key in sanitized) {
      const value = Number(sanitized[key])
      if (Number.isFinite(value)) {
        if (key === 'chatContextTurns') {
          sanitized[key] = Math.max(0, Math.trunc(value))
        } else if (key === 'inspectorWidth') {
          sanitized[key] = clampDimension(value, MIN_INSPECTOR_WIDTH, MAX_INSPECTOR_WIDTH)
        } else if (key === 'sidebarWidth') {
          sanitized[key] = clampDimension(value, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH)
        } else {
          sanitized[key] = Math.max(0, Math.trunc(value))
        }
      } else {
        delete sanitized[key]
      }
    }
  }

  if ('funFxEnabled' in sanitized) {
    const value = sanitized.funFxEnabled
    sanitized.funFxEnabled = typeof value === 'boolean' ? value : Boolean(value)
  }
  if ('funFxMode' in sanitized) {
    const value = sanitized.funFxMode
    if (value === 'off' || value === 'subtle' || value === 'cinematic' || value === 'epic') {
      sanitized.funFxMode = value
    } else {
      delete sanitized.funFxMode
    }
  }
  return sanitized as Partial<AppSettings>
}

interface ResolvedProviderBinary {
  provider: ProviderId
  binaryPath: string | null
  source: 'runtime_profile' | 'settings' | 'path' | 'common' | 'missing'
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
const permissionService = new PermissionService({ runManager, sessionGrants: agenticSessionGrants })
const providerPreflightService = new ProviderPreflightService()
let runRepository: RunRepository | null = null
let runQueueServiceRef: RunQueueService | null = null

function getRunRepository(): RunRepository {
  if (!runRepository) {
    runRepository = new RunRepository({
      providerLabel: providerDisplayName,
      emitRunQueueChanged,
      emitRunEventsChanged
    })
  }
  return runRepository
}

interface CodexUsageCredential {
  accessToken: string
  accountId: string
  importedAt?: string
  source?: string
}

let inMemoryCodexUsageCredential: CodexUsageCredential | null = null

function providerDisplayName(provider: ProviderId): string {
  return providerLabel(provider)
}

function emitRunQueueChanged(): void {
  mainWindow?.webContents.send('run-queue-changed', AppStore.getRunQueueJobs({ includeTerminal: true }))
}

function persistRunSessionQueueState(session: ReturnType<typeof runManager.get>): void {
  if (runQueueServiceRef) {
    runQueueServiceRef.persistSessionQueueState(session)
    return
  }
  getRunRepository().persistSessionQueueState(session)
}

runManager.onChange((event) => {
  if (event.type === 'removed') return
  persistRunSessionQueueState(event.session)
  expireRunScopedApprovalLedger(event.session)
  getRunRepository().appendLifecycleEvent(event.type, event.session)
  // Phase F2: when a sub-thread's run completes, optionally propagate
  // its final assistant message to the parent transcript. Best-effort
  // (errors don't break the run-event subscriber chain).
  if (event.type === 'updated' && event.session.status === 'completed') {
    void maybePropagateSubThreadResult(event.session.appChatId).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(
        `[SubThreadReturn] propagation failed for chatId=${event.session.appChatId}:`,
        err instanceof Error ? err.message : String(err)
      )
    })
  }
})

/**
 * Phase F2 — sub-thread result back-propagation.
 *
 * When a sub-thread run completes and `delegationContext.returnResultToParent`
 * is true (set at spawn time), append a synthetic system message to
 * the parent transcript containing the sub-thread's final assistant
 * message. Stamp `delegationContext.resultReturnedAt` so we only do
 * this once.
 *
 * Idempotent: re-running on an already-propagated sub-thread is a
 * no-op. Safe to call from any code path; checks short-circuit if
 * preconditions aren't met.
 */
async function maybePropagateSubThreadResult(chatId: string | undefined): Promise<void> {
  if (!chatId) return
  const subThread = AppStore.getChat(chatId)
  if (!subThread) return
  if (!subThread.parentChatId) return
  if (!subThread.delegationContext?.returnResultToParent) return
  if (subThread.delegationContext.resultReturnedAt) return
  // Find the sub-thread's final assistant message — that's the
  // "answer" the parent wants surfaced.
  const lastAssistant = [...subThread.messages].reverse().find((m) => m.role === 'assistant')
  if (!lastAssistant || !lastAssistant.content.trim()) return
  const parent = AppStore.getChat(subThread.parentChatId)
  if (!parent) return
  const label = subThread.provider ? providerLabel(subThread.provider) : 'Sub-thread'
  const syntheticMessage: ChatMessage = {
    id: `subthread-return-${subThread.appChatId}-${Date.now()}`,
    // 'system' role so the parent agent treats it as context, not as
    // a user prompt. The renderer can detect metadata.kind ===
    // 'subThreadReturn' for a custom badge / link-back affordance.
    role: 'system',
    content: `↩ Result from ${label} sub-thread (${subThread.title}):\n\n${lastAssistant.content}`,
    timestamp: new Date().toISOString(),
    metadata: {
      kind: 'subThreadReturn',
      subThreadId: subThread.appChatId,
      subThreadProvider: subThread.provider,
      subThreadTitle: subThread.title
    }
  }
  const updatedParent: ChatRecord = {
    ...parent,
    messages: [...parent.messages, syntheticMessage],
    updatedAt: Date.now()
  }
  AppStore.saveChat(updatedParent)
  const updatedSubThread: ChatRecord = {
    ...subThread,
    delegationContext: {
      ...subThread.delegationContext,
      resultReturnedAt: Date.now()
    },
    updatedAt: Date.now()
  }
  AppStore.saveChat(updatedSubThread)
  // Audit: durable run-event on the PARENT chat so the audit log
  // shows the propagation happened.
  try {
    appendDurableRunEventForRoute(
      parent.provider ?? subThread.provider ?? 'gemini',
      { appChatId: parent.appChatId },
      'subthread_returned',
      'control',
      `Sub-thread result returned from ${label}`,
      {
        subThreadId: subThread.appChatId,
        subThreadProvider: subThread.provider,
        finalMessagePreview: lastAssistant.content.slice(0, 200)
      }
    )
  } catch {
    // Best-effort — the propagation itself already succeeded.
  }
  // Notify the renderer so both the parent and sub-thread re-render
  // with the new state (parent has the synthetic message; sub-thread
  // shows the "returned" timestamp).
  try {
    mainWindow?.webContents.send('chat-updated', updatedParent)
    mainWindow?.webContents.send('chat-updated', updatedSubThread)
  } catch {
    // Window may be destroyed — ignore.
  }
}

function emitRunEventsChanged(record: { runId: string; chatId?: string; workspaceId?: string; sequence: number }) {
  mainWindow?.webContents.send('run-events-changed', {
    runId: record.runId,
    chatId: record.chatId,
    workspaceId: record.workspaceId,
    sequence: record.sequence
  })
}

function appendDurableRunEvent(input: RunEventInput): void {
  getRunRepository().appendRunEvent(input)
}

const runEventChatMetadataCache = new Map<string, { workspaceId?: string; workspacePath?: string }>()

function getRunEventChatMetadata(chatId?: string): { workspaceId?: string; workspacePath?: string } {
  if (!chatId) return {}
  const cached = runEventChatMetadataCache.get(chatId)
  if (cached) return cached
  const chat = AppStore.getChat(chatId)
  const metadata = {
    workspaceId: chat?.workspaceId,
    workspacePath: chat?.workspacePath
  }
  runEventChatMetadataCache.set(chatId, metadata)
  return metadata
}

function appendDurableRunEventForRoute(
  provider: ProviderId,
  route: AgentRunRoute | null | undefined,
  kind: RunEventInput['kind'],
  phase: RunEventInput['phase'],
  summary: string,
  payload?: unknown,
  source: RunEventInput['source'] = 'main'
): void {
  const session = runManager.get(route?.appRunId) || getRuntimeSession(provider, route)
  const runId = route?.appRunId || session?.runId
  if (!runId) return

  const chatId = route?.appChatId || session?.appChatId
  const chatMetadata = getRunEventChatMetadata(chatId)
  appendDurableRunEvent({
    runId,
    chatId,
    workspaceId: chatMetadata.workspaceId,
    workspacePath: session?.workspacePath || chatMetadata.workspacePath,
    provider,
    providerSessionId: session?.providerSessionId,
    providerRunId: session?.providerRunId,
    kind,
    phase,
    source,
    summary,
    payload
  })
}

/**
 * Phase I3.x — runs that have already received the cross-provider warning
 * chip. Keyed by appRunId so we fire at most once per run; otherwise a
 * verbose Gemini stream would spam the renderer with the same redirect
 * notice on every stdout chunk. */
const geminiCrossProviderWarningsFired = new Set<string>()

/**
 * Phase I3.x — bridge between the pure detector and the durable run-event
 * stream. Inspects a Gemini stdout chunk; if it looks like a built-in
 * invoke_agent call AND the user's prompt expressed cross-provider intent,
 * emits a single `provider_warning` event with the redirect hint so the
 * renderer surfaces a chip without blocking the run. */
function maybeEmitGeminiCrossProviderWarning(
  sender: Electron.WebContents,
  route: AgentRunRoute,
  userPrompt: string,
  stdoutChunk: string
): void {
  const runId = route.appRunId
  if (!runId) return
  if (geminiCrossProviderWarningsFired.has(runId)) return

  const detection = detectCrossProviderDelegationMisuse({
    userPrompt,
    stdoutChunk
  })
  if (!detection.shouldWarn) return

  geminiCrossProviderWarningsFired.add(runId)

  // We piggyback on the existing `provider_warning` lane the renderer
  // already understands (NON_EXECUTION_TOOL_EVENT_NAMES whitelists it).
  try {
    sendAgentCompatLine(sender, 'gemini', {
      type: 'provider_warning',
      provider: 'gemini',
      severity: 'warning',
      title: 'Cross-provider delegation bypassed',
      message: crossProviderDelegationWarningMessage(),
      details: detection.reason
    }, route)
  } catch {
    // Best-effort surface. Detection only fires once per run; drop quietly
    // if the renderer is gone.
  }
}

function recordStartupRecoveryEvents(records: RunRecoveryRecord[]): void {
  for (const record of records) {
    appendDurableRunEvent({
      runId: record.runId,
      chatId: record.chatId,
      workspaceId: record.workspaceId,
      workspacePath: record.workspacePath,
      provider: record.provider,
      kind: 'lifecycle',
      phase: 'control',
      source: 'main',
      summary: record.process?.alive
        ? `Recovered interrupted run; orphan process ${record.process.pid} may still be running`
        : 'Recovered interrupted run after app restart',
      payload: record
    })
  }
}

function approvalRouteContext(provider: ProviderId, route?: AgentRunRoute | null) {
  const session = runManager.get(route?.appRunId) || getRuntimeSession(provider, route)
  const runId = route?.appRunId || session?.runId
  const chatId = route?.appChatId || session?.appChatId
  const chat = chatId ? AppStore.getChat(chatId) : null
  return {
    session,
    runId,
    chatId,
    workspaceId: chat?.workspaceId,
    workspacePath: session?.workspacePath || chat?.workspacePath
  }
}

function recordApprovalLedgerRequest(
  provider: ProviderId,
  route: AgentRunRoute | null | undefined,
  payload: {
    id?: string
    approvalId?: string
    requestId?: number | string
    method?: string
    title?: string
    body?: string
    preview?: unknown
    params?: unknown
    actions?: AgentApprovalAction[]
  },
  options: {
    service?: AgenticServiceId
    workspacePath?: string
    metadata?: Record<string, unknown>
  } = {}
): void {
  const approvalId = String(payload.approvalId || payload.id || '').trim()
  if (!approvalId) return
  const context = approvalRouteContext(provider, route)
  try {
    permissionService.recordApprovalRequest({
      approvalId,
      provider,
      service: options.service,
      method: payload.method || 'approval/request',
      title: payload.title || 'Approval requested',
      body: payload.body,
      preview: payload.preview,
      params: payload.params,
      actions: Array.isArray(payload.actions) ? payload.actions : [],
      runId: context.runId,
      chatId: context.chatId,
      workspaceId: context.workspaceId,
      workspacePath: options.workspacePath || context.workspacePath,
      providerSessionId: context.session?.providerSessionId,
      providerRunId: context.session?.providerRunId,
      rpcId: payload.requestId,
      metadata: options.metadata
    })
  } catch (error) {
    console.error('Failed to record approval ledger request', error)
  }
}

function recordApprovalLedgerDecision(input: ApprovalLedgerRequestInput): void {
  try {
    permissionService.recordApprovalRequest(input)
  } catch (error) {
    console.error('Failed to record approval ledger decision', error)
  }
}

const auditService = new AuditService({
  runManager,
  resolveApprovalResponse: (approvalId, action, decisionSource, extraMetadata) =>
    permissionService.resolveApprovalResponse(approvalId, action, decisionSource, extraMetadata),
  recordApprovalLedgerDecision,
  approvalRouteContext,
  logError: (message, error) => {
    console.error(message, error)
  }
})

function expireRunScopedApprovalLedger(session: { runId: string; provider: ProviderId; workspacePath?: string; status?: string }): void {
  if (session.status !== 'completed' && session.status !== 'failed' && session.status !== 'cancelled') return
  try {
    permissionService.expireRunScopedApprovals(session)
  } catch (error) {
    console.error('Failed to expire run-scoped approval ledger records', error)
  }
}

const AGENTIC_SERVICE_LABELS: Record<AgenticServiceId, string> = {
  shellCommands: 'Shell commands',
  fileChanges: 'File changes',
  mcpTools: 'MCP and tool calls',
  subThreadDelegation: 'Sub-thread delegation'
}

function getAgenticServicePolicy(service: AgenticServiceId, settings: AppSettings = AppStore.getSettings()) {
  return permissionService.getServicePolicy(service, settings)
}

function hasAgenticWorkspaceGrant(
  settings: AppSettings,
  provider: ProviderId,
  workspacePath: string | undefined,
  service: AgenticServiceId
): boolean {
  return permissionService.hasWorkspaceGrant(settings, provider, workspacePath, service)
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
    forcePrompt?: boolean
  }
): Promise<boolean> {
  const settings = AppStore.getSettings()
  const resolution = permissionService.resolvePermission(provider, service, workspacePath, request.runId, settings)
  const { policy, workspaceGrantAllowed, sessionGrantAllowed, decision } = resolution
  const label = AGENTIC_SERVICE_LABELS[service]

  if (decision === 'deny') {
    auditService.recordAutomaticApprovalDecision(
      provider,
      { appRunId: request.runId },
      service,
      workspacePath,
      request,
      'autoDeny',
      'policy',
      'request',
      { policy }
    )
    sender?.send('agent-error', { provider, error: `${label} blocked by AGBench settings.` })
    return false
  }
  if (decision === 'allow' && !(request.forcePrompt && !sessionGrantAllowed)) {
    auditService.recordAutomaticApprovalDecision(
      provider,
      { appRunId: request.runId },
      service,
      workspacePath,
      request,
      'autoAllow',
      workspaceGrantAllowed ? 'workspace_grant' : sessionGrantAllowed ? 'session_grant' : 'policy',
      workspaceGrantAllowed ? 'workspace' : sessionGrantAllowed ? 'session' : 'request',
      { policy }
    )
    return true
  }
  if (!sender || sender.isDestroyed()) {
    return false
  }

  const approvalId = Date.now() + '-' + Math.random().toString(36).slice(2)
  const actions = approvalActionsForPolicy(policy, workspacePath)
  return new Promise((resolveApproval) => {
    approvalService?.registerGeminiTool(approvalId, {
      provider,
      service,
      workspacePath,
      runId: request.runId,
      resolve: resolveApproval
    })
    runManager.registerApproval(request.runId, approvalId)
    scheduleApprovalTimeout({
      approvalId,
      provider,
      route: { appRunId: request.runId, appChatId: runManager.get(request.runId)?.appChatId },
      kind: request.method
    })
    const session = runManager.get(request.runId)
    const approvalPayload = {
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
    }
    appendDurableRunEventForRoute(
      provider,
      { appRunId: session?.runId, appChatId: session?.appChatId },
      'approval_request',
      'control',
      request.title,
      approvalPayload
    )
    recordApprovalLedgerRequest(
      provider,
      { appRunId: session?.runId, appChatId: session?.appChatId },
      approvalPayload,
      {
        service,
        workspacePath,
        metadata: { policy }
      }
    )
    sender.send('agent-approval-request', approvalPayload)
    // Fan out a wake-push to any paired iOS device so the user can
    // approve the agentic-service request away from the desktop.
    notifyPairedDevicesOfApproval({
      approvalId,
      workspaceId: workspaceIdForApprovalPush(workspacePath),
      threadId: session?.appChatId ?? request.runId ?? approvalId,
      summary: request.title
    })
  })
}

async function requestMainApproval(
  sender: Electron.WebContents | null,
  provider: ProviderId,
  route: AgentRunRoute | null | undefined,
  request: {
    method: string
    title: string
    body: string
    preview?: unknown
    workspacePath?: string
  }
): Promise<boolean> {
  if (!sender || sender.isDestroyed()) return false
  const routed = routeWithRunId(provider, route)
  const approvalId = Date.now() + '-' + Math.random().toString(36).slice(2)
  return new Promise((resolveApproval) => {
    approvalService?.registerMain(approvalId, {
      provider,
      workspacePath: request.workspacePath,
      runId: routed.appRunId,
      resolve: resolveApproval
    })
    runManager.registerApproval(routed.appRunId, approvalId)
    scheduleApprovalTimeout({
      approvalId,
      provider,
      route: routed,
      isMainAuthority: true,
      kind: request.method
    })
    const actions: AgentApprovalAction[] = ['accept', 'decline', 'cancel']
    const approvalPayload = {
      provider,
      appRunId: routed.appRunId,
      appChatId: routed.appChatId,
      id: approvalId,
      approvalId,
      method: request.method,
      title: request.title,
      body: request.body,
      preview: { ...(isRecord(request.preview) ? request.preview : {}), actions },
      actions
    }
    appendDurableRunEventForRoute(
      provider,
      routed,
      'approval_request',
      'control',
      request.title,
      approvalPayload
    )
    recordApprovalLedgerRequest(provider, routed, approvalPayload, {
      workspacePath: request.workspacePath,
      metadata: { mainAuthority: true }
    })
    sender.send('agent-approval-request', approvalPayload)
    // Fan out a wake-push to any paired iOS device. Main-authority
    // approvals are typically workspace-trust or other infrequent
    // events — exactly the kind of decision the user benefits from
    // handling on their phone.
    notifyPairedDevicesOfApproval({
      approvalId,
      workspaceId: workspaceIdForApprovalPush(request.workspacePath),
      threadId: routed.appChatId ?? routed.appRunId ?? approvalId,
      summary: request.title
    })
  })
}

function trustStatusAllowsRun(status: string | undefined): boolean {
  return status === 'trusted' || status === 'inherited'
}

async function ensureWorkspaceTrustForRun(
  sender: Electron.WebContents,
  payload: AgentRunPayload
): Promise<boolean> {
  if (payload.scope === 'global') return true
  if (payload.provider !== 'gemini') return true
  const trust = TrustStatusService.checkTrust(payload.workspace || '')
  if (trustStatusAllowsRun(trust.status)) return true

  const route = routeWithRunId('gemini', payload)
  payload.appRunId = route.appRunId
  if (payload.sessionTrust) {
    const approved = await requestMainApproval(sender, 'gemini', route, {
      method: 'workspace/session-trust',
      title: 'Approve session-only workspace trust',
      body: `${payload.workspace}\n${trust.reason || trust.status}`,
      workspacePath: payload.workspace,
      preview: {
        kind: 'workspaceTrust',
        workspacePath: payload.workspace,
        trustStatus: trust.status,
        reason: trust.reason,
        duration: 'thisRun'
      }
    })
    if (approved) return true
  }

  sendAgentCompatError(
    sender,
    'gemini',
    `Gemini run blocked because workspace trust is ${trust.status}${trust.reason ? `: ${trust.reason}` : '.'}`,
    route
  )
  sendAgentCompatExit(sender, 'gemini', -1, route)
  return false
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

function resolveHostDirectory(baseCwd: string, requestedCwd?: string | null): string {
  return requestedCwd && requestedCwd.trim()
    ? isAbsolute(requestedCwd) ? resolve(requestedCwd) : resolve(baseCwd, requestedCwd)
    : resolve(baseCwd)
}

function resolveScopedDirectory(scope: ChatScope, baseCwd: string, workspacePath: string | undefined, requestedCwd?: string | null): string {
  return scope === 'global'
    ? resolveHostDirectory(baseCwd, requestedCwd)
    : resolveWorkspaceDirectory(workspacePath || baseCwd, requestedCwd)
}

function resolveGeminiMcpPath(workspacePath: string, filePath: string): string {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('A workspace path is required.')
  }
  return resolveWorkspaceChild(workspacePath, filePath)
}

function resolveGeminiMcpScopedPath(context: GeminiToolContext, filePath: string): string {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error(context.scope === 'global' ? 'A host path is required.' : 'A workspace path is required.')
  }
  if (context.scope === 'global') {
    return isAbsolute(filePath) ? resolve(filePath) : resolve(context.cwd, filePath)
  }
  return resolveGeminiMcpPath(context.workspacePath || context.cwd, filePath)
}

function formatScopedPath(context: GeminiToolContext, targetPath: string): string {
  return context.scope === 'global'
    ? resolve(targetPath)
    : toWorkspaceRelativePath(context.workspacePath || context.cwd, targetPath)
}

function previewForGeminiMcpTool(toolName: AGBenchMcpToolName, args: Record<string, any>, cwd: string, context: GeminiToolContext) {
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
    const resolvedFilePath = filePath ? resolveGeminiMcpScopedPath(context, filePath) : ''
    const previewPath = resolvedFilePath ? formatScopedPath(context, resolvedFilePath) : filePath
    return {
      title: toolName === 'write_file' ? 'Approve Gemini file write' : 'Approve Gemini file edit',
      body: previewPath || toolName,
      service: 'fileChanges' as AgenticServiceId,
      preview: {
        kind: 'fileChange',
        changes: [{ kind: toolName === 'write_file' ? 'write' : 'replace', path: previewPath }],
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
  return approvalMode
}

function geminiWriteModeRequiresBridge(scope: ChatScope | undefined, approvalMode: string): boolean {
  return scope !== 'global' && approvalMode !== 'plan'
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
    '/opt/homebrew/opt/ripgrep/bin',
    '/opt/homebrew/bin',
    '/usr/local/opt/ripgrep/bin',
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
    TERM: process.env.TERM || 'xterm-256color',
    COLORTERM: process.env.COLORTERM || 'truecolor',
    ...(activeRuntimeProfileEnv(extra) || {}),
    ...extra
  }
}

function activeRuntimeProfileEnv(extra: Record<string, string>): Record<string, string> | null {
  const rawProfileId = extra.AGENTBENCH_RUNTIME_PROFILE_ID
  if (!rawProfileId) return null
  const profile = AppStore.getRuntimeProfiles().find((item) => item.id === rawProfileId)
  return profile?.env || null
}

function runtimeSettings(base: AppSettings, profile?: RuntimeProfile | null): AppSettings {
  if (!profile?.agenticServices) return base
  return {
    ...base,
    agenticServices: {
      ...(base.agenticServices || {}),
      ...profile.agenticServices
    }
  }
}

function resolveRuntimeProfileForPayload(payload: AgentRunPayload): RuntimeProfile | undefined {
  if (!payload.runtimeProfileId) return undefined
  const profile = AppStore.getRuntimeProfiles(payload.provider).find((candidate) => candidate.id === payload.runtimeProfileId)
  if (!profile) {
    throw new Error(`Runtime profile was not found: ${payload.runtimeProfileId}`)
  }
  if (profile.provider !== payload.provider) {
    throw new Error(`Runtime profile ${profile.name} is for ${profile.provider}, not ${payload.provider}.`)
  }
  if (profile.scope === 'workspace' && payload.scope === 'global') {
    throw new Error(`Runtime profile ${profile.name} is workspace-scoped and cannot run a global chat.`)
  }
  if (profile.workspaceMode === 'container') {
    throw new Error(`Runtime profile ${profile.name} uses container execution, which is not enabled in this build yet.`)
  }
  return profile
}

function applyRuntimeProfileToPayload(payload: AgentRunPayload): AgentRunPayload {
  const profile = resolveRuntimeProfileForPayload(payload)
  if (!profile) return payload
  payload.runtimeProfile = profile
  if (profile.approvalMode) {
    payload.approvalMode = profile.approvalMode
  }
  return payload
}

async function resolveCliProviderBinary(provider: ProviderId, runtimeProfile?: RuntimeProfile | null): Promise<ResolvedProviderBinary> {
  const binaryName = providerBinaryName(provider)
  const settings = AppStore.getSettings()
  const profilePath = expandHomePath(runtimeProfile?.binaryPath)
  if (profilePath) {
    if (await fileExists(profilePath)) {
      return { provider, binaryPath: profilePath, source: 'runtime_profile' }
    }
    return {
      provider,
      binaryPath: null,
      source: 'runtime_profile',
      error: `Runtime profile ${runtimeProfile?.name || runtimeProfile?.id || ''} binary was not found: ${profilePath}`
    }
  }
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
  const combined = (output.stdout + output.stderr).toLowerCase()
  if (
    combined.includes('not logged') ||
    combined.includes('not authenticated') ||
    combined.includes('unauthenticated') ||
    combined.includes('login required') ||
    combined.includes('please log') ||
    combined.includes('api key') ||
    combined.includes('apikey') ||
    combined.includes('not')
  ) return 'missing'
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

async function getAgentStatusSnapshotDirect(provider: ProviderId): Promise<any> {
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

async function getAgentMcpStatusSnapshotDirect(provider: ProviderId): Promise<any> {
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

async function getProviderCapabilityContractDirect(
  provider: ProviderId,
  workspacePath?: string,
  approvalMode?: string
): Promise<ProviderCapabilityContract> {
  const settings = AppStore.getSettings()
  const [status, mcpStatus, geminiBridgeStatus] = await Promise.all([
    getAgentStatusSnapshotDirect(provider).catch((error) => ({
      provider,
      available: false,
      setupRequired: true,
      error: error instanceof Error ? error.message : String(error)
    })),
    getAgentMcpStatusSnapshotDirect(provider).catch((error) => ({
      provider,
      available: false,
      error: error instanceof Error ? error.message : String(error)
    })),
    provider === 'gemini' ? getGeminiMcpBridgeStatus({ autoRepairIfEnabled: true }).catch((error) => ({
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

async function getAgentStatusSnapshot(provider: ProviderId): Promise<any> {
  return providerAdapters.require(provider).getStatus()
}

async function getAgentMcpStatusSnapshot(provider: ProviderId): Promise<any> {
  return providerAdapters.require(provider).getMcpStatus()
}

async function getProviderCapabilityContract(
  provider: ProviderId,
  workspacePath?: string,
  approvalMode?: string
): Promise<ProviderCapabilityContract> {
  const adapter = providerAdapters.require(provider)
  const contract = await adapter.getCapabilityContract({ workspacePath, approvalMode })
  const preflight = providerPreflightService.evaluate(
    { provider, workspacePath, approvalMode },
    contract,
    adapter
  )
  return {
    ...contract,
    warnings: preflight.chips
  }
}

function getProviderAdapterDescriptors(): ProviderAdapterDescriptor[] {
  return providerAdapters.descriptors()
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

function encryptApiKey(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!safeStorage.isEncryptionAvailable()) return trimmed
  return safeStorage.encryptString(trimmed).toString('base64')
}

function decryptApiKey(stored?: string | null): string | null {
  if (!stored) return null
  if (!safeStorage.isEncryptionAvailable()) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return null
  }
}

function getStoredClaudeApiKey(): string | null {
  return decryptApiKey(AppStore.getSettings().claudeApiKey)
}

function getStoredKimiApiKey(): string | null {
  return decryptApiKey(AppStore.getSettings().kimiApiKey)
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

const GEMINI_OAUTH_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com'
const GEMINI_OAUTH_CLIENT_SECRET = '__OAUTH_SECRET_REMOVED__'
const GEMINI_QUOTA_FRESH_TTL_MS = 90_000
const GEMINI_QUOTA_STALE_TTL_MS = 30 * 60_000
const GEMINI_OAUTH_REFRESH_BUFFER_MS = 5 * 60_000
const GEMINI_OAUTH_REFRESH_RETRY_MS = 60_000

let geminiQuotaCache: { snapshot: any; fetchedAt: number } | null = null
let geminiRefreshedToken: { accessToken: string; expiresAt: number } | null = null
let geminiRefreshPromise: Promise<string | null> | null = null
let geminiLastRefreshFailureAt = 0

function geminiCliRootPath(): string {
  const configured = process.env.GEMINI_CLI_HOME || process.env.GEMINI_HOME
  return configured && configured.trim() ? expandHomePath(configured.trim()) : join(os.homedir(), '.gemini')
}

async function readGeminiOAuthCredentials(): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number } | null> {
  try {
    const raw = await fs.readFile(join(geminiCliRootPath(), 'oauth_creds.json'), 'utf8')
    const parsed = JSON.parse(raw)
    const accessToken = String(parsed?.access_token || '').trim()
    if (!accessToken) return null
    const refreshToken = typeof parsed?.refresh_token === 'string' ? parsed.refresh_token.trim() : undefined
    const expiryDate = Number(parsed?.expiry_date || 0)
    return {
      accessToken,
      refreshToken: refreshToken || undefined,
      expiresAt: Number.isFinite(expiryDate) && expiryDate > 0 ? expiryDate : undefined
    }
  } catch {
    return null
  }
}

async function refreshGeminiAccessToken(refreshToken: string): Promise<string | null> {
  if (geminiRefreshPromise) {
    return geminiRefreshPromise
  }
  geminiRefreshPromise = (async () => {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json'
        },
        body: new URLSearchParams({
          client_id: GEMINI_OAUTH_CLIENT_ID,
          client_secret: GEMINI_OAUTH_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        })
      })
      if (!response.ok) {
        geminiLastRefreshFailureAt = Date.now()
        return null
      }
      const payload = await response.json()
      const accessToken = String(payload?.access_token || '').trim()
      if (!accessToken) {
        geminiLastRefreshFailureAt = Date.now()
        return null
      }
      const expiresInSeconds = Math.max(60, Number(payload?.expires_in || 3600))
      geminiRefreshedToken = {
        accessToken,
        expiresAt: Date.now() + expiresInSeconds * 1000
      }
      geminiLastRefreshFailureAt = 0
      return accessToken
    } catch {
      geminiLastRefreshFailureAt = Date.now()
      return null
    } finally {
      geminiRefreshPromise = null
    }
  })()
  return geminiRefreshPromise
}

async function getGeminiAccessToken(): Promise<string | null> {
  if (geminiRefreshedToken && Date.now() + GEMINI_OAUTH_REFRESH_BUFFER_MS < geminiRefreshedToken.expiresAt) {
    return geminiRefreshedToken.accessToken
  }

  const credentials = await readGeminiOAuthCredentials()
  if (!credentials) return null

  if (!credentials.expiresAt || Date.now() + GEMINI_OAUTH_REFRESH_BUFFER_MS < credentials.expiresAt) {
    return credentials.accessToken
  }

  if (!credentials.refreshToken || Date.now() - geminiLastRefreshFailureAt < GEMINI_OAUTH_REFRESH_RETRY_MS) {
    return credentials.accessToken
  }

  return await refreshGeminiAccessToken(credentials.refreshToken) || credentials.accessToken
}

function parseGeminiQuotaReset(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

function geminiQuotaPriority(modelId: string): number {
  const id = modelId.toLowerCase()
  const generation = id.includes('3.1') ? 0 : id.includes('3-') || id.endsWith('-3') ? 10 : id.includes('2.5') ? 20 : 30
  const family = id.includes('flash-lite') ? 2 : id.includes('flash') ? 1 : id.includes('pro') ? 0 : 3
  return generation + family
}

function geminiQuotaDisplayName(modelId: string): string {
  const id = modelId.toLowerCase()
  const family = id.includes('flash-lite') ? 'Flash Lite' : id.includes('flash') ? 'Flash' : id.includes('pro') ? 'Pro' : modelId
  const generation = id.includes('3.1') ? '3.1' : id.includes('3-') || id.endsWith('-3') ? '3' : id.includes('2.5') ? '2.5' : ''
  const base = [family, generation].filter(Boolean).join(' ')
  return id.includes('preview') ? `${base} (preview)` : base
}

function normalizeGeminiQuotaSnapshot(payload: any): any {
  const buckets = Array.isArray(payload?.buckets) ? payload.buckets : []
  const sorted = buckets.slice().sort((a: any, b: any) => {
    const aModel = String(a?.modelId || '')
    const bModel = String(b?.modelId || '')
    const priorityDelta = geminiQuotaPriority(aModel) - geminiQuotaPriority(bModel)
    if (priorityDelta !== 0) return priorityDelta
    const aUsed = 1 - Number(a?.remainingFraction ?? 1)
    const bUsed = 1 - Number(b?.remainingFraction ?? 1)
    return bUsed - aUsed
  })
  const windows = sorted.flatMap((bucket: any, index: number) => {
    const modelId = String(bucket?.modelId || '').trim()
    const remainingFraction = Number(bucket?.remainingFraction)
    if (!modelId || !Number.isFinite(remainingFraction)) return []
    const remainingPercent = Math.max(0, Math.min(100, remainingFraction * 100))
    return [{
      id: `gemini-${modelId || index}`,
      label: geminiQuotaDisplayName(modelId),
      runs: 0,
      totalTokens: 0,
      limitLabel: `${Math.round(remainingPercent)}% remaining`,
      resetAt: parseGeminiQuotaReset(bucket?.resetTime),
      trackingOnly: false,
      usedPercent: remainingPercent,
      sourceModelId: modelId
    }]
  })
  return {
    provider: 'gemini',
    source: 'gemini-live-quota',
    configured: true,
    fetchedAt: new Date().toISOString(),
    windows
  }
}

async function fetchGeminiUsageSnapshot(): Promise<any> {
  const now = Date.now()
  if (geminiQuotaCache && now - geminiQuotaCache.fetchedAt < GEMINI_QUOTA_FRESH_TTL_MS) {
    return geminiQuotaCache.snapshot
  }

  const accessToken = await getGeminiAccessToken()
  if (!accessToken) {
    return {
      provider: 'gemini',
      source: 'gemini-live-quota',
      configured: false,
      error: 'Gemini OAuth credentials were not found. Run Gemini CLI once to refresh ~/.gemini/oauth_creds.json.'
    }
  }

  try {
    const response = await fetch('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ project: 'default' })
    })
    if (!response.ok) {
      throw new Error(`Gemini live quota endpoint returned HTTP ${response.status}.`)
    }
    const payload = await response.json()
    const snapshot = normalizeGeminiQuotaSnapshot(payload)
    geminiQuotaCache = { snapshot, fetchedAt: Date.now() }
    return snapshot
  } catch (error) {
    if (geminiQuotaCache && now - geminiQuotaCache.fetchedAt < GEMINI_QUOTA_STALE_TTL_MS) {
      return {
        ...geminiQuotaCache.snapshot,
        stale: true,
        error: error instanceof Error ? error.message : 'Gemini live quota fetch failed.'
      }
    }
    return {
      provider: 'gemini',
      source: 'gemini-live-quota',
      configured: true,
      error: error instanceof Error ? error.message : 'Gemini live quota fetch failed.'
    }
  }
}

const KIMI_USAGE_FRESH_TTL_MS = 90_000
const KIMI_USAGE_STALE_TTL_MS = 30 * 60_000
let kimiUsageCache: { snapshot: any; fetchedAt: number } | null = null

async function readKimiOAuthAccessToken(): Promise<string | null> {
  try {
    const raw = await fs.readFile(join(os.homedir(), '.kimi', 'credentials', 'kimi-code.json'), 'utf8')
    const parsed = JSON.parse(raw)
    const accessToken = String(parsed?.access_token || '').trim()
    if (!accessToken) return null
    const expiresAt = Number(parsed?.expires_at || 0)
    if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt * 1000 <= Date.now()) {
      return null
    }
    return accessToken
  } catch {
    return null
  }
}

async function getKimiUsageAccessToken(): Promise<string | null> {
  return getStoredKimiApiKey() || await readKimiOAuthAccessToken()
}

function numericUsageValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function kimiDurationLabel(window: any): string {
  const duration = numericUsageValue(window?.duration)
  const unit = String(window?.timeUnit || window?.time_unit || '').toUpperCase()
  if (!duration || !unit) return 'Rolling'
  const rounded = Math.round(duration)
  if (unit.includes('MINUTE')) {
    return rounded % 60 === 0 ? `${Math.round(rounded / 60)}H` : `${rounded}M`
  }
  if (unit.includes('HOUR')) {
    if (rounded === 5) return '5H'
    return `${rounded}H`
  }
  if (unit.includes('DAY')) {
    if (rounded === 7) return 'Weekly'
    return `${rounded}D`
  }
  return 'Rolling'
}

function kimiQuotaWindow(id: string, label: string, detail: any) {
  const limit = numericUsageValue(detail?.limit)
  const remaining = numericUsageValue(detail?.remaining)
  if (limit === undefined && remaining === undefined) return null
  const remainingPercent = limit && limit > 0 && remaining !== undefined
    ? Math.max(0, Math.min(100, (remaining / limit) * 100))
    : 100
  const limitLabel = limit && remaining !== undefined
    ? `${Math.round(remaining).toLocaleString()} / ${Math.round(limit).toLocaleString()} remaining`
    : remaining !== undefined
      ? `${Math.round(remaining).toLocaleString()} remaining`
      : `${Math.round(remainingPercent)}% remaining`
  return {
    id,
    label,
    runs: 0,
    totalTokens: 0,
    limitLabel,
    resetAt: parseGeminiQuotaReset(detail?.resetTime ?? detail?.reset_time ?? detail?.resetAt ?? detail?.reset_at),
    trackingOnly: false,
    usedPercent: remainingPercent,
    remainingPercent
  }
}

function normalizeKimiUsageSnapshot(payload: any): any {
  const windows: any[] = []
  const limits = Array.isArray(payload?.limits) ? payload.limits : []
  limits.forEach((limit: any, index: number) => {
    const detail = limit?.detail && typeof limit.detail === 'object' ? limit.detail : limit
    const windowEntry = kimiQuotaWindow(`kimi-limit-${index}`, kimiDurationLabel(limit?.window), detail)
    if (windowEntry) windows.push(windowEntry)
  })
  if (payload?.usage && typeof payload.usage === 'object') {
    const weekly = kimiQuotaWindow('kimi-weekly', 'Weekly', payload.usage)
    if (weekly) windows.push(weekly)
  }
  return {
    provider: 'kimi',
    source: 'kimi-live-usage',
    configured: true,
    fetchedAt: new Date().toISOString(),
    windows
  }
}

async function fetchKimiUsageSnapshot(): Promise<any> {
  const now = Date.now()
  if (kimiUsageCache && now - kimiUsageCache.fetchedAt < KIMI_USAGE_FRESH_TTL_MS) {
    return kimiUsageCache.snapshot
  }

  const accessToken = await getKimiUsageAccessToken()
  if (!accessToken) {
    return {
      provider: 'kimi',
      source: 'kimi-live-usage',
      configured: false,
      error: 'Kimi credentials were not found. Run Kimi Code once or configure a Kimi API token.'
    }
  }

  try {
    const response = await fetch('https://api.kimi.com/coding/v1/usages', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    })
    if (!response.ok) {
      throw new Error(`Kimi usage endpoint returned HTTP ${response.status}.`)
    }
    const payload = await response.json()
    const snapshot = normalizeKimiUsageSnapshot(payload)
    kimiUsageCache = { snapshot, fetchedAt: Date.now() }
    return snapshot
  } catch (error) {
    if (kimiUsageCache && now - kimiUsageCache.fetchedAt < KIMI_USAGE_STALE_TTL_MS) {
      return {
        ...kimiUsageCache.snapshot,
        stale: true,
        error: error instanceof Error ? error.message : 'Kimi usage fetch failed.'
      }
    }
    return {
      provider: 'kimi',
      source: 'kimi-live-usage',
      configured: true,
      error: error instanceof Error ? error.message : 'Kimi usage fetch failed.'
    }
  }
}

const CLAUDE_USAGE_FRESH_TTL_MS = 2 * 60_000
const CLAUDE_USAGE_STALE_TTL_MS = 4 * 60 * 60_000
let claudeUsageCache: { snapshot: any; fetchedAt: number } | null = null

interface ClaudeOAuthCredential {
  accessToken: string
  subscriptionType?: string
  expiresAt?: number
}

async function readClaudeCredentialsFile(): Promise<ClaudeOAuthCredential | null> {
  const candidates = [
    join(os.homedir(), '.claude', '.credentials.json'),
    join(os.homedir(), '.claude', 'credentials.json'),
    join(os.homedir(), '.config', 'claude', 'credentials.json')
  ]
  for (const path of candidates) {
    try {
      const raw = await fs.readFile(path, 'utf8')
      const parsed = JSON.parse(raw)
      const inner = parsed?.claudeAiOauth || parsed?.claude_ai_oauth || parsed
      const accessToken = String(inner?.accessToken || inner?.access_token || '').trim()
      if (!accessToken) continue
      const expiresAt = Number(inner?.expiresAt || inner?.expires_at || 0)
      if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt < Date.now()) {
        continue
      }
      const subscriptionType = String(inner?.subscriptionType || inner?.subscription_type || '').toLowerCase() || undefined
      return { accessToken, subscriptionType, expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : undefined }
    } catch {
      continue
    }
  }
  return null
}

async function readClaudeKeychainCredential(): Promise<ClaudeOAuthCredential | null> {
  if (process.platform !== 'darwin') return null
  return new Promise((resolve) => {
    try {
      const { spawn } = require('child_process') as typeof import('child_process')
      const proc = spawn('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'])
      let out = ''
      proc.stdout.on('data', (chunk: Buffer) => { out += chunk.toString('utf8') })
      proc.on('error', () => resolve(null))
      proc.on('close', (code: number) => {
        if (code !== 0) return resolve(null)
        const raw = out.trim()
        if (!raw) return resolve(null)
        try {
          const parsed = JSON.parse(raw)
          const inner = parsed?.claudeAiOauth || parsed?.claude_ai_oauth || parsed
          const accessToken = String(inner?.accessToken || inner?.access_token || raw).trim()
          if (!accessToken) return resolve(null)
          const expiresAt = Number(inner?.expiresAt || inner?.expires_at || 0)
          if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt < Date.now()) {
            return resolve(null)
          }
          const subscriptionType = String(inner?.subscriptionType || inner?.subscription_type || '').toLowerCase() || undefined
          resolve({ accessToken, subscriptionType, expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : undefined })
        } catch {
          resolve({ accessToken: raw })
        }
      })
    } catch {
      resolve(null)
    }
  })
}

async function readClaudeLegacyTokenFile(): Promise<ClaudeOAuthCredential | null> {
  try {
    const raw = await fs.readFile(join(os.homedir(), '.claude', '.oauth_token'), 'utf8')
    const token = raw.trim()
    if (!token) return null
    return { accessToken: token }
  } catch {
    return null
  }
}

async function getClaudeOAuthCredential(): Promise<ClaudeOAuthCredential | null> {
  return (
    (await readClaudeCredentialsFile()) ||
    (await readClaudeKeychainCredential()) ||
    (await readClaudeLegacyTokenFile())
  )
}

function parseClaudeIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}

function claudeUsageWindow(id: string, label: string, payload: any): any | null {
  if (!payload || typeof payload !== 'object') return null
  const utilization = numericUsageValue(payload.utilization)
  if (utilization === undefined) return null
  const usedPercent = Math.max(0, Math.min(100, utilization))
  const remainingPercent = Math.max(0, 100 - usedPercent)
  return {
    id,
    label,
    runs: 0,
    totalTokens: 0,
    limitLabel: `${Math.round(remainingPercent)}% remaining`,
    resetAt: parseClaudeIsoDate(payload.resetAt ?? payload.reset_at),
    trackingOnly: false,
    usedPercent
  }
}

function normalizeClaudeUsageSnapshot(payload: any, credential: ClaudeOAuthCredential): any {
  const windows: any[] = []
  const fiveHour = claudeUsageWindow('claude-5h', 'Session', payload?.fiveHour ?? payload?.five_hour)
  if (fiveHour) windows.push(fiveHour)
  const sevenDay = claudeUsageWindow('claude-weekly', 'Weekly', payload?.sevenDay ?? payload?.seven_day)
  if (sevenDay) windows.push(sevenDay)
  const sevenDaySonnet = payload?.sevenDaySonnet ?? payload?.seven_day_sonnet
  if (sevenDaySonnet?.resetAt || sevenDaySonnet?.reset_at) {
    const sonnetWindow = claudeUsageWindow('claude-weekly-sonnet', 'Sonnet Weekly', sevenDaySonnet)
    if (sonnetWindow) windows.push(sonnetWindow)
  }
  const sevenDayOpus = payload?.sevenDayOpus ?? payload?.seven_day_opus
  if (sevenDayOpus?.resetAt || sevenDayOpus?.reset_at) {
    const opusWindow = claudeUsageWindow('claude-weekly-opus', 'Opus Weekly', sevenDayOpus)
    if (opusWindow) windows.push(opusWindow)
  }
  return {
    provider: 'claude',
    source: 'claude-oauth-usage',
    configured: true,
    subscriptionType: credential.subscriptionType,
    fetchedAt: new Date().toISOString(),
    windows
  }
}

async function fetchClaudeUsageSnapshot(): Promise<any> {
  const now = Date.now()
  if (claudeUsageCache && now - claudeUsageCache.fetchedAt < CLAUDE_USAGE_FRESH_TTL_MS) {
    return claudeUsageCache.snapshot
  }

  const credential = await getClaudeOAuthCredential()
  if (!credential) {
    return {
      provider: 'claude',
      source: 'claude-oauth-usage',
      configured: false,
      error: 'Claude OAuth credentials were not found. Run Claude Code once to populate ~/.claude/.credentials.json.'
    }
  }

  try {
    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        Accept: 'application/json'
      }
    })
    if (!response.ok) {
      throw new Error(`Claude OAuth usage endpoint returned HTTP ${response.status}.`)
    }
    const payload = await response.json()
    const snapshot = normalizeClaudeUsageSnapshot(payload, credential)
    claudeUsageCache = { snapshot, fetchedAt: Date.now() }
    return snapshot
  } catch (error) {
    if (claudeUsageCache && now - claudeUsageCache.fetchedAt < CLAUDE_USAGE_STALE_TTL_MS) {
      return {
        ...claudeUsageCache.snapshot,
        stale: true,
        error: error instanceof Error ? error.message : 'Claude OAuth usage fetch failed.'
      }
    }
    return {
      provider: 'claude',
      source: 'claude-oauth-usage',
      configured: true,
      error: error instanceof Error ? error.message : 'Claude OAuth usage fetch failed.'
    }
  }
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
  const lowered = trimmed.toLowerCase()
  if (provider === 'kimi') {
    if (!lowered) return KIMI_DEFAULT_MODEL
    const alias = KIMI_CLI_MODEL_ALIASES.get(lowered)
    if (alias) return alias
    if (KIMI_CLI_MODEL_IDS.has(lowered)) return lowered
    return KIMI_DEFAULT_MODEL
  }
  if (!trimmed || trimmed === 'cli-default' || trimmed === 'custom' || trimmed === 'best') return 'default'
  if (provider === 'claude') {
    if (['default', 'sonnet', 'opus', 'haiku'].includes(trimmed)) return trimmed
    if (trimmed.startsWith('claude-')) return trimmed  // pass full model IDs (e.g. claude-opus-4-7)
  }
  return trimmed || 'default'
}

function appendKimiThinkingArgs(args: string[], kimiThinking?: boolean | null): void {
  args.push(kimiThinking === false ? '--no-thinking' : '--thinking')
}

function kimiCliModelArg(model: string): string | null {
  const normalized = model.trim().toLowerCase()
  if (!normalized || normalized === 'default' || normalized === KIMI_DEFAULT_MODEL) return null
  return model
}

function appendKimiModelArgs(args: string[], model: string): void {
  const cliModel = kimiCliModelArg(model)
  if (cliModel) args.push('--model', cliModel)
}

function claudePermissionModeForApproval(approvalMode?: string): string {
  if (approvalMode === 'plan') return 'plan'
  return 'acceptEdits'
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

function providerUsageNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key]
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

function firstProviderUsageNumber(source: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = providerUsageNumber(source, key)
    if (value > 0) return value
  }
  return 0
}

function sumProviderUsageNumbers(source: Record<string, unknown>, keys: string[]): number {
  return keys.reduce((total, key) => total + providerUsageNumber(source, key), 0)
}

function normalizeProviderUsage(provider: ProviderId, usage: any): any {
  if (!isRecord(usage)) return usage

  const inputBase = provider === 'kimi'
    ? firstProviderUsageNumber(usage, ['input_other', 'input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens', 'input'])
    : firstProviderUsageNumber(usage, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens', 'input', 'input_other'])
  const cacheInput = sumProviderUsageNumbers(usage, [
    'cache_creation_input_tokens',
    'cache_read_input_tokens',
    'cached_input_tokens',
    'input_cache_creation',
    'input_cache_read'
  ])
  const audioInput = sumProviderUsageNumbers(usage, ['input_audio_tokens'])
  const outputBase = firstProviderUsageNumber(usage, ['output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens', 'output'])
  const outputAudio = sumProviderUsageNumbers(usage, ['output_audio_tokens'])
  const inputTokens = Math.trunc(inputBase + cacheInput + audioInput)
  const outputTokens = Math.trunc(outputBase + outputAudio)
  const explicitTotal = firstProviderUsageNumber(usage, ['total_tokens', 'totalTokens', 'all_tokens', 'total'])
  const computedTotal = inputTokens + outputTokens
  const totalTokens = Math.trunc(explicitTotal > 0 ? explicitTotal : computedTotal)

  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) return usage

  return {
    ...usage,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    _agentbench_input_includes_cache: cacheInput > 0 || audioInput > 0 || provider === 'kimi'
  }
}

function extractProviderUsage(provider: ProviderId, event: any): any {
  const usage = event?.usage || event?.message?.usage || event?.stats || event?.params?.payload?.token_usage || event?.params?.token_usage
  if (!usage) return null
  return normalizeProviderUsage(provider, usage)
}

function extractProviderSessionId(event: any): string | null {
  const candidates = [
    event?.session_id,
    event?.sessionId,
    event?.session?.id,
    event?.session?.session_id,
    event?.message?.session_id,
    event?.params?.session_id,
    event?.result?.session_id,
    event?.result?.sessionId,
    event?.result?.session?.id,
    event?.result?.session?.session_id
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

function updateCliProviderSession(
  state: CliProviderStreamState,
  sessionId: string | null | undefined,
  emitRunStarted = false
): boolean {
  const normalized = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (!normalized || normalized === state.providerSessionId) return false
  state.providerSessionId = normalized
  if (state.appRunId) {
    runManager.registerProviderSession(state.appRunId, normalized)
    runManager.setState(state.appRunId, state)
  }
  if (emitRunStarted) {
    sendAgentCompatLine(state.sender, state.provider, {
      type: 'init',
      session_id: normalized,
      model: state.model,
      timestamp: new Date().toISOString(),
      provider: state.provider,
      fallback: state.fallback
    }, state)
  }
  return true
}

function claudeProgrammaticUsageWarning(runtime: 'sdk' | 'cli-print', usesApiKey: boolean): string {
  const runtimeLabel = runtime === 'sdk' ? 'Claude Agent SDK' : 'Claude Code CLI print mode (`claude -p`)'
  if (usesApiKey) {
    return `${runtimeLabel} is a programmatic Claude path. AGBench is using the saved Anthropic API key for this run, so usage is billed through API/PAYG rather than normal interactive Claude Code subscription limits.`
  }
  return `${runtimeLabel} is a programmatic Claude path. Anthropic says programmatic Claude usage uses separate Agent SDK credit from 2026-06-15, not the normal interactive Claude Code subscription limit. Use interactive Claude in a terminal when you need native Claude Code subscription-limit behavior.`
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
  updateCliProviderSession(state, sessionId)
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
  options: { fallback: boolean; warning?: string; extraEnv?: Record<string, string> } = { fallback: true }
) {
  const route = routeWithRunId(provider, payload)
  const cwd = payload.workspace!
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
  registerRunSession(provider, event.sender, route, payload.scope === 'global' ? undefined : payload.workspace, state, payload.providerSessionId || null)
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
    cwd,
    shell: false,
    env: createCliEnv({ FORCE_COLOR: '0', NO_COLOR: '1', AGENTBENCH_RUNTIME_PROFILE_ID: payload.runtimeProfileId || '', ...(options.extraEnv || {}) }, command)
  })
  child.stdin?.end()
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

function claudeAgenticServiceForTool(toolName: string): AgenticServiceId | null {
  const normalized = toolName.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'bash' || normalized === 'shell' || normalized === 'run_shell_command' || normalized.includes('shell_command')) {
    return 'shellCommands'
  }
  if (
    normalized === 'write' ||
    normalized === 'edit' ||
    normalized === 'multiedit' ||
    normalized === 'notebookedit' ||
    normalized === 'writefile' ||
    normalized === 'strreplacefile' ||
    normalized === 'replace' ||
    normalized === 'write_file' ||
    normalized.includes('write_file') ||
    normalized.includes('replace_file') ||
    normalized.includes('str_replace')
  ) {
    return 'fileChanges'
  }
  if (normalized.startsWith('mcp__') || normalized.includes('__')) {
    return 'mcpTools'
  }
  return null
}

function normalizeClaudeCanUseToolArgs(toolNameOrRequest: unknown, input?: unknown): { toolName: string; input: unknown } {
  if (typeof toolNameOrRequest === 'string') {
    return { toolName: toolNameOrRequest, input }
  }
  if (isRecord(toolNameOrRequest)) {
    const toolName = String(
      toolNameOrRequest.toolName ||
      toolNameOrRequest.tool_name ||
      toolNameOrRequest.name ||
      toolNameOrRequest.tool ||
      'tool'
    )
    return {
      toolName,
      input: input ?? toolNameOrRequest.input ?? toolNameOrRequest.parameters ?? toolNameOrRequest.params ?? {}
    }
  }
  return { toolName: 'tool', input }
}

function previewClaudeToolInput(input: unknown): string {
  try {
    if (typeof input === 'string') return input.slice(0, 2_000)
    return JSON.stringify(input ?? {}, null, 2).slice(0, 2_000)
  } catch {
    return String(input ?? '').slice(0, 2_000)
  }
}

function claudeToolApprovalPreview(toolName: string, input: unknown, service: AgenticServiceId): any {
  if (service === 'shellCommands') {
    const command = isRecord(input)
      ? String(input.command || input.cmd || input.description || previewClaudeToolInput(input))
      : previewClaudeToolInput(input)
    return {
      kind: 'command',
      command,
      params: input
    }
  }
  if (service === 'fileChanges') {
    const path = isRecord(input)
      ? String(input.file_path || input.filePath || input.path || input.notebook_path || '')
      : ''
    return {
      kind: 'fileChange',
      changes: path ? [{ kind: toolName.toLowerCase().includes('write') ? 'write' : 'edit', path }] : [],
      patchPreview: previewClaudeToolInput(input)
    }
  }
  return {
    kind: 'tool',
    toolName,
    params: input
  }
}

async function canUseClaudeSdkTool(
  sender: Electron.WebContents,
  route: AgentRunRoute,
  payload: AgentRunPayload,
  toolNameOrRequest: unknown,
  input?: unknown
): Promise<{ behavior: 'allow' } | { behavior: 'deny'; message: string }> {
  const { toolName, input: normalizedInput } = normalizeClaudeCanUseToolArgs(toolNameOrRequest, input)
  const service = claudeAgenticServiceForTool(toolName)
  if (!service) {
    return { behavior: 'allow' }
  }
  const allowed = await requestAgenticServiceApproval(
    sender,
    'claude',
    service,
    payload.scope === 'global' ? undefined : payload.workspace,
    {
      method: 'claude/canUseTool',
      title: service === 'shellCommands'
        ? 'Approve Claude shell command'
        : service === 'fileChanges'
          ? 'Approve Claude file change'
          : 'Approve Claude tool call',
      body: toolName,
      preview: claudeToolApprovalPreview(toolName, normalizedInput, service),
      runId: route.appRunId
    }
  )
  return allowed
    ? { behavior: 'allow' }
    : { behavior: 'deny', message: `AGBench denied Claude tool ${toolName}.` }
}

async function tryRunClaudeSdk(event: Electron.IpcMainInvokeEvent, payload: AgentRunPayload, sdk: any, route: AgentRunRoute): Promise<boolean> {
  const query = sdk?.query || sdk?.default?.query
  if (typeof query !== 'function') return false
  const model = normalizeCliProviderModel('claude', payload.model)
  const claudeApiKey = getStoredClaudeApiKey()
  // In a packaged Electron build the SDK's bundled CLI lives inside app.asar,
  // which appears as a regular file to subprocess spawn — the SDK then fails
  // with ENOTDIR. Point it at the system-installed Claude binary instead so it
  // can spawn a real executable. We resolve this lazily so dev (unpackaged)
  // continues to use whatever the SDK ships with.
  let pathToClaudeCodeExecutable: string | undefined
  if (app.isPackaged) {
    try {
      const resolvedClaude = await resolveCliProviderBinary('claude', payload.runtimeProfile)
      if (resolvedClaude.binaryPath) {
        pathToClaudeCodeExecutable = resolvedClaude.binaryPath
      } else {
        // No system binary either; skip the SDK path so we fail over cleanly
        // to the CLI fallback (which surfaces a useful setup-required error).
        return false
      }
    } catch {
      return false
    }
  }
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
  registerRunSession('claude', event.sender, route, payload.scope === 'global' ? undefined : payload.workspace, state, payload.providerSessionId || null)
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
  sendAgentCompatLine(event.sender, 'claude', {
    type: 'provider_warning',
    provider: 'claude',
    message: claudeProgrammaticUsageWarning('sdk', Boolean(claudeApiKey)),
    runtime: 'agent-sdk',
    billingMode: claudeApiKey ? 'api-key-payg' : 'agent-sdk-credit',
    fallback: false
  }, state)

  const thinkingBudgetSdk = payload.claudeReasoningEffort && payload.claudeReasoningEffort !== 'off'
    ? (CLAUDE_THINKING_BUDGET[payload.claudeReasoningEffort] ?? null)
    : null
  const stream = query({
    prompt: payload.prompt,
    options: {
      cwd: payload.workspace!,
      model: model === 'default' ? undefined : model,
      permissionMode: claudePermissionModeForApproval(payload.approvalMode),
      resume: payload.providerSessionId || undefined,
      abortController: controller,
      canUseTool: (toolNameOrRequest: unknown, input?: unknown) => canUseClaudeSdkTool(event.sender, route, payload, toolNameOrRequest, input),
      ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
      ...(payload.imagePaths?.length ? { images: payload.imagePaths } : {}),
      ...(thinkingBudgetSdk ? { maxThinkingTokens: thinkingBudgetSdk } : {}),
      ...(claudeApiKey ? { env: { ANTHROPIC_API_KEY: claudeApiKey } } : {})
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
  const route = routeWithRunId('claude', payload)
  const sdk = await loadOptionalClaudeSdk()
  if (sdk) {
    try {
      if (await tryRunClaudeSdk(event, payload, sdk, route)) return
    } catch (error) {
      sendAgentCompatError(event.sender, 'claude', `Claude Agent SDK failed; falling back to Claude Code CLI. Reason: ${error instanceof Error ? error.message : String(error)}`, route)
    } finally {
      cliProviderAbortControllers.delete('claude')
    }
  }

  const resolved = await resolveCliProviderBinary('claude', payload.runtimeProfile)
  if (!resolved.binaryPath) {
    runManager.finish(route.appRunId, 'failed')
    sendAgentCompatError(event.sender, 'claude', resolved.error || 'Claude CLI is not configured.', route)
    sendAgentCompatLine(event.sender, 'claude', {
      type: 'result',
      status: 'failed',
      stats: {},
      provider: 'claude',
      setupRequired: true
    }, route)
    sendAgentCompatExit(event.sender, 'claude', 1, route)
    return
  }

  const model = normalizeCliProviderModel('claude', payload.model)
  const args = buildClaudeCliArgs({
    prompt: payload.prompt,
    permissionMode: claudePermissionModeForApproval(payload.approvalMode),
    model,
    providerSessionId: payload.providerSessionId || null,
    claudeReasoningEffort: payload.claudeReasoningEffort || null,
    imagePaths: payload.imagePaths || null
  })
  const claudeKey = getStoredClaudeApiKey()
  runCliProviderProcess(event, 'claude', resolved.binaryPath, args, payload, {
    fallback: true,
    warning: sdk
      ? `Using Claude Code CLI fallback for this run. ${claudeProgrammaticUsageWarning('cli-print', Boolean(claudeKey))}`
      : `Claude Agent SDK is not bundled in this app build; using Claude Code CLI stream-json fallback for this run. ${claudeProgrammaticUsageWarning('cli-print', Boolean(claudeKey))}`,
    extraEnv: claudeKey ? { ANTHROPIC_API_KEY: claudeKey } : undefined
  })
}

function respondToKimiWireRequest(child: ChildProcess, requestId: string | number, result: any) {
  child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, result }) + '\n')
}

const KIMI_WIRE_PROTOCOL_FALLBACK = '1.9'
const KIMI_WIRE_PROTOCOL_INFO_TIMEOUT_MS = 3_000

function extractKimiWireProtocol(value: unknown, depth = 0): string | null {
  if (depth > 4 || !value) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return /^\d+(?:\.\d+){0,2}$/.test(trimmed) ? trimmed : null
  }
  if (!isRecord(value)) return null
  const directKeys = [
    'wire_protocol_version',
    'wireProtocolVersion',
    'protocol_version',
    'protocolVersion',
    'wireVersion',
    'wire_version'
  ]
  for (const key of directKeys) {
    const extracted = extractKimiWireProtocol(value[key], depth + 1)
    if (extracted) return extracted
  }
  for (const nestedKey of ['wire', 'protocol', 'capabilities']) {
    const extracted = extractKimiWireProtocol(value[nestedKey], depth + 1)
    if (extracted) return extracted
  }
  return null
}

async function resolveKimiWireProtocol(
  binaryPath: string
): Promise<{ protocolVersion: string; source: 'cli-info' | 'fallback'; error?: string }> {
  return new Promise((resolveProtocol) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let child: ChildProcess | null = null
    const finish = (protocolVersion: string, source: 'cli-info' | 'fallback', error?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveProtocol({ protocolVersion, source, error })
    }
    const timeout = setTimeout(() => {
      child?.kill()
      finish(
        KIMI_WIRE_PROTOCOL_FALLBACK,
        'fallback',
        'Timed out reading Kimi Wire protocol metadata.'
      )
    }, KIMI_WIRE_PROTOCOL_INFO_TIMEOUT_MS)
    try {
      child = spawn(binaryPath, ['info', '--json'], {
        shell: false,
        env: createCliEnv({ FORCE_COLOR: '0', NO_COLOR: '1' }, binaryPath)
      })
    } catch (error) {
      finish(
        KIMI_WIRE_PROTOCOL_FALLBACK,
        'fallback',
        error instanceof Error ? error.message : String(error)
      )
      return
    }
    const spawned = child
    if (!spawned) {
      finish(KIMI_WIRE_PROTOCOL_FALLBACK, 'fallback', 'Kimi CLI did not start.')
      return
    }
    spawned.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
      if (stdout.length > 200_000) stdout = stdout.slice(-200_000)
    })
    spawned.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000)
    })
    spawned.on('error', (error) => {
      finish(KIMI_WIRE_PROTOCOL_FALLBACK, 'fallback', error.message)
    })
    spawned.on('close', () => {
      try {
        const parsed = stdout.trim() ? JSON.parse(stripAnsi(stdout)) : null
        const protocolVersion = extractKimiWireProtocol(parsed)
        if (protocolVersion) {
          finish(protocolVersion, 'cli-info')
          return
        }
      } catch {
        // Non-JSON output is expected for older Kimi CLIs; fall back to the known-compatible protocol.
      }
      finish(
        KIMI_WIRE_PROTOCOL_FALLBACK,
        'fallback',
        stderr.trim() || 'Kimi CLI did not expose Wire protocol metadata.'
      )
    })
  })
}

async function runKimiWireProvider(
  event: Electron.IpcMainInvokeEvent,
  payload: AgentRunPayload,
  binaryPath: string
): Promise<boolean> {
  const model = normalizeCliProviderModel('kimi', payload.model)
  const route = routeWithRunId('kimi', payload)
  const wireProtocol = await resolveKimiWireProtocol(binaryPath)
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
  registerRunSession(
    'kimi',
    event.sender,
    route,
    payload.scope === 'global' ? undefined : payload.workspace,
    state,
    payload.providerSessionId || null
  )
  void emitProviderCapabilityWarnings(
    event.sender,
    'kimi',
    payload.workspace,
    payload.approvalMode,
    state
  )

  sendAgentCompatLine(
    event.sender,
    'kimi',
    {
      type: 'init',
      session_id: state.providerSessionId || '',
      model,
      timestamp: new Date().toISOString(),
      provider: 'kimi',
      fallback: false
    },
    state
  )
  sendAgentCompatLine(
    event.sender,
    'kimi',
    {
      type: 'provider_diagnostic',
      provider: 'kimi',
      message: `Using Kimi Wire protocol ${wireProtocol.protocolVersion}${wireProtocol.source === 'fallback' ? ' (fallback)' : ''}.`,
      protocolVersion: wireProtocol.protocolVersion,
      source: wireProtocol.source,
      error: wireProtocol.error
    },
    state
  )

  const args = ['--wire', '--work-dir', payload.workspace!]
  appendKimiModelArgs(args, model)
  appendKimiThinkingArgs(args, payload.kimiThinking)
  if (payload.providerSessionId) args.push('--resume', payload.providerSessionId)

  const kimiKey = getStoredKimiApiKey()
  return new Promise((resolveWire) => {
    const child = spawn(binaryPath, args, {
      cwd: payload.workspace!,
      shell: false,
      env: createCliEnv(
        {
          FORCE_COLOR: '0',
          NO_COLOR: '1',
          AGENTBENCH_RUNTIME_PROFILE_ID: payload.runtimeProfileId || '',
          ...(kimiKey ? { MOONSHOT_API_KEY: kimiKey } : {})
        },
        binaryPath
      )
    })
    cliProviderProcesses.set('kimi', child)
    runManager.attachProcess(route.appRunId!, child)
    let stdoutBuffer = ''
    let settled = false
    let promptSent = false
    // Bug fix: every Kimi exit path MUST publish an `agent-exit` IPC
    // event, otherwise the renderer never invokes `clearActiveRunContext`
    // and the sidebar keeps painting "Running". `state.completed` flips
    // true on the prompt-response branch AND on any `handleCliProviderJsonEvent`
    // path that sees a `result`/`TurnEnd` notification, so the close
    // handler used to early-return without sending exit when it raced
    // in after a completion notification but before the final
    // `prompt-${id}` response — leaving the sidebar stuck. Track exit
    // emission explicitly so the close handler can backfill the IPC
    // event without double-firing for the happy path. Other providers
    // already publish exit unconditionally from their close handlers.
    let exitSent = false
    const emitKimiExit = (code: number | null): void => {
      if (exitSent) return
      exitSent = true
      sendAgentCompatExit(event.sender, 'kimi', code, state)
    }
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

    const sendPrompt = (): void => {
      if (promptSent) return
      promptSent = true
      if (payload.approvalMode === 'plan') {
        child.stdin?.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: `plan-${Date.now()}`,
            method: 'set_plan_mode',
            params: { enabled: true }
          }) + '\n'
        )
      }
      const promptInput: any = payload.imagePaths?.length
        ? [
            { type: 'text', text: payload.prompt },
            ...payload.imagePaths.map((imagePath) => ({
              type: 'image_url',
              image_url: { url: imagePath }
            }))
          ]
        : payload.prompt
      child.stdin?.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: promptId,
          method: 'prompt',
          params: { user_input: promptInput }
        }) + '\n'
      )
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
            updateCliProviderSession(state, extractProviderSessionId(message), true)
            sendPrompt()
            continue
          }
          if (message.id === promptId) {
            const promptError = message.error
            const promptErrorMessage = promptError
              ? typeof promptError === 'string'
                ? promptError
                : typeof promptError.message === 'string'
                  ? promptError.message
                  : JSON.stringify(promptError)
              : ''
            if (promptErrorMessage) {
              sendAgentCompatError(event.sender, 'kimi', promptErrorMessage, state)
            }
            updateCliProviderSession(state, extractProviderSessionId(message), false)
            state.completed = true
            sendAgentCompatLine(
              event.sender,
              'kimi',
              {
                type: 'result',
                status:
                  message.result?.status === 'cancelled'
                    ? 'cancelled'
                    : message.error
                      ? 'failed'
                      : 'success',
                stats: { ...(state.tokenUsage || {}), duration_ms: Date.now() - state.startedAt },
                provider: 'kimi',
                providerThreadId: state.providerSessionId || undefined,
                fallback: false
              },
              state
            )
            emitKimiExit(message.error ? 1 : 0)
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
              approvalService?.registerKimi(approvalId, {
                child,
                rpcId: message.id,
                params: message.params,
                runId: route.appRunId
              })
              runManager.registerApproval(route.appRunId, approvalId)
              scheduleApprovalTimeout({
                approvalId,
                provider: 'kimi',
                route,
                kind: 'request/ApprovalRequest'
              })
              const approvalPayload = {
                provider: 'kimi',
                appRunId: route.appRunId,
                appChatId: route.appChatId,
                id: approvalId,
                approvalId,
                requestId: message.id,
                method: 'request/ApprovalRequest',
                params: message.params,
                title: 'Approve Kimi action',
                body:
                  message.params?.payload?.description ||
                  message.params?.payload?.action ||
                  'Kimi is requesting permission to continue.',
                actions: [
                  'accept',
                  'acceptForSession',
                  'decline',
                  'cancel'
                ] as AgentApprovalAction[],
                preview: {
                  kind: 'tool',
                  toolName:
                    message.params?.payload?.sender ||
                    message.params?.payload?.action ||
                    'kimi_action',
                  params: message.params?.payload,
                  actions: [
                    'accept',
                    'acceptForSession',
                    'decline',
                    'cancel'
                  ] as AgentApprovalAction[]
                }
              }
              appendDurableRunEventForRoute(
                'kimi',
                route,
                'approval_request',
                'control',
                'Approve Kimi action',
                approvalPayload
              )
              recordApprovalLedgerRequest('kimi', route, approvalPayload, {
                metadata: { requestType, transport: 'kimi-wire' }
              })
              event.sender.send('agent-approval-request', approvalPayload)
              // Fan out a wake-push to any paired iOS device. Kimi's
              // payload.description is the cleanest user-facing summary;
              // fall back to action name or a generic phrase.
              notifyPairedDevicesOfApproval({
                approvalId,
                workspaceId: workspaceIdForApprovalPush(
                  payload.scope === 'global' ? undefined : payload.workspace
                ),
                // `appChatId` is optional on AgentRunRoute; fall back to the
                // run id and finally the approval id so the push always has
                // a routable identifier.
                threadId: route.appChatId ?? route.appRunId ?? approvalId,
                summary:
                  message.params?.payload?.description ||
                  message.params?.payload?.action ||
                  'Kimi is requesting permission to continue.'
              })
            } else if (requestType === 'QuestionRequest') {
              respondToKimiWireRequest(child, message.id, {
                response: 'User input is not available in this non-interactive run.'
              })
            } else {
              respondToKimiWireRequest(child, message.id, {
                tool_call_id: message.params?.payload?.id,
                return_value: {
                  is_error: true,
                  output: '',
                  message: 'External app tools are not wired in v1.',
                  display: []
                }
              })
            }
            continue
          }
          handleCliProviderJsonEvent(state, message)
        } catch {
          sendAgentCompatLine(
            event.sender,
            'kimi',
            { type: 'content', text: line + '\n', provider: 'kimi', fallback: false },
            state
          )
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
      const decision = decideKimiWireClose({
        settled,
        promptSent,
        stateCompleted: state.completed,
        exitAlreadyEmitted: exitSent,
        code
      })
      if (decision.ignore) return
      clearTimeout(timeout)
      if (cliProviderProcesses.get('kimi') === child) cliProviderProcesses.delete('kimi')
      if (decision.emitResultLine) {
        sendAgentCompatLine(event.sender, 'kimi', {
          type: 'result',
          status: code === 0 ? 'success' : 'failed',
          stats: { ...(state.tokenUsage || {}), duration_ms: Date.now() - state.startedAt },
          provider: 'kimi',
          fallback: false
        })
      }
      if (decision.emitExit) {
        emitKimiExit(code)
      }
      runManager.finish(route.appRunId, decision.terminalStatus)
      settled = true
      resolveWire(decision.resolveWire)
    })

    child.stdin?.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: initializeId,
        method: 'initialize',
        params: {
          protocol_version: wireProtocol.protocolVersion,
          client: { name: 'GUIGemini', version: app.getVersion() },
          capabilities: { supports_question: false, supports_plan_mode: true }
        }
      }) + '\n'
    )
  })
}

async function runKimiProvider(event: Electron.IpcMainInvokeEvent, payload: AgentRunPayload) {
  const resolved = await resolveCliProviderBinary('kimi', payload.runtimeProfile)
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
  const args = ['--print', '--plan', '--output-format', 'stream-json', '--work-dir', payload.workspace!, '--prompt', payload.prompt]
  appendKimiModelArgs(args, model)
  appendKimiThinkingArgs(args, payload.kimiThinking)
  if (payload.providerSessionId) args.push('--resume', payload.providerSessionId)
  const kimiKey = getStoredKimiApiKey()
  runCliProviderProcess(event, 'kimi', resolved.binaryPath, args, payload, {
    fallback: true,
    warning: 'Kimi Wire mode did not complete startup; using print-mode stream-json fallback for this one-shot run.',
    extraEnv: kimiKey ? { MOONSHOT_API_KEY: kimiKey } : undefined
  })
}

function getCodexClient(): CodexAppServerClient {
  if (!codexClient) {
    codexClient = new CodexAppServerClient()
  }
  // Phase I2: refresh the MCP config on every accessor call so the
  // toggle in Settings → MCP Bridge takes effect on the NEXT Codex
  // app-server start. We don't restart the running app-server when
  // the toggle flips (that would tear down in-flight threads); the
  // user reopens Codex (or relaunches AGBench) to pick up the new
  // setting. The Codex MCP integration mirrors the existing Gemini
  // gate (geminiMcpBridgeEnabled) — one user toggle, both providers.
  const settings = AppStore.getSettings()
  if (settings.geminiMcpBridgeEnabled) {
    codexClient.setMcpConfig({
      enabled: true,
      bridgeBinaryPath: process.execPath,
      bridgeArgs: [
        GEMINI_MCP_BRIDGE_ARG,
        GEMINI_MCP_SOCKET_ARG,
        geminiMcpSocketPath(),
        GEMINI_MCP_TOKEN_ARG,
        geminiMcpBrokerToken
      ],
      parentProvider: 'codex'
    })
  } else {
    codexClient.setMcpConfig(null)
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
  if (state && typeof state === 'object' && (state as GeminiToolContext).sender) {
    const context = state as GeminiToolContext
    return {
      ...context,
      scope: context.scope === 'global' ? 'global' : 'workspace',
      cwd: context.cwd || context.workspacePath || globalRunCwd()
    }
  }
  return activeGeminiToolContext
}

/**
 * Phase I2: provider-aware MCP tool context resolver. The agentbench
 * MCP server is shared across Gemini / Codex / Claude / Kimi (each CLI
 * registers it via `-c mcp_servers.agentbench.*`), and the bridge
 * subprocess stamps `parentProvider` on every broker request based on
 * the `AGENTBENCH_PARENT_PROVIDER` env var. This helper consumes that
 * stamp and returns the right run-context for the parent provider:
 *
 *  - For Gemini we still go through `getGeminiToolContext` so the
 *    Phase F3 + I1 flow (which stores the `GeminiToolContext` in the
 *    runManager session.state) is preserved.
 *  - For Codex / Claude / Kimi we derive sender + workspace + chat
 *    from the runManager directly. Their session.state shapes are
 *    provider-specific (CodexRunState etc.), but every session has a
 *    `sender`, `workspacePath`, `appChatId`, `runId` at the top level.
 *
 * Returns null when no active run for that provider exists — the MCP
 * tool call then errors back to the agent with a clear message.
 */
function getAgentToolContext(parentProvider: ProviderId, route?: AgentRunRoute | null): GeminiToolContext | null {
  if (parentProvider === 'gemini') {
    return getGeminiToolContext(route)
  }
  const session = getRuntimeSession(parentProvider, route) || runManager.getLatestByProvider(parentProvider)
  const sender = session?.sender as Electron.WebContents | undefined
  if (!sender || !session) {
    return null
  }
  const workspacePath = session.workspacePath ? resolve(session.workspacePath) : undefined
  return {
    sender,
    scope: workspacePath ? 'workspace' : 'global',
    cwd: workspacePath || globalRunCwd(),
    workspacePath,
    appRunId: session.runId,
    appChatId: session.appChatId,
    providerSessionId: session.providerSessionId
  }
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

/**
 * Convenience wrapper around `runEventBus.publish`. Used by the three
 * `sendAgentCompat*` helpers below and by the few direct call sites that
 * previously bypassed them. Keeping the sender parameter optional means
 * non-IPC publish paths (telemetry, scheduled tasks, future remote sinks)
 * can publish too.
 */
function publishRunEvent(
  channel: RunEventChannel,
  provider: ProviderId,
  payload: unknown,
  sender?: Electron.WebContents
): void {
  runEventBus.publish({ channel, provider, payload, sender })
}

function sendAgentCompatLine(sender: Electron.WebContents, provider: ProviderId, payload: any, route?: AgentRunRoute | null) {
  const routed = enrichAgentPayload(provider, payload, route)
  appendDurableRunEventForRoute(
    provider,
    routed,
    payload?.type === 'tool_use' || payload?.type === 'tool_result' ? 'tool' : 'provider_raw',
    'raw',
    `Provider output${payload?.type ? `: ${payload.type}` : ''}`,
    payload,
    'provider'
  )
  const line = `${JSON.stringify(routed)}\n`
  const outputPayload = { provider, data: line, appRunId: routed.appRunId, appChatId: routed.appChatId }
  publishRunEvent('agent-output', provider, outputPayload, sender)
  if (provider === 'gemini') {
    publishRunEvent('gemini-output', provider, outputPayload, sender)
  }
}

function sendAgentCompatError(sender: Electron.WebContents, provider: ProviderId, error: string, route?: AgentRunRoute | null) {
  const routed = enrichAgentPayload(provider, { error }, route)
  appendDurableRunEventForRoute(provider, routed, 'provider_error', 'raw', 'Provider stderr/error', { error }, 'provider')
  publishRunEvent('agent-error', provider, routed, sender)
  if (provider === 'gemini') {
    publishRunEvent('gemini-error', provider, routed, sender)
  }
}

function sendAgentCompatExit(sender: Electron.WebContents, provider: ProviderId, code: number | null, route?: AgentRunRoute | null) {
  const routed = enrichAgentPayload(provider, { code }, route)
  appendDurableRunEventForRoute(provider, routed, 'provider_exit', 'raw', `Provider exited with code ${typeof code === 'number' ? code : 'unknown'}`, { code }, 'provider')
  publishRunEvent('agent-exit', provider, routed, sender)
  if (provider === 'gemini') {
    publishRunEvent('gemini-exit', provider, routed, sender)
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
    if (!isMainIssuedExternalPathGrant(grant)) continue
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

function codexSandboxPolicyForMode(approvalMode: string | undefined, workspace: string, externalPathGrants?: ExternalPathGrant[], settings: AppSettings = AppStore.getSettings(), scope: ChatScope = 'workspace') {
  const grants = normalizeExternalPathGrants(externalPathGrants)
  const hostRoot = parse(resolve(workspace)).root || sep
  const readableRoots = scope === 'global' ? [hostRoot] : [workspace, ...grants.map((grant) => grant.path)]
  const writableRoots = scope === 'global' ? [hostRoot] : [workspace, ...grants.filter((grant) => grant.access === 'write').map((grant) => grant.path)]
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

function createCodexRunState(sender: Electron.WebContents, threadId: string, model: string, cwd: string, workspacePath?: string, scope: ChatScope = 'workspace', route?: AgentRunRoute | null): CodexRunState {
  return {
    sender,
    threadId,
    scope,
    cwd,
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
    if (item?.type === 'collabToolCall') {
      const itemId = codexTimelineItemId(params, 'codex-collab-tool-call')
      state.timelineStartedItemIds.add(itemId)
      sendAgentCompatLine(state.sender, 'codex', {
        type: 'tool_use',
        tool_id: itemId,
        tool_name: 'collabToolCall',
        parameters: {
          title: item.name || item.agentName || item.agentType || 'Codex subagent',
          prompt: codexString(item.prompt || item.input || item.description || ''),
          summary: codexString(item.summary || item.status || ''),
          providerThreadId: params.threadId || params.thread?.id,
          childThreadId: item.newThreadId || item.receiverThreadId || item.threadId,
          parentToolCallId: item.parentToolCallId || item.parent_tool_call_id,
          raw: item
        },
        provider: 'codex'
      }, state)
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
    if (item?.type === 'collabToolCall') {
      const itemId = codexTimelineItemId(params, 'codex-collab-tool-call')
      sendAgentCompatLine(state.sender, 'codex', {
        type: 'tool_result',
        tool_id: itemId,
        tool_name: 'collabToolCall',
        status: item.status === 'failed' ? 'error' : item.status === 'cancelled' ? 'cancelled' : 'success',
        output: codexString(item.result || item.output || item.summary || item.error || item.errorMessage || ''),
        result: item,
        provider: 'codex'
      }, state)
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
  const isGlobalScope = state.scope === 'global'

  if (service && policy === 'deny') {
    const label = AGENTIC_SERVICE_LABELS[service]
    auditService.recordAutomaticApprovalDecision(
      'codex',
      { appRunId: state.appRunId, appChatId: state.appChatId },
      service,
      state.workspacePath,
      {
        method,
        title: formatted.title,
        body: formatted.body,
        preview: formatted.preview
      },
      'autoDeny',
      'policy',
      'request',
      { policy }
    )
    codexClient.reject(message.id, `${label} are disabled in AGBench settings.`)
    sendAgentCompatError(state.sender, 'codex', `${label} blocked by AGBench settings.`, state)
    return
  }

  if (service && method === 'item/permissions/requestApproval') {
    const hasSessionGrant = permissionService.hasSessionGrant('codex', isGlobalScope ? undefined : state.workspacePath, service, state.appRunId)
    const hasWorkspaceGrant = !isGlobalScope && policy === 'workspace' && hasAgenticWorkspaceGrant(settings, 'codex', state.workspacePath, service)
    if (hasSessionGrant || (!isGlobalScope && policy === 'allow') || hasWorkspaceGrant) {
      auditService.recordAutomaticApprovalDecision(
        'codex',
        { appRunId: state.appRunId, appChatId: state.appChatId },
        service,
        isGlobalScope ? undefined : state.workspacePath,
        {
          method,
          title: formatted.title,
          body: formatted.body,
          preview: formatted.preview
        },
        'autoAllow',
        hasSessionGrant ? 'session_grant' : hasWorkspaceGrant ? 'workspace_grant' : 'policy',
        hasSessionGrant ? 'session' : hasWorkspaceGrant ? 'workspace' : 'request',
        { policy }
      )
      codexClient.respond(message.id, {
        permissions: params?.permissions || {},
        scope: hasSessionGrant || hasWorkspaceGrant ? 'session' : 'turn'
      })
      return
    }
  }

  const actions: AgentApprovalAction[] = ['accept']
  if (service && method === 'item/permissions/requestApproval' && !isGlobalScope && state.workspacePath && policy === 'workspace') {
    actions.push('acceptForWorkspace')
  }
  actions.push('acceptForSession', 'decline', 'cancel')
  formatted.preview = { ...(formatted.preview || {}), actions }

  approvalService?.registerCodex(approvalId, { rpcId: message.id, method, params, service, workspacePath: isGlobalScope ? undefined : state.workspacePath, runId: state.appRunId })
  runManager.registerApproval(state.appRunId, approvalId)
  scheduleApprovalTimeout({
    approvalId,
    provider: 'codex',
    route: { appRunId: state.appRunId, appChatId: state.appChatId },
    kind: method
  })
  const approvalPayload = {
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
  }
  appendDurableRunEventForRoute(
    'codex',
    { appRunId: state.appRunId, appChatId: state.appChatId },
    'approval_request',
    'control',
    formatted.title,
    approvalPayload
  )
  recordApprovalLedgerRequest(
    'codex',
    { appRunId: state.appRunId, appChatId: state.appChatId },
    approvalPayload,
    {
      service,
      workspacePath: isGlobalScope ? undefined : state.workspacePath,
      metadata: { policy }
    }
  )
  state.sender.send('agent-approval-request', approvalPayload)
  // Fan out a wake-push to any paired iOS device. Summary uses
  // formatted.title (already curated for the user-facing approval
  // modal); falls back to `method` for unfamiliar Codex shapes.
  notifyPairedDevicesOfApproval({
    approvalId,
    workspaceId: workspaceIdForApprovalPush(
      isGlobalScope ? undefined : state.workspacePath
    ),
    threadId: state.threadId ?? state.appChatId,
    summary: formatted.title || `Codex approval: ${method}`
  })
}

function maybeRequestCodexHostRerun(state: CodexRunState, item: any, itemId: string, output: string): void {
  const settings = AppStore.getSettings()
  if (settings.codexSandboxFallback === 'off') return
  if (state.hostRerunRequestedItemIds.has(itemId)) return
  if (!state.threadId) return
  if (state.scope !== 'global' && !state.workspacePath) return
  const failed = item?.status === 'failed' || (typeof item?.exitCode === 'number' && item.exitCode !== 0)
  if (!failed) return
  if (!isCodexSandboxToolingFailure(output)) return

  const policy = getAgenticServicePolicy('shellCommands', settings)
  if (policy === 'deny') return

  const command = item.command || ''
  const commandText = codexCommandText(command)
  const cwd = codexString(item.cwd || state.workspacePath || state.cwd)
  if (!commandText.trim()) return

  let normalizedCwd: string
  try {
    normalizedCwd = state.scope === 'global'
      ? resolveHostDirectory(state.cwd, cwd)
      : resolveWorkspaceDirectory(state.workspacePath!, cwd)
  } catch {
    return
  }

  state.hostRerunRequestedItemIds.add(itemId)
  const approvalId = `host-rerun-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const swiftPmNestedSandbox = isSwiftPmNestedSandboxFailure(command, output)
  const reason = swiftPmNestedSandbox
    ? 'SwiftPM attempted to apply its own sandbox from inside the Codex command sandbox.'
    : 'Codex command failed in the command sandbox with a Swift/Xcode-style sandbox/tooling collision.'
  approvalService?.registerHostCommand(approvalId, {
    sender: state.sender,
    provider: 'codex',
    command,
    commandText,
    cwd: normalizedCwd,
    workspacePath: state.scope === 'global' ? undefined : state.workspacePath,
    threadId: state.threadId,
    model: state.model,
    appRunId: state.appRunId,
    appChatId: state.appChatId,
    reason,
    output
  })
  runManager.registerApproval(state.appRunId, approvalId)
  scheduleApprovalTimeout({
    approvalId,
    provider: 'codex',
    route: { appRunId: state.appRunId, appChatId: state.appChatId },
    kind: 'hostCommand/rerun'
  })
  const approvalPayload = {
    provider: 'codex',
    appRunId: state.appRunId,
    appChatId: state.appChatId,
    id: approvalId,
    approvalId,
    method: 'hostCommand/rerun',
    title: swiftPmNestedSandbox ? 'Rerun SwiftPM outside sandbox' : 'Rerun command outside sandbox',
    body: `${reason}\n\n${commandText}\n${normalizedCwd}`,
    preview: {
      kind: 'host-command-rerun',
      command: commandText,
      cwd: normalizedCwd,
      output: output.slice(0, 4000),
      swiftPmNestedSandbox,
      actions: ['accept', 'decline'] as AgentApprovalAction[]
    },
    actions: ['accept', 'decline'] as AgentApprovalAction[]
  }
  appendDurableRunEventForRoute(
    'codex',
    { appRunId: state.appRunId, appChatId: state.appChatId },
    'approval_request',
    'control',
    swiftPmNestedSandbox ? 'Rerun SwiftPM outside sandbox' : 'Rerun command outside sandbox',
    approvalPayload
  )
  recordApprovalLedgerRequest(
    'codex',
    { appRunId: state.appRunId, appChatId: state.appChatId },
    approvalPayload,
    {
      service: 'shellCommands',
      workspacePath: state.scope === 'global' ? undefined : state.workspacePath,
      metadata: {
        kind: 'host-command-rerun',
        policy,
        reason,
        swiftPmNestedSandbox
      }
    }
  )
  state.sender.send('agent-approval-request', approvalPayload)
  // Fan out a wake-push to any paired iOS device so the user can decide
  // away from the desktop. No-op if APNs is un-configured.
  notifyPairedDevicesOfApproval({
    approvalId,
    workspaceId: workspaceIdForApprovalPush(
      state.scope === 'global' ? undefined : state.workspacePath
    ),
    threadId: state.threadId ?? state.appChatId,
    summary: swiftPmNestedSandbox
      ? `Rerun SwiftPM outside sandbox: ${commandText.slice(0, 120)}`
      : `Rerun command outside sandbox: ${commandText.slice(0, 120)}`
  })
}

async function continueCodexAfterHostRerun(approval: HostCommandApproval, result: HostCommandResult, resultText: string): Promise<void> {
  if (!codexClient) return
  const settings = AppStore.getSettings()
  const continuationState = createCodexRunState(
    approval.sender,
    approval.threadId,
    approval.model,
    approval.cwd,
    approval.workspacePath,
    approval.workspacePath ? 'workspace' : 'global',
    approval
  )
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
    'AGBench reran a previously failed shell command once from the app host process after explicit user approval.',
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
      cwd: approval.cwd,
      approvalPolicy: approval.workspacePath ? codexApprovalPolicyForMode('default', settings) : 'on-request',
      sandboxPolicy: codexSandboxPolicyForMode('default', approval.cwd, [], settings, approval.workspacePath ? 'workspace' : 'global'),
      model: approval.model
    }, 60_000)
  } catch (error) {
    sendAgentCompatError(approval.sender, 'codex', `Codex continuation after approved host rerun failed: ${error instanceof Error ? error.message : String(error)}`, continuationState)
  }
}

async function runApprovedHostCommand(requestId: string): Promise<boolean> {
  const approval = approvalService?.getHostCommand(requestId)
  if (!approval) return false
  approvalService?.deleteHostCommand(requestId)
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

  const settings = runtimeSettings(AppStore.getSettings(), payload.runtimeProfile)
  const model = normalizeCodexModel(payload.model)
  const approvalPolicy = payload.scope === 'global' ? 'on-request' : codexApprovalPolicyForMode(payload.approvalMode, settings)
  const sandbox = codexSandboxForMode(payload.approvalMode)
  const startOrResumeParams = {
    cwd: payload.workspace!,
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
  const codexState = createCodexRunState(
    event.sender,
    threadId,
    threadResponse?.model || model,
    payload.workspace!,
    payload.scope === 'global' ? undefined : payload.workspace,
    payload.scope,
    route
  )
  registerRunSession('codex', event.sender, codexState, payload.scope === 'global' ? undefined : payload.workspace, codexState, threadId)
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
    cwd: payload.workspace!,
    approvalPolicy,
    sandboxPolicy: codexSandboxPolicyForMode(payload.approvalMode, payload.workspace!, payload.externalPathGrants, settings, payload.scope),
    model,
    ...(payload.reasoningEffort ? { effort: payload.reasoningEffort } : {}),
    ...(payload.serviceTier ? { serviceTier: payload.serviceTier } : {})
  }, 60_000)
}

function runCodexExecFallback(event: Electron.IpcMainInvokeEvent, payload: AgentRunPayload, reason: string) {
  const route = routeWithRunId('codex', payload)
  const settings = runtimeSettings(AppStore.getSettings(), payload.runtimeProfile)
  if (payload.scope === 'global') {
    sendAgentCompatError(event.sender, 'codex', `Codex app-server unavailable, so global chat execution is blocked. Global host tools require in-app approval prompts. Reason: ${reason}`, route)
    sendAgentCompatExit(event.sender, 'codex', 1, route)
    runManager.finish(route.appRunId, 'failed')
    return
  }
  if (codexNeedsApprovalGate(settings) || settings.agenticServices?.networkAccess === 'deny') {
    sendAgentCompatError(event.sender, 'codex', `Codex app-server unavailable and agentic service gates are active, so exec fallback is blocked. Reason: ${reason}`, route)
    sendAgentCompatExit(event.sender, 'codex', 1, route)
    return
  }

  const model = normalizeCodexModel(payload.model)
  const sandbox = codexSandboxForMode(payload.approvalMode)
  const args = ['exec', '--json', '--color', 'never', '-C', payload.workspace!, '--sandbox', sandbox, '--model', model]
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
    cwd: payload.workspace!,
    shell: false,
    env: createCliEnv({
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      AGENTBENCH_RUNTIME_PROFILE_ID: payload.runtimeProfileId || ''
    })
  })
  codexExecProcess = child
  runManager.attachProcess(route.appRunId!, child)

  child.stdout?.on('data', (data) => {
    const text = data.toString()
    appendDurableRunEventForRoute('codex', route, 'provider_raw', 'raw', 'Codex exec stdout', { data: text }, 'provider')
    // Was: event.sender.send('agent-output', ...). Routed through the bus so
    // additional sinks (debug logger, remote bridge) observe Codex stdout too.
    publishRunEvent('agent-output', 'codex', { provider: 'codex', data: text, ...route }, event.sender)
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

async function runCodexProvider(event: Electron.IpcMainInvokeEvent, payload: AgentRunPayload): Promise<void> {
  try {
    await runCodexAppServer(event, payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    runCodexExecFallback(event, payload, message)
  }
}

async function cancelProviderRun(provider: ProviderId = 'gemini', runId?: string): Promise<boolean> {
  const queuedJob = runId ? AppStore.getRunQueueJob(runId) : null
  if (queuedJob && (queuedJob.status === 'queued' || queuedJob.status === 'paused')) {
    getRunRepository().markCancelled({
      runId: queuedJob.runId,
      provider: queuedJob.provider,
      workspacePath: queuedJob.workspacePath,
      chatId: queuedJob.chatId,
      workspaceId: queuedJob.workspaceId,
      statusReason: 'Cancelled before the queued run started.'
    })
    return true
  }

  const session = runManager.get(runId) || runManager.getLatestByProvider(provider)
  if (session) {
    session.abortController?.abort()
    session.process?.kill()
    runManager.finish(session.runId, 'cancelled')
    if (provider === 'gemini') {
      if (geminiProcess === session.process) {
        geminiProcess = null
      }
      if (!geminiSessionProcess) {
        const latestGemini = runManager.getLatestByProvider('gemini')?.state as GeminiToolContext | undefined
        activeGeminiToolContext = latestGemini?.sender ? latestGemini : null
      }
    }
    if (provider === 'codex') {
      const codexState = getCodexStateFromSession(session)
      if (codexState?.threadId && codexState.turnId && codexClient) {
        await codexClient.request('turn/interrupt', {
          threadId: codexState.threadId,
          turnId: codexState.turnId
        }, 10_000).catch(() => {})
      }
    }
    return true
  }

  if (provider === 'claude' || provider === 'kimi') {
    const child = cliProviderProcesses.get(provider)
    if (child) {
      child.kill()
      cliProviderProcesses.delete(provider)
      return true
    }
    const controller = cliProviderAbortControllers.get(provider)
    if (controller) {
      controller.abort()
      cliProviderAbortControllers.delete(provider)
      return true
    }
    return false
  }

  if (provider !== 'codex') {
    if (geminiProcess) {
      geminiProcess.kill()
      geminiProcess = null
      if (!geminiSessionProcess) {
        activeGeminiToolContext = null
      }
      return true
    }
    return false
  }

  if (codexExecProcess) {
    codexExecProcess.kill()
    codexExecProcess = null
    return true
  }

  if (activeCodexRunState?.threadId && activeCodexRunState.turnId && codexClient) {
    await codexClient.request('turn/interrupt', {
      threadId: activeCodexRunState.threadId,
      turnId: activeCodexRunState.turnId
    }, 10_000).catch(() => {})
    return true
  }

  return false
}

async function runGeminiProvider(event: Electron.IpcMainInvokeEvent, payload: AgentRunPayload): Promise<void> {
  const route = routeWithRunId('gemini', payload)
  const args: string[] = []
  const settings = runtimeSettings(AppStore.getSettings(), payload.runtimeProfile)
  const approvalMode = payload.approvalMode || 'default'
  const effectiveApprovalMode = payload.scope === 'global' && approvalMode !== 'plan'
    ? 'default'
    : resolveGeminiApprovalModeForServices(approvalMode, settings)
  const requiresGeminiWriteTools = geminiWriteModeRequiresBridge(payload.scope, effectiveApprovalMode)
  if (effectiveApprovalMode !== approvalMode) {
    sendAgentCompatError(event.sender, 'gemini', `Gemini approval mode changed from ${approvalMode} to ${effectiveApprovalMode} because AGBench service settings block write-capable Gemini modes.`, route)
  }
  const resumePolicy = resolveGeminiCliResumePolicy(effectiveApprovalMode, payload.providerSessionId)
  if (resumePolicy.skippedReason) {
    sendAgentCompatLine(event.sender, 'gemini', {
      type: 'provider_warning',
      provider: 'gemini',
      severity: 'warning',
      title: 'Gemini session resume skipped',
      message: resumePolicy.skippedReason
    }, route)
  }
  const argsError = appendGeminiCliSessionArgs(
    args,
    payload.model || 'cli-default',
    effectiveApprovalMode,
    Boolean(payload.sessionTrust),
    resumePolicy.resumeSessionId,
    settings.geminiCheckpointingEnabled,
    payload.geminiWorktree || null,
    requiresGeminiWriteTools
  )
  if (argsError) {
    sendAgentCompatError(event.sender, 'gemini', argsError, route)
    sendAgentCompatExit(event.sender, 'gemini', -1, route)
    return
  }

  const includeDirs = Array.from(
    (payload.imagePaths || []).reduce((acc, attachmentPath) => {
      const normalized = attachmentPath.trim()
      if (!normalized) return acc
      const pathToInclude = isAbsolute(normalized)
        ? dirname(normalized)
        : dirname(join(payload.workspace!, normalized))
      if (pathToInclude) {
        acc.add(pathToInclude)
      }
      return acc
    }, new Set<string>())
  )

  includeDirs.forEach((imageDir) => {
    args.push('--include-directories', imageDir)
  })

  args.push(
    '--prompt',
    payload.prompt,
    '--output-format',
    'stream-json'
  )

  const resolved = await resolveCliProviderBinary('gemini', payload.runtimeProfile)
  if (!resolved.binaryPath) {
    sendAgentCompatError(event.sender, 'gemini', resolved.error || 'Gemini CLI is not configured.', route)
    sendAgentCompatExit(event.sender, 'gemini', -1, route)
    return
  }

  try {
    await prepareGeminiMcpBridgeForRun(event.sender, payload.workspace!, route, payload.scope, Boolean(payload.sessionTrust), {
      requireWriteTools: requiresGeminiWriteTools
    })
  } catch (error) {
    sendAgentCompatError(event.sender, 'gemini', error instanceof Error ? error.message : String(error), route)
    sendAgentCompatExit(event.sender, 'gemini', -1, route)
    return
  }

  void emitProviderCapabilityWarnings(event.sender, 'gemini', payload.workspace, effectiveApprovalMode, route)

  const env = createCliEnv({
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    GEMINI_SANDBOX: 'true',
    AGENTBENCH_RUN_ID: route.appRunId || '',
    AGENTBENCH_CHAT_ID: route.appChatId || '',
    AGENTBENCH_RUNTIME_PROFILE_ID: payload.runtimeProfileId || '',
    // Phase I2: every CLI spawn now carries the parent provider so
    // the agentbench MCP bridge subprocess (inherited via env) stamps
    // broker requests with the right routing key. Codex's persistent
    // app-server sets this via `-c mcp_servers.agentbench.env` in
    // CodexAppServerClient.
    AGENTBENCH_PARENT_PROVIDER: 'gemini'
  }, resolved.binaryPath)

  const child = spawn(resolved.binaryPath, args, {
    cwd: payload.workspace!,
    shell: false,
    env
  })
  geminiProcess = child
  runManager.attachProcess(route.appRunId!, child)

  child.stdout?.on('data', (data) => {
    const text = data.toString()
    appendDurableRunEventForRoute('gemini', route, 'provider_raw', 'raw', 'Gemini stdout', { data: text }, 'provider')
    publishRunEvent('gemini-output', 'gemini', { provider: 'gemini', data: text, ...route }, event.sender)
    // Phase I3.x — detect-and-redirect heuristic. If Gemini emits an
    // invoke_agent tool_call when the user asked for cross-provider
    // delegation, surface a single non-blocking warning chip so the
    // user understands the call didn't reach AGBench's MCP bridge.
    maybeEmitGeminiCrossProviderWarning(event.sender, route, payload.prompt, text)
  })

  child.stderr?.on('data', (data) => {
    const error = data.toString()
    appendDurableRunEventForRoute('gemini', route, 'provider_error', 'raw', 'Gemini stderr', { error }, 'provider')
    publishRunEvent('gemini-error', 'gemini', { provider: 'gemini', error, ...route }, event.sender)
  })

  child.on('close', (code) => {
    appendDurableRunEventForRoute('gemini', route, 'provider_exit', 'raw', `Gemini exited with code ${typeof code === 'number' ? code : 'unknown'}`, { code }, 'provider')
    publishRunEvent('gemini-exit', 'gemini', { provider: 'gemini', code, ...route }, event.sender)
    if (geminiProcess === child) {
      geminiProcess = null
    }
    runManager.finish(route.appRunId, code === 0 ? 'completed' : 'failed')
    if (route.appRunId) geminiCrossProviderWarningsFired.delete(route.appRunId)
    if (!geminiSessionProcess) {
      const latestGemini = runManager.getLatestByProvider('gemini')?.state as GeminiToolContext | undefined
      activeGeminiToolContext = latestGemini?.sender ? latestGemini : null
    }
  })

  child.on('error', (err) => {
    const error = `Failed to start process: ${err.message}`
    appendDurableRunEventForRoute('gemini', route, 'provider_error', 'raw', 'Gemini process failed to start', { error }, 'provider')
    publishRunEvent('gemini-error', 'gemini', { provider: 'gemini', error, ...route }, event.sender)
    appendDurableRunEventForRoute('gemini', route, 'provider_exit', 'raw', 'Gemini process failed before exit', { code: -1 }, 'provider')
    publishRunEvent('gemini-exit', 'gemini', { provider: 'gemini', code: -1, ...route }, event.sender)
    if (geminiProcess === child) {
      geminiProcess = null
    }
    runManager.finish(route.appRunId, 'failed')
    if (route.appRunId) geminiCrossProviderWarningsFired.delete(route.appRunId)
    if (!geminiSessionProcess) {
      const latestGemini = runManager.getLatestByProvider('gemini')?.state as GeminiToolContext | undefined
      activeGeminiToolContext = latestGemini?.sender ? latestGemini : null
    }
  })
}

const providerAdapters = createProviderAdapterRegistry<AgentRunPayload, Electron.IpcMainInvokeEvent>([
  {
    ...defaultProviderDescriptor('gemini'),
    run: ({ event, payload }) => runGeminiProvider(event, payload),
    cancel: (runId) => cancelProviderRun('gemini', runId),
    getStatus: () => getAgentStatusSnapshotDirect('gemini'),
    getMcpStatus: () => getAgentMcpStatusSnapshotDirect('gemini'),
    getCapabilityContract: (request = {}) =>
      getProviderCapabilityContractDirect('gemini', request.workspacePath, request.approvalMode)
  },
  {
    ...defaultProviderDescriptor('codex'),
    run: ({ event, payload }) => runCodexProvider(event, payload),
    cancel: (runId) => cancelProviderRun('codex', runId),
    getStatus: () => getAgentStatusSnapshotDirect('codex'),
    getMcpStatus: () => getAgentMcpStatusSnapshotDirect('codex'),
    getCapabilityContract: (request = {}) =>
      getProviderCapabilityContractDirect('codex', request.workspacePath, request.approvalMode)
  },
  {
    ...defaultProviderDescriptor('claude'),
    run: ({ event, payload }) => runClaudeProvider(event, payload),
    cancel: (runId) => cancelProviderRun('claude', runId),
    getStatus: () => getAgentStatusSnapshotDirect('claude'),
    getMcpStatus: () => getAgentMcpStatusSnapshotDirect('claude'),
    getCapabilityContract: (request = {}) =>
      getProviderCapabilityContractDirect('claude', request.workspacePath, request.approvalMode)
  },
  {
    ...defaultProviderDescriptor('kimi'),
    run: ({ event, payload }) => runKimiProvider(event, payload),
    cancel: (runId) => cancelProviderRun('kimi', runId),
    getStatus: () => getAgentStatusSnapshotDirect('kimi'),
    getMcpStatus: () => getAgentMcpStatusSnapshotDirect('kimi'),
    getCapabilityContract: (request = {}) =>
      getProviderCapabilityContractDirect('kimi', request.workspacePath, request.approvalMode)
  }
])

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

async function readTextFileIfAvailable(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return undefined
  }
}

async function readPackageJsonIfAvailable(): Promise<any | undefined> {
  const candidates = [
    join(app.getAppPath(), 'package.json'),
    join(process.cwd(), 'package.json')
  ]
  for (const candidate of candidates) {
    const text = await readTextFileIfAvailable(candidate)
    if (!text) continue
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }
  return undefined
}

async function readDebugBuilderConfigText(): Promise<string | undefined> {
  const candidates = [
    join(app.getAppPath(), 'electron-builder.debug.yml'),
    join(process.cwd(), 'electron-builder.debug.yml')
  ]
  for (const candidate of candidates) {
    const text = await readTextFileIfAvailable(candidate)
    if (text) return text
  }
  return undefined
}

async function userDataDirectoryExists(): Promise<boolean> {
  try {
    const stat = await fs.stat(app.getPath('userData'))
    return stat.isDirectory()
  } catch {
    return false
  }
}

function recordProductCrash(input: ProductCrashInput): void {
  try {
    AppStore.recordProductCrash(input)
  } catch (error) {
    console.error('Failed to record product crash', error)
  }
}

function registerProductCrashHandlers(): void {
  process.on('uncaughtExceptionMonitor', (error) => {
    recordProductCrash({
      source: 'main',
      severity: 'fatal',
      name: error.name,
      message: error.message,
      stack: error.stack
    })
  })

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : null
    recordProductCrash({
      source: 'main',
      severity: 'error',
      name: error?.name || 'UnhandledRejection',
      message: error?.message || String(reason),
      stack: error?.stack
    })
  })

  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') {
      return
    }
    recordProductCrash({
      source: 'child_process',
      severity: details.reason === 'crashed' ? 'error' : 'warning',
      processType: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      message: `${details.type || 'child process'} exited: ${details.reason || 'unknown'}`,
      metadata: {
        name: details.name,
        serviceName: details.serviceName
      }
    })
  })
}

async function getProductOperationsStatus(): Promise<ProductOperationsStatus> {
  const settings = AppStore.getSettings()
  const packageJson = await readPackageJsonIfAvailable()
  const builderConfigText = await readDebugBuilderConfigText()
  const geminiBridgeStatus = await getGeminiMcpBridgeStatus({ autoRepairIfEnabled: true }).catch((error) => {
    const fallback = settings.geminiMcpBridgeLastStatus
    if (fallback) {
      return {
        ...fallback,
        available: false,
        error: error instanceof Error ? error.message : String(error),
        message: 'Gemini MCP bridge status check failed; showing last known status.'
      } satisfies GeminiMcpBridgeStatus
    }
    return {
      checkedAt: new Date().toISOString(),
      enabled: Boolean(settings.geminiMcpBridgeEnabled),
      installed: false,
      available: false,
      serverName: GEMINI_MCP_SERVER_NAME,
      error: error instanceof Error ? error.message : String(error),
      message: 'Gemini MCP bridge status check failed.'
    } satisfies GeminiMcpBridgeStatus
  })

  const workspaces = AppStore.getWorkspaces()
  const chats = AppStore.getChats()
  const runQueue = AppStore.getRunQueueJobs()
  const runRecovery = AppStore.getRunRecoveryRecords()
  const approvalLedger = AppStore.getApprovalLedger()
  const workspaceChanges = AppStore.getWorkspaceChangeSets()
  const scheduledTasks = AppStore.getScheduledTasks()
  const recentCrashes = AppStore.getProductCrashes({ limit: 20 })

  return buildProductOperationsStatus({
    updateChannel: settings.updateChannel || 'debug',
    appName: app.getName() || 'AGBench',
    appVersion: app.getVersion() || 'unknown',
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    userDataPath: app.getPath('userData'),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    workspaces,
    chats,
    runQueue,
    runRecovery,
    approvalLedger,
    workspaceChanges,
    scheduledTasks,
    recentCrashes,
    geminiBridgeStatus,
    userDataExists: await userDataDirectoryExists(),
    packageJson,
    builderConfigText,
    env: {
      APPLE_KEYCHAIN_PROFILE: process.env.APPLE_KEYCHAIN_PROFILE,
      CSC_NAME: process.env.CSC_NAME
    }
  })
}

async function buildCurrentDiagnosticsSnapshot() {
  const settings = AppStore.getSettings()
  const status = await getProductOperationsStatus()
  return buildDiagnosticsSnapshot({
    status,
    settings,
    workspaces: AppStore.getWorkspaces(),
    runQueue: AppStore.getRunQueueJobs(),
    runRecovery: AppStore.getRunRecoveryRecords(),
    scheduledTasks: AppStore.getScheduledTasks(),
    approvalLedger: AppStore.getApprovalLedger(),
    workspaceChanges: AppStore.getWorkspaceChangeSets(),
    recentCrashes: AppStore.getProductCrashes({ limit: 100 })
  })
}

async function exportProductDiagnostics(requestedPath?: string): Promise<ProductDiagnosticsExportResult> {
  try {
    const snapshot = await buildCurrentDiagnosticsSnapshot()
    let targetPath = requestedPath
    if (!targetPath) {
      if (!mainWindow) {
        throw new Error('No application window is available for diagnostics export.')
      }
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export AGBench Diagnostics',
        defaultPath: `AGBench-Diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        filters: [{ name: 'JSON diagnostics', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) {
        return { ok: false, error: 'Diagnostics export cancelled.' }
      }
      targetPath = result.filePath
    }
    await fs.writeFile(targetPath, serializeDiagnosticsSnapshot(snapshot), 'utf8')
    return { ok: true, path: targetPath, snapshot }
  } catch (error) {
    recordProductCrash({
      source: 'main',
      severity: 'warning',
      name: error instanceof Error ? error.name : 'DiagnosticsExportError',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function repairProductInstall(): Promise<ProductOperationsStatus> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  const settings = AppStore.getSettings()
  if (settings.geminiMcpBridgeEnabled) {
    try {
      await installGeminiMcpBridge()
    } catch (error) {
      recordProductCrash({
        source: 'bridge',
        severity: 'warning',
        name: error instanceof Error ? error.name : 'GeminiBridgeRepairError',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
    }
  }
  return getProductOperationsStatus()
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

function hasStaleGeminiMcpBridgeRegistration(raw: string, socketPath: string): boolean {
  if (!raw.toLowerCase().includes(GEMINI_MCP_SERVER_NAME)) {
    return false
  }
  if (/\/Applications\/AgentBench\.app\//i.test(raw)) {
    return true
  }
  if (/Application Support\/agentbench\//i.test(raw) && !socketPath.includes('/Application Support/agentbench/')) {
    return true
  }
  return app.isPackaged && !raw.includes(process.execPath)
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

function isAGBenchMcpToolName(value: unknown): value is AGBenchMcpToolName {
  return AGENTBENCH_MCP_TOOLS.includes(value as AGBenchMcpToolName)
}

function isValidGeminiMcpBrokerToken(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const expected = Buffer.from(geminiMcpBrokerToken, 'utf8')
  const actual = Buffer.from(value, 'utf8')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
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

async function executeGeminiMcpTool(toolName: AGBenchMcpToolName, rawArgs: unknown, route?: AgentRunRoute | null, parentProvider: ProviderId = 'gemini'): Promise<{ text: string; isError?: boolean }> {
  const context = getAgentToolContext(parentProvider, route)
  if (!context) {
    return { text: `AGBench has no active ${providerLabel(parentProvider)} workspace context for this MCP tool call.`, isError: true }
  }

  const baseCwd = resolve(context.cwd || context.workspacePath || globalRunCwd())
  const workspacePath = context.workspacePath ? resolve(context.workspacePath) : undefined
  const args = normalizeMcpToolArguments(rawArgs)
  const cwd = resolveScopedDirectory(context.scope, baseCwd, workspacePath, String(args.cwd || args.working_directory || args.workdir || ''))
  const approvalPreview = previewForGeminiMcpTool(toolName, args, cwd, context)
  const allowed = await requestAgenticServiceApproval(context.sender, parentProvider, approvalPreview.service, context.scope === 'global' ? undefined : workspacePath, {
    method: `${parentProvider}-mcp/${toolName}`,
    title: approvalPreview.title,
    body: approvalPreview.body,
    preview: approvalPreview.preview,
    runId: context.appRunId,
    forcePrompt: context.scope === 'global'
  })
  const toolId = `${parentProvider}-mcp-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2)}`

  sendAgentCompatLine(context.sender, parentProvider, {
    type: 'tool_use',
    tool_id: toolId,
    tool_name: toolName,
    parameters: { ...args, cwd },
    provider: parentProvider,
    server: GEMINI_MCP_SERVER_NAME
  })

  if (!allowed) {
    const text = `${AGENTIC_SERVICE_LABELS[approvalPreview.service]} denied by AGBench.`
    sendAgentCompatLine(context.sender, parentProvider, {
      type: 'tool_result',
      tool_id: toolId,
      tool_name: toolName,
      status: 'error',
      output: text,
      provider: parentProvider,
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
      sendAgentCompatLine(context.sender, parentProvider, {
        type: 'tool_result',
        tool_id: toolId,
        tool_name: toolName,
        status: isError ? 'error' : 'success',
        output: text,
        result: { exitCode: result.exitCode, durationMs: result.durationMs },
        provider: parentProvider,
        server: GEMINI_MCP_SERVER_NAME
      })
      return { text, isError }
    }

    if (toolName === 'read_file') {
      const targetPath = resolveGeminiMcpScopedPath(context, String(args.path || args.file_path || ''))
      const stat = await fs.stat(targetPath)
      if (!stat.isFile()) throw new Error('Selected path is not a file.')
      if (stat.size > MAX_EDITOR_FILE_BYTES) throw new Error('File is too large to read through the MCP bridge.')
      const buffer = await fs.readFile(targetPath)
      assertTextBuffer(buffer)
      text = buffer.toString('utf8')
    } else if (toolName === 'list_directory') {
      const targetPath = resolveGeminiMcpScopedPath(context, String(args.path || args.directory || '.'))
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
      const targetPath = resolveGeminiMcpScopedPath(context, String(args.path || args.file_path || ''))
      const content = String(args.content ?? '')
      await fs.mkdir(dirname(targetPath), { recursive: true })
      await fs.writeFile(targetPath, content, 'utf8')
      text = `Wrote ${formatScopedPath(context, targetPath)} (${content.length} chars).`
    } else if (toolName === 'replace') {
      const targetPath = resolveGeminiMcpScopedPath(context, String(args.path || args.file_path || ''))
      const oldString = String(args.old_string ?? args.oldString ?? '')
      const newString = String(args.new_string ?? args.newString ?? '')
      if (!oldString) throw new Error('old_string is required.')
      const original = await fs.readFile(targetPath, 'utf8')
      if (!original.includes(oldString)) throw new Error('old_string was not found in the target file.')
      const updated = args.replace_all === true || args.replaceAll === true
        ? original.split(oldString).join(newString)
        : original.replace(oldString, newString)
      await fs.writeFile(targetPath, updated, 'utf8')
      text = `Edited ${formatScopedPath(context, targetPath)}.`
    } else if (toolName === 'delegate_to_subthread') {
      // Phase F3: agent-driven sub-thread delegation. Spawns a
      // sub-thread under the active parent (context.appChatId), then
      // fire-and-forget dispatches a run on it with the user-supplied
      // delegation prompt. The Gemini sender continues to receive
      // events for both the parent + sub-thread chats; the renderer
      // routes by appChatId so the sub-thread stream lands cleanly.
      // On completion, F2 back-propagation auto-appends the sub-
      // thread's final assistant message to the parent transcript.
      const parentChatId = context.appChatId
      if (!parentChatId) {
        throw new Error('delegate_to_subthread requires an active parent chat context.')
      }
      const providerArgRaw = String(args.provider || '').trim()
      const promptArg = String(args.prompt || '').trim()
      const returnResult = args.returnResult !== false
      let providerArg: ProviderId
      try {
        providerArg = assertProviderId(providerArgRaw)
      } catch {
        throw new Error(
          `delegate_to_subthread: provider must be one of gemini/codex/claude/kimi (got: ${providerArgRaw}).`
        )
      }
      if (!promptArg) {
        throw new Error('delegate_to_subthread: prompt is required.')
      }
      // Phase I1.b + I2: approval gate. Every delegation prompts the
      // user (or auto-allows/declines per workspace/session policy)
      // before any sub-thread is created. The 'ask' default means an
      // agent can SUGGEST delegation but nothing spawns until the user
      // clicks accept. "Allow for workspace" lets the user opt into
      // frictionless multi-provider delegation in trusted workspaces.
      //
      // Phase I2: `parentProvider` is now the runtime stamp from the
      // MCP bridge subprocess (was hardcoded 'gemini'); the approval +
      // audit + per-provider grant lookup all key off it. So when
      // Codex calls delegate_to_subthread the approval modal reads
      // "Codex wants to delegate to Claude" and the workspace grant
      // applies to Codex specifically — Gemini's grant doesn't auto-
      // allow Codex delegation in the same workspace.
      const targetProviderLabel = providerLabel(providerArg)
      const parentProviderLabel = providerLabel(parentProvider)
      const promptPreview = promptArg.length > 500
        ? `${promptArg.slice(0, 500)}\n…(${promptArg.length - 500} more chars)`
        : promptArg
      const delegationApproved = await requestAgenticServiceApproval(
        context.sender,
        parentProvider,
        'subThreadDelegation',
        context.scope === 'global' ? undefined : context.workspacePath,
        {
          method: `${parentProvider}-mcp/delegate_to_subthread`,
          title: `${parentProviderLabel} wants to delegate to ${targetProviderLabel} sub-thread`,
          body:
            `Delegation prompt:\n${promptPreview}\n\n` +
            `Spawning this sub-thread starts a new run on ${targetProviderLabel} using its current model. ` +
            `This consumes ${targetProviderLabel} usage allowances.`,
          preview: {
            kind: 'subthread-delegation',
            parentProvider,
            targetProvider: providerArg,
            delegationPrompt: promptArg,
            returnResultToParent: returnResult,
            workspacePath: context.scope === 'global' ? undefined : context.workspacePath
          },
          runId: context.appRunId,
          forcePrompt: false
        }
      )
      if (!delegationApproved) {
        // Decline path: surface a clear tool_result to the agent so it
        // can adjust + continue the parent turn without delegating.
        // No sub-thread created, no run dispatched, no audit event.
        const declineText =
          `Sub-thread delegation to ${targetProviderLabel} was declined by AGBench policy. ` +
          `${parentProviderLabel} continues without delegating; ` +
          `the user can change the policy in Settings → Behavior → Agentic Services → Sub-thread delegation.`
        sendAgentCompatLine(context.sender, parentProvider, {
          type: 'tool_result',
          tool_id: toolId,
          tool_name: toolName,
          status: 'error',
          output: declineText,
          provider: parentProvider,
          server: GEMINI_MCP_SERVER_NAME
        })
        return { text: declineText, isError: true }
      }
      const subThread = AppStore.createSubThread({
        parentChatId,
        provider: providerArg,
        delegationPrompt: promptArg,
        returnResultToParent: returnResult
      })
      // Phase I3.2 — drop a synthetic "delegation card" message into the
      // parent transcript so the user sees an inline visual marker the
      // moment the sub-thread spawns (instead of finding out only when
      // the result back-propagates). We use a metadata-tagged system
      // message so the renderer can swap in a custom card component.
      try {
        const parentChat = AppStore.getChat(parentChatId)
        if (parentChat) {
          const promptCardPreview = promptArg.length > 240
            ? `${promptArg.slice(0, 240)}…`
            : promptArg
          const cardMessage: ChatMessage = {
            id: `subthread-delegation-${subThread.appChatId}-${Date.now()}`,
            role: 'system',
            content: `↪ Delegated to ${providerLabel(providerArg)} sub-thread (${subThread.title}).`,
            timestamp: new Date().toISOString(),
            metadata: {
              kind: 'subThreadDelegation',
              subThreadId: subThread.appChatId,
              subThreadProvider: providerArg,
              subThreadTitle: subThread.title,
              parentProvider,
              delegationPrompt: promptArg,
              delegationPromptPreview: promptCardPreview,
              returnResultToParent: returnResult
            }
          }
          const updatedParent: ChatRecord = {
            ...parentChat,
            messages: [...parentChat.messages, cardMessage],
            updatedAt: Date.now()
          }
          AppStore.saveChat(updatedParent)
          try {
            mainWindow?.webContents.send('chat-updated', updatedParent)
          } catch {
            // Best-effort — renderer not yet attached.
          }
        }
      } catch {
        // Best-effort; missing card is non-fatal vs missing run.
      }
      try {
        // Phase I2: the audit event records the actual parent provider
        // (could be Gemini, Codex, Claude or Kimi), so cross-provider
        // delegation chains are traceable. Source stays
        // 'mcp:delegate_to_subthread' since the tool lives on the
        // shared agentbench MCP server across all CLIs.
        appendDurableRunEventForRoute(
          parentProvider,
          { appRunId: context.appRunId, appChatId: parentChatId },
          'subthread_spawned',
          'control',
          `${parentProviderLabel} agent delegated to ${providerArg} sub-thread`,
          {
            subThreadId: subThread.appChatId,
            parentProvider,
            provider: providerArg,
            delegationPrompt: promptArg,
            returnResultToParent: returnResult,
            source: 'mcp:delegate_to_subthread'
          }
        )
      } catch {
        // Best-effort.
      }
      const runPayload: AgentRunPayload = {
        provider: providerArg,
        scope: context.scope ?? 'workspace',
        workspace: subThread.workspacePath,
        prompt: promptArg,
        appChatId: subThread.appChatId,
        approvalMode: 'default',
        model: 'cli-default'
      }
      const fakeEvent = { sender: context.sender } as Electron.IpcMainInvokeEvent
      void (async () => {
        try {
          await runCoordinatorRef?.dispatch(runPayload, fakeEvent)
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[delegate_to_subthread] run dispatch failed for subThreadId=${subThread.appChatId}:`,
            err instanceof Error ? err.message : String(err)
          )
        }
      })()
      try {
        mainWindow?.webContents.send('chat-updated', subThread)
      } catch {
        // Window not yet ready — F2's back-propagation will fire
        // chat-updated again on completion.
      }
      text =
        `Spawned ${providerArg} sub-thread "${subThread.title}" (id=${subThread.appChatId}). ` +
        `Running in the background` +
        (returnResult
          ? "; its final result will append to this parent transcript on completion."
          : '. Navigate to the sub-thread in the sidebar to follow progress.')
    }

    sendAgentCompatLine(context.sender, parentProvider, {
      type: 'tool_result',
      tool_id: toolId,
      tool_name: toolName,
      status: 'success',
      output: text,
      provider: parentProvider,
      server: GEMINI_MCP_SERVER_NAME
    })
    return { text }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    sendAgentCompatLine(context.sender, parentProvider, {
      type: 'tool_result',
      tool_id: toolId,
      tool_name: toolName,
      status: 'error',
      output: text,
      provider: parentProvider,
      server: GEMINI_MCP_SERVER_NAME
    })
    return { text, isError: true }
  }
}

// Phase I2: providers that can drive the shared agentbench MCP bridge.
// The bridge subprocess stamps `parentProvider` from
// AGENTBENCH_PARENT_PROVIDER env; if it's missing or unrecognised we
// fall back to 'gemini' to preserve pre-I2 broker behaviour.
const VALID_BROKER_PARENT_PROVIDERS = new Set<ProviderId>(['gemini', 'codex', 'claude', 'kimi'])

function normalizeBrokerParentProvider(value: unknown): ProviderId {
  if (typeof value === 'string' && VALID_BROKER_PARENT_PROVIDERS.has(value as ProviderId)) {
    return value as ProviderId
  }
  return 'gemini'
}

async function handleGeminiMcpBrokerRequest(request: any): Promise<any> {
  if (!isValidGeminiMcpBrokerToken(request?.token)) {
    return { ok: false, error: 'AGBench MCP broker authentication failed.' }
  }
  const toolName = request?.tool || request?.name
  if (!isAGBenchMcpToolName(toolName)) {
    return { ok: false, error: `Unknown AGBench MCP tool: ${String(toolName || 'unknown')}` }
  }
  const parentProvider = normalizeBrokerParentProvider(request?.parentProvider)
  const result = await executeGeminiMcpTool(
    toolName,
    request?.arguments ?? request?.args ?? request?.input,
    normalizeRunRoute(request),
    parentProvider
  )
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
    const timeout = setTimeout(() => finish({ ok: false, error: 'AGBench MCP broker timed out.' }), 130_000)
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
      if (!settled) finish({ ok: false, error: 'AGBench MCP broker closed before responding.' })
    })
  })
}

function mcpToolDefinitions() {
  return [
    {
      name: 'run_shell_command',
      description: 'Run a shell command in the active AGBench workspace after AGBench approval policy allows it.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      },
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
      description: 'Write a UTF-8 text file inside the active AGBench workspace after approval.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      },
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
      description: 'Replace text in a UTF-8 file inside the active AGBench workspace after approval.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      },
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
      description: 'Read a UTF-8 text file inside the active AGBench workspace after tool policy allows it.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
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
      description: 'List a directory inside the active AGBench workspace after tool policy allows it.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        }
      }
    },
    {
      // Phase F3: agent-driven sub-thread delegation. Spawns a
      // sub-thread under the active parent thread, optionally on a
      // different provider, and (fire-and-forget) dispatches a run
      // with the delegation prompt. Returns immediately with the
      // sub-thread id; the result auto-propagates back to the
      // parent transcript on sub-thread completion via the F2
      // back-propagation path (when returnResult=true).
      //
      // The parent provider should mention to the user that they
      // delegated, so the user knows to watch the sub-thread in the
      // sidebar or wait for the synthetic ↩ Result message.
      name: 'delegate_to_subthread',
      description:
        'Spawn a context-isolated sub-thread under the active parent thread, optionally on a different AGBench provider (gemini/codex/claude/kimi), and start a run with the delegation prompt. Returns immediately with the sub-thread id; when returnResult is true, the sub-thread\'s final assistant message auto-propagates back to the parent transcript on completion.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      },
      inputSchema: {
        type: 'object',
        properties: {
          provider: {
            type: 'string',
            enum: ['gemini', 'codex', 'claude', 'kimi'],
            description: 'Which AGBench provider should run the sub-thread.'
          },
          prompt: {
            type: 'string',
            description:
              "User-facing delegation prompt that primes the sub-thread's first turn. Persisted for audit + pre-fills the sub-thread composer."
          },
          returnResult: {
            type: 'boolean',
            description:
              "When true, the sub-thread's final assistant message auto-appends to the parent transcript on completion (Phase F2 back-propagation)."
          }
        },
        required: ['provider', 'prompt']
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

function parseBridgeTokenArg(): string {
  const index = process.argv.indexOf(GEMINI_MCP_TOKEN_ARG)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : ''
}

type McpResponseTransport = 'framed' | 'line'

function writeMcpFrame(payload: unknown): void {
  const body = JSON.stringify(payload)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
}

function writeMcpPayload(payload: unknown, transport: McpResponseTransport): void {
  if (transport === 'line') {
    process.stdout.write(`${JSON.stringify(payload)}\n`)
    return
  }
  writeMcpFrame(payload)
}

function writeMcpResponse(id: unknown, result: unknown, transport: McpResponseTransport = 'framed'): void {
  writeMcpPayload({ jsonrpc: '2.0', id, result }, transport)
}

function writeMcpError(id: unknown, code: number, message: string, transport: McpResponseTransport = 'framed'): void {
  writeMcpPayload({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, transport)
}

function handleMcpJsonRpcMessage(socketPath: string, brokerToken: string, message: any, transport: McpResponseTransport = 'framed'): void {
  const id = message?.id
  const method = String(message?.method || '')
  if (!method) {
    writeMcpError(id, -32600, 'Invalid MCP request.', transport)
    return
  }
  if (method.startsWith('notifications/')) {
    return
  }
  if (method === 'initialize') {
    writeMcpResponse(id, {
      protocolVersion: message?.params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'AGBench Gemini Bridge', version: app.getVersion() || '1.0.0' }
    }, transport)
    return
  }
  if (method === 'ping') {
    writeMcpResponse(id, {}, transport)
    return
  }
  if (method === 'tools/list') {
    writeMcpResponse(id, { tools: mcpToolDefinitions() }, transport)
    return
  }
  if (method === 'tools/call') {
    const name = message?.params?.name
    const args = message?.params?.arguments || {}
    // Phase I2: the bridge subprocess stamps the parent provider on
    // every broker request so AGBench main can route tool execution +
    // approvals to the correct provider. Codex's persistent app-server
    // spawns the bridge once with AGENTBENCH_PARENT_PROVIDER=codex (set
    // via -c mcp_servers.agentbench.env), so the same bridge binary
    // serves all four providers' MCP needs without code duplication.
    bridgeLog(`tools/call name=${name} id=${id} args=${JSON.stringify(args).slice(0, 200)}`)
    brokerRequest(socketPath, {
      id: id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      token: brokerToken,
      tool: name,
      arguments: args,
      appRunId: process.env.AGENTBENCH_RUN_ID,
      appChatId: process.env.AGENTBENCH_CHAT_ID,
      parentProvider: process.env.AGENTBENCH_PARENT_PROVIDER || 'gemini'
    }).then((result) => {
      bridgeLog(`tools/call name=${name} id=${id} result.ok=${result?.ok} text.len=${(result?.text || result?.error || '').length}`)
      const text = result?.text || result?.error || ''
      try {
        writeMcpResponse(id, {
          content: [{ type: 'text', text }],
          isError: result?.ok === false
        }, transport)
      } catch (writeError) {
        bridgeLog(`tools/call write FAILED id=${id} err=${writeError instanceof Error ? writeError.message : String(writeError)}`)
      }
    }).catch((rejection) => {
      // Defensive: brokerRequest currently always resolves, but a
      // stray throw inside the .then handler (e.g. JSON.stringify on a
      // pathological result) would otherwise propagate as an
      // unhandled rejection and kill the bridge subprocess. Surface
      // the error to the MCP client AND the log file instead so the
      // next tools/call doesn't fail with "Not connected".
      const reasonText = rejection instanceof Error ? rejection.message : String(rejection)
      bridgeLog(`tools/call REJECTION id=${id} reason=${reasonText}`)
      try {
        writeMcpResponse(id, {
          content: [{ type: 'text', text: `AGBench bridge internal error: ${reasonText}` }],
          isError: true
        }, transport)
      } catch {
        // If even the error response can't be written, the transport
        // is already dead — nothing useful left to do.
      }
    })
    return
  }
  writeMcpError(id, -32601, `Unsupported MCP method: ${method}`, transport)
}

// Phase I2 follow-up: file-based diagnostic logger for the bridge
// subprocess. Gemini-CLI captures the bridge's stderr but doesn't
// surface it to the user, and a crashing bridge produces a generic
// "Not connected" error from Gemini-CLI's MCP client — useless for
// triage. Logging to a known path lets the user (or us, during dev)
// inspect what the bridge actually did between initialize and the
// failing tools/call. Truncated to ~1 MB so it doesn't grow forever.
//
// Path: ~/Library/Logs/AGBench/bridge-subprocess.log (macOS standard
// log location; Logs/ is auto-created if missing). On other platforms
// falls back to userData/bridge-subprocess.log via app.getPath, which
// in the bridge subprocess works the same way it does in main.
//
// We resolve the log path lazily on first write so any errors during
// resolution can't crash the bridge before it has a chance to log
// them.
let bridgeLogPath: string | null = null
let bridgeLogResolved = false
const BRIDGE_LOG_MAX_BYTES = 1_048_576

function resolveBridgeLogPath(): string | null {
  if (bridgeLogResolved) return bridgeLogPath
  bridgeLogResolved = true
  try {
    const logsDir = join(os.homedir(), 'Library', 'Logs', 'AGBench')
    fsSync.mkdirSync(logsDir, { recursive: true })
    bridgeLogPath = join(logsDir, 'bridge-subprocess.log')
    // Truncate if oversized — keeps the log focused on the most
    // recent session without accumulating cruft.
    try {
      const stat = fsSync.statSync(bridgeLogPath)
      if (stat.size > BRIDGE_LOG_MAX_BYTES) {
        fsSync.writeFileSync(bridgeLogPath, '')
      }
    } catch {
      // File doesn't exist yet — fine, will be created on first append.
    }
  } catch {
    bridgeLogPath = null
  }
  return bridgeLogPath
}

function bridgeLog(message: string): void {
  const path = resolveBridgeLogPath()
  if (!path) return
  try {
    const line = `[${new Date().toISOString()}] pid=${process.pid} ${message}\n`
    fsSync.appendFileSync(path, line)
  } catch {
    // Logging failures must never crash the bridge.
  }
}

function startGeminiMcpBridgeProcess(): void {
  const socketPath = parseBridgeSocketArg()
  const brokerToken = parseBridgeTokenArg()
  bridgeLog(`spawn argv=${JSON.stringify(process.argv.slice(1))} cwd=${process.cwd()} env.AGENTBENCH_RUN_ID=${process.env.AGENTBENCH_RUN_ID || ''} env.AGENTBENCH_PARENT_PROVIDER=${process.env.AGENTBENCH_PARENT_PROVIDER || ''}`)

  // Defensive: an unhandled exception or rejection in the bridge
  // subprocess will kill the process — and Gemini-CLI then surfaces
  // every subsequent tool call as "Not connected" because its MCP
  // transport sees the child stdin pipe as gone. Catching both here
  // logs the cause to the diagnostic file and KEEPS the process
  // alive so subsequent tool calls can still succeed.
  process.on('uncaughtException', (error) => {
    bridgeLog(`uncaughtException: ${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`)
  })
  process.on('unhandledRejection', (reason) => {
    bridgeLog(`unhandledRejection: ${reason instanceof Error ? `${reason.message}\n${reason.stack}` : String(reason)}`)
  })

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
          handleMcpJsonRpcMessage(socketPath, brokerToken, JSON.parse(body), 'framed')
        } catch (error) {
          bridgeLog(`parse FAILED (framed) err=${error instanceof Error ? error.message : String(error)}`)
          writeMcpError(null, -32700, error instanceof Error ? error.message : String(error), 'framed')
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
        handleMcpJsonRpcMessage(socketPath, brokerToken, JSON.parse(line), 'line')
      } catch (error) {
        bridgeLog(`parse FAILED (line) err=${error instanceof Error ? error.message : String(error)}`)
        writeMcpError(null, -32700, error instanceof Error ? error.message : String(error), 'line')
      }
    }
  }

  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    parseMessages()
  })
  process.stdin.on('end', () => {
    bridgeLog('stdin end — exiting')
    process.exit(0)
  })
  process.stdin.on('close', () => {
    bridgeLog('stdin close — exiting')
    process.exit(0)
  })
  // Surface generic stream errors too — these otherwise vanish.
  process.stdin.on('error', (error) => {
    bridgeLog(`stdin error: ${error instanceof Error ? error.message : String(error)}`)
  })
  process.stdout.on('error', (error) => {
    bridgeLog(`stdout error: ${error instanceof Error ? error.message : String(error)}`)
  })
  process.on('exit', (code) => {
    bridgeLog(`process exit code=${code ?? 'unknown'}`)
  })
  process.stdin.resume()
}

async function selfTestGeminiMcpBridgeProcess(socketPath: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolveSelfTest) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let initialized = false
    let proc: ChildProcess

    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try {
        proc.stdin?.end()
      } catch {}
      if (!proc.killed) {
        proc.kill()
      }
      resolveSelfTest(result)
    }

    const timeout = setTimeout(() => {
      finish({ ok: false, error: 'Timed out waiting for AGBench Gemini MCP bridge self-test.' })
    }, 5_000)

    try {
      proc = spawn(process.execPath, [
        GEMINI_MCP_BRIDGE_ARG,
        GEMINI_MCP_SOCKET_ARG,
        socketPath,
        GEMINI_MCP_TOKEN_ARG,
        geminiMcpBrokerToken
      ], {
        shell: false,
        env: createCliEnv({ FORCE_COLOR: '0', NO_COLOR: '1' }, process.execPath)
      })
    } catch (error) {
      clearTimeout(timeout)
      resolveSelfTest({ ok: false, error: error instanceof Error ? error.message : String(error) })
      return
    }

    proc.stderr?.on('data', (data: Buffer) => {
      stderr = appendLimitedOutput(stderr, data).value
    })

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString('utf8')
      while (true) {
        const lineEnd = stdout.indexOf('\n')
        if (lineEnd < 0) break
        const line = stdout.slice(0, lineEnd).trim()
        stdout = stdout.slice(lineEnd + 1)
        if (!line) continue
        let message: any
        try {
          message = JSON.parse(line)
        } catch (error) {
          finish({ ok: false, error: error instanceof Error ? error.message : String(error) })
          return
        }
        if (message?.id === 1) {
          if (message.error) {
            finish({ ok: false, error: message.error.message || 'Initialize failed.' })
            return
          }
          initialized = true
          proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n`)
          continue
        }
        if (message?.id === 2) {
          if (message.error) {
            finish({ ok: false, error: message.error.message || 'Ping failed.' })
            return
          }
          proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' })}\n`)
          continue
        }
        if (message?.id === 3) {
          if (message.error) {
            finish({ ok: false, error: message.error.message || 'Tool listing failed.' })
            return
          }
          const tools = Array.isArray(message.result?.tools) ? message.result.tools : []
          const names = new Set(tools.map((tool: any) => String(tool?.name || '')).filter(Boolean))
          const missing = ['write_file', 'replace', 'read_file', 'list_directory', 'run_shell_command'].filter((name) => !names.has(name))
          if (missing.length > 0) {
            finish({ ok: false, error: `AGBench Gemini MCP bridge is connected but missing tools: ${missing.join(', ')}.` })
            return
          }
          finish({ ok: true })
          return
        }
      }
    })

    proc.on('error', (error) => finish({ ok: false, error: error.message }))
    proc.on('close', (code) => {
      if (!settled) {
        finish({
          ok: false,
          error: stderr.trim() || `AGBench Gemini MCP bridge exited before ${initialized ? 'ping completed' : 'initializing'} with code ${code ?? 'unknown'}.`
        })
      }
    })

    proc.stdin?.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agentbench-self-test', version: app.getVersion() || '1.0.0' }
      }
    })}\n`)
  })
}

async function getGeminiMcpBridgeStatus(options: { autoRepairIfEnabled?: boolean; cwd?: string; allowSessionTrustBypass?: boolean } = {}): Promise<GeminiMcpBridgeStatus> {
  const settings = AppStore.getSettings()
  const socketPath = geminiMcpSocketPath()
  if (settings.geminiMcpBridgeEnabled) {
    await startGeminiMcpBroker().catch(() => {})
  }
  let section = await readGeminiCapabilitySection('mcp', options.cwd)
  if (!section.items.length && ![section.stdout, section.stderr].filter(Boolean).join('\n').toLowerCase().includes(GEMINI_MCP_SERVER_NAME)) {
    const debugResult = await runGeminiCapabilityCommand(['mcp', 'list', '--debug'], options.cwd)
    if (debugResult.exitCode === 0 && `${debugResult.stdout}\n${debugResult.stderr}`.toLowerCase().includes(GEMINI_MCP_SERVER_NAME)) {
      section = {
        kind: 'mcp',
        command: ['gemini', ...debugResult.args],
        format: 'raw',
        items: parseCapabilityRawItems(debugResult.stdout, 'mcp'),
        stdout: debugResult.stdout,
        stderr: debugResult.stderr,
        status: debugResult.exitCode,
        timedOut: debugResult.timedOut,
        error: debugResult.error,
        truncated: debugResult.truncated
      }
    }
  }
  const raw = [section.stdout, section.stderr].filter(Boolean).join('\n')
  const staleRegistration = hasStaleGeminiMcpBridgeRegistration(raw, socketPath)
  const bridgeItem = section.items.find((item) => {
    const haystack = `${item.id} ${item.name} ${item.detail || ''} ${item.raw || ''}`.toLowerCase()
    return haystack.includes(GEMINI_MCP_SERVER_NAME)
  })
  const installed = Boolean(bridgeItem || raw.toLowerCase().includes(GEMINI_MCP_SERVER_NAME))
  const disabled = Boolean(bridgeItem && /disabled|inactive|off/i.test(`${bridgeItem.status || ''} ${bridgeItem.raw || ''}`))
  const disconnected = /disconnected|connection\s+refused|failed\s+to\s+connect|not\s+connected|unavailable|error/i.test(
    `${bridgeItem?.status || ''}\n${bridgeItem?.raw || ''}\n${raw}`
  )
  const bridgeSelfTest = installed && disconnected && settings.geminiMcpBridgeEnabled
    ? await selfTestGeminiMcpBridgeProcess(socketPath)
    : null
  const available = Boolean(
    installed &&
    !disabled &&
    !staleRegistration &&
    section.status === 0 &&
    !section.error &&
    !section.timedOut &&
    (!disconnected || bridgeSelfTest?.ok)
  )
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
      ? bridgeSelfTest?.ok
        ? 'AGBench Gemini MCP bridge is installed; direct bridge self-test passed.'
        : 'AGBench Gemini MCP bridge is installed and enabled.'
      : installed && staleRegistration
        ? 'AGBench Gemini MCP bridge registration points at an old app bundle or socket and needs repair.'
      : installed && disabled
        ? 'AGBench Gemini MCP bridge is installed but disabled.'
      : installed && disconnected
        ? bridgeSelfTest?.error
          ? `AGBench Gemini MCP bridge is installed but disconnected: ${bridgeSelfTest.error}`
          : 'AGBench Gemini MCP bridge is installed but disconnected.'
      : installed
          ? 'AGBench Gemini MCP bridge is installed but did not report as available.'
          : 'AGBench Gemini MCP bridge is not installed.'
  }
  if (options.autoRepairIfEnabled && settings.geminiMcpBridgeEnabled && !status.available) {
    try {
      return await repairGeminiMcpBridge(options.cwd)
    } catch (error) {
      const repairMessage = error instanceof Error ? error.message : String(error)
      const repairedStatus: GeminiMcpBridgeStatus = {
        ...status,
        checkedAt: new Date().toISOString(),
        enabled: true,
        available: false,
        error: repairMessage,
        message: `AGBench Gemini MCP bridge auto-repair failed: ${repairMessage}`
      }
      AppStore.updateSettings({ geminiMcpBridgeLastStatus: repairedStatus })
      return repairedStatus
    }
  }
  AppStore.updateSettings({ geminiMcpBridgeLastStatus: status })
  return status
}

function buildGeminiMcpBridgeAddArgs(scope: GeminiMcpRegistrationScope, socketPath: string): string[] {
  return [
    'mcp',
    'add',
    GEMINI_MCP_SERVER_NAME,
    process.execPath,
    GEMINI_MCP_BRIDGE_ARG,
    GEMINI_MCP_SOCKET_ARG,
    socketPath,
    GEMINI_MCP_TOKEN_ARG,
    geminiMcpBrokerToken,
    '--scope',
    scope,
    '--trust',
    ...AGENTBENCH_MCP_TOOLS.map((tool) => `--include-tools=${tool}`)
  ]
}

function redactGeminiMcpBridgeArgs(args: string[]): string[] {
  return args.map((arg, index) => args[index - 1] === GEMINI_MCP_TOKEN_ARG ? '[redacted-token]' : arg)
}

async function addGeminiMcpBridgeRegistration(
  geminiBinaryPath: string,
  scope: GeminiMcpRegistrationScope,
  socketPath: string,
  cwd?: string
): Promise<void> {
  const addArgs = buildGeminiMcpBridgeAddArgs(scope, socketPath)
  const addResult = await captureProcessOutput(geminiBinaryPath, addArgs, cwd, 15_000)
  if (addResult.code !== 0) {
    const output = (addResult.stderr || addResult.stdout || addResult.error || 'gemini mcp add failed.').trim()
    const safeArgs = redactGeminiMcpBridgeArgs(addArgs)
    throw new Error(`Gemini MCP bridge ${scope} registration failed (exit ${addResult.code ?? 'unknown'}): gemini ${safeArgs.join(' ')}\n${output}`)
  }
}

function projectGeminiMcpBridgeNeedsRepair(cwd: string, socketPath: string): boolean {
  const settingsPath = join(resolve(cwd), '.gemini', 'settings.json')
  try {
    const raw = fsSync.readFileSync(settingsPath, 'utf-8')
    const settings = JSON.parse(raw)
    const server = settings?.mcpServers?.[GEMINI_MCP_SERVER_NAME]
    if (!server) {
      return false
    }
    const args = Array.isArray(server.args) ? server.args.map(String) : []
    const includeTools = Array.isArray(server.includeTools) ? server.includeTools.map(String) : []
    return (
      server.command !== process.execPath ||
      server.trust !== true ||
      !args.includes(GEMINI_MCP_BRIDGE_ARG) ||
      !args.includes(socketPath) ||
      !args.includes(geminiMcpBrokerToken) ||
      !AGENTBENCH_MCP_TOOLS.every((tool) => includeTools.includes(tool))
    )
  } catch {
    return false
  }
}

async function repairProjectGeminiMcpBridgeIfNeeded(geminiBinaryPath: string, cwd: string, socketPath: string): Promise<void> {
  if (!projectGeminiMcpBridgeNeedsRepair(cwd, socketPath)) {
    return
  }
  await addGeminiMcpBridgeRegistration(geminiBinaryPath, 'project', socketPath, cwd)
}

async function installGeminiMcpBridge(cwd?: string): Promise<GeminiMcpBridgeStatus> {
  await startGeminiMcpBroker()
  const resolved = await resolveCliProviderBinary('gemini')
  if (!resolved.binaryPath) {
    throw new Error(resolved.error || 'Gemini CLI is not configured.')
  }
  const socketPath = geminiMcpSocketPath()
  await addGeminiMcpBridgeRegistration(resolved.binaryPath, 'user', socketPath)
  if (cwd) {
    await repairProjectGeminiMcpBridgeIfNeeded(resolved.binaryPath, cwd, socketPath)
  }
  await captureProcessOutput(resolved.binaryPath, ['mcp', 'enable', GEMINI_MCP_SERVER_NAME], undefined, 8_000)
  geminiMcpBridgeInstalledForCurrentToken = true
  AppStore.updateSettings({ geminiMcpBridgeEnabled: true })
  return getGeminiMcpBridgeStatus(cwd ? { cwd } : undefined)
}

async function repairGeminiMcpBridge(cwd?: string): Promise<GeminiMcpBridgeStatus> {
  if (!geminiMcpBridgeRepairPromise) {
    geminiMcpBridgeRepairPromise = installGeminiMcpBridge(cwd).finally(() => {
      geminiMcpBridgeRepairPromise = null
    })
  }
  const status = await geminiMcpBridgeRepairPromise
  if (!cwd) {
    return status
  }
  const resolved = await resolveCliProviderBinary('gemini')
  if (!resolved.binaryPath) {
    return status
  }
  const socketPath = geminiMcpSocketPath()
  await repairProjectGeminiMcpBridgeIfNeeded(resolved.binaryPath, cwd, socketPath)
  return getGeminiMcpBridgeStatus({ cwd })
}

async function setGeminiMcpBridgeEnabled(enabled: boolean): Promise<GeminiMcpBridgeStatus> {
  AppStore.updateSettings({ geminiMcpBridgeEnabled: Boolean(enabled) })
  if (enabled) {
    return repairGeminiMcpBridge()
  }
  geminiMcpBridgeInstalledForCurrentToken = false
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

async function prepareGeminiMcpBridgeForRun(
  sender: Electron.WebContents,
  cwd: string,
  route?: AgentRunRoute | null,
  scope: ChatScope = 'workspace',
  sessionTrust: boolean = false,
  options: { requireWriteTools?: boolean } = {}
): Promise<AgentRunRoute> {
  const routed = routeWithRunId('gemini', route)
  const settings = AppStore.getSettings()
  const resolvedCwd = resolve(cwd)
  const requireWriteTools = Boolean(options.requireWriteTools && scope !== 'global')
  if (settings.geminiMcpBridgeEnabled || requireWriteTools) {
    if (requireWriteTools && !settings.geminiMcpBridgeEnabled) {
      sendAgentCompatLine(sender, 'gemini', {
        type: 'provider_warning',
        provider: 'gemini',
        severity: 'warning',
        title: 'Gemini MCP bridge auto-repair',
        message: 'Write-capable Gemini runs require the AGBench MCP bridge. AGBench is enabling and repairing it before launch.'
      }, routed)
      AppStore.updateSettings({ geminiMcpBridgeEnabled: true })
    }
    await startGeminiMcpBroker()
    if (!geminiMcpBridgeInstalledForCurrentToken) {
      await repairGeminiMcpBridge(resolvedCwd)
    }
    const status = await getGeminiMcpBridgeStatus({
      autoRepairIfEnabled: true,
      cwd: resolvedCwd,
      allowSessionTrustBypass: sessionTrust
    })
    if (!status.available) {
      throw new Error(`AGBench Gemini MCP bridge repair failed: ${status.message || status.error || 'unknown status'}. Gemini write-capable mode was not launched because it would start without file-edit tools.`)
    }
    if (requireWriteTools) {
      const toolSelfTest = await selfTestGeminiMcpBridgeProcess(geminiMcpSocketPath())
      if (!toolSelfTest.ok) {
        throw new Error(`AGBench Gemini MCP bridge repair failed: ${toolSelfTest.error || 'write tools were not advertised by the bridge'}. Gemini write-capable mode was not launched because it would start without file-edit tools.`)
      }
    }
  }

  activeGeminiToolContext = {
    sender,
    scope,
    cwd: resolvedCwd,
    ...(scope === 'workspace' ? { workspacePath: resolvedCwd } : {}),
    ...routed
  }
  registerRunSession('gemini', sender, routed, scope === 'workspace' ? resolvedCwd : undefined, activeGeminiToolContext, activeGeminiToolContext.providerSessionId || null)
  return routed
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
  if (!target || target.toLowerCase() === 'unknown') {
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
  worktree: GeminiWorktreeLaunchOption = null,
  allowAgentbenchMcp: boolean = false
): string | null {
  args.push('--sandbox', '--approval-mode', approvalMode)

  if (allowAgentbenchMcp) {
    args.push('--allowed-mcp-server-names', GEMINI_MCP_SERVER_NAME)
    for (const toolName of GEMINI_MCP_ALLOWED_TOOL_NAMES) {
      args.push(`--allowed-tools=${toolName}`)
    }
  }

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
  const useGlassWindow = isMac
    && (settings.appearanceMode === 'native_glass' || settings.appearanceMode === 'soft_glass')
    && !settings.reduceTransparency
  const nextState = `${useGlassWindow ? NATIVE_GLASS_VIBRANCY : 'off'}:${settings.appearanceMode}:${settings.reduceTransparency ? 'reduced' : 'normal'}`
  if (targetWindow === mainWindow && appliedNativeGlassState === nextState) {
    return
  }
  if (useGlassWindow) {
    targetWindow.setVibrancy(NATIVE_GLASS_VIBRANCY)
    targetWindow.setBackgroundColor('#00000000')
  } else {
    targetWindow.setVibrancy(null)
    targetWindow.setBackgroundColor('#1e1e1e')
  }
  if (targetWindow === mainWindow) {
    appliedNativeGlassState = nextState
  }
}

function windowBoundsAreVisible(bounds: AppSettings['windowBounds']): boolean {
  if (!bounds || bounds.x === undefined || bounds.y === undefined) return false
  const minimumVisibleSize = 80
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    const right = bounds.x! + bounds.width
    const bottom = bounds.y! + bounds.height
    const overlapWidth = Math.min(right, area.x + area.width) - Math.max(bounds.x!, area.x)
    const overlapHeight = Math.min(bottom, area.y + area.height) - Math.max(bounds.y!, area.y)
    return overlapWidth >= minimumVisibleSize && overlapHeight >= minimumVisibleSize
  })
}

function resolveInitialWindowPlacement(settings: AppSettings) {
  const savedBounds = sanitizeWindowBounds(settings.windowBounds)
  const shouldUseSavedPosition = windowBoundsAreVisible(savedBounds)
  return {
    width: savedBounds?.width || DEFAULT_WINDOW_WIDTH,
    height: savedBounds?.height || DEFAULT_WINDOW_HEIGHT,
    ...(shouldUseSavedPosition ? { x: savedBounds!.x, y: savedBounds!.y } : {}),
    isMaximized: Boolean(savedBounds?.isMaximized)
  }
}

let windowBoundsSaveTimer: ReturnType<typeof setTimeout> | null = null
let lastPersistedWindowBoundsJson = ''

function persistMainWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
  const bounds = mainWindow.getNormalBounds()
  const windowBounds = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: mainWindow.isMaximized()
  }
  const nextJson = JSON.stringify(windowBounds)
  if (nextJson === lastPersistedWindowBoundsJson) return
  lastPersistedWindowBoundsJson = nextJson
  AppStore.updateSettings({ windowBounds })
}

function schedulePersistMainWindowBounds(): void {
  if (windowBoundsSaveTimer) clearTimeout(windowBoundsSaveTimer)
  windowBoundsSaveTimer = setTimeout(() => {
    windowBoundsSaveTimer = null
    persistMainWindowBounds()
  }, 1000)
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const settings = AppStore.getSettings()
  const useGlassWindow = isMac
    && (settings.appearanceMode === 'native_glass' || settings.appearanceMode === 'soft_glass')
    && !settings.reduceTransparency
  const nativeVibrancy = resolveNativeVibrancy(useGlassWindow)
  const initialPlacement = resolveInitialWindowPlacement(settings)

  mainWindow = new BrowserWindow({
    width: initialPlacement.width,
    height: initialPlacement.height,
    ...(initialPlacement.x !== undefined ? { x: initialPlacement.x } : {}),
    ...(initialPlacement.y !== undefined ? { y: initialPlacement.y } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    vibrancy: nativeVibrancy,
    backgroundMaterial: (!isMac && (settings.appearanceMode === 'native_glass' || settings.appearanceMode === 'soft_glass') && !settings.reduceTransparency) ? 'acrylic' : undefined,
    visualEffectState: 'active',
    transparent: false,
    backgroundColor: useGlassWindow ? '#00000000' : '#1e1e1e',
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

  if (initialPlacement.isMaximized) {
    mainWindow.maximize()
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    emitDueScheduledTasks()
  })
  mainWindow.on('resize', schedulePersistMainWindowBounds)
  mainWindow.on('move', schedulePersistMainWindowBounds)
  mainWindow.on('maximize', persistMainWindowBounds)
  mainWindow.on('unmaximize', persistMainWindowBounds)
  mainWindow.on('close', () => {
    if (windowBoundsSaveTimer) {
      clearTimeout(windowBoundsSaveTimer)
      windowBoundsSaveTimer = null
    }
    persistMainWindowBounds()
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
  registerProductCrashHandlers()

  // Phase B1: centralize run-event fan-out via the bus. The Electron IPC
  // sink replays today's "send to the originating WebContents" behavior, so
  // the renderer sees an identical event stream. The debug-logger sink
  // (gated by AGBENCH_DEBUG_BUS) is the proof of fan-out: when enabled, you
  // can see every published event in the main-process console without
  // touching publish call sites. Future remote-bridge sinks (Phase C) plug
  // in here too.
  runEventBus.subscribe(makeElectronIpcSink())
  if (process.env.AGBENCH_DEBUG_BUS === '1' || process.env.AGBENCH_DEBUG_BUS === 'true') {
    runEventBus.subscribe(makeDebugLoggerSink())
  }

  // Phase C4: workspace allowlist is constructed unconditionally so the
  // admin IPC handlers (`bridge-allowlist-*`) can manage entries even when
  // the daemon itself is not yet running. The router and daemon spawn below
  // are still gated by `AGBENCH_BRIDGE_DAEMON`.
  const bridgeAllowlistPath = join(app.getPath('userData'), 'bridge', 'remote-workspaces.json')
  const bridgeAllowlist = new RemoteWorkspaceAllowlist({
    storagePath: bridgeAllowlistPath,
    log: (line) => {
      // eslint-disable-next-line no-console
      console.log(line)
    }
  })
  const workspaceService = new WorkspaceService({
    appStore: AppStore,
    allowlist: bridgeAllowlist,
    canonicalPath,
    selectDirectory: async () => {
      if (!mainWindow) return null
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
      })
      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      return result.filePaths[0]
    },
    checkTrust: (workspacePath) => TrustStatusService.checkTrust(workspacePath)
  })
  const runQueueService = new RunQueueService({
    appStore: AppStore,
    getRunRepository,
    normalizeExternalPathGrants,
    requireGlobalChat,
    requireRegisteredWorkspace,
    findRegisteredWorkspace,
    validateChatWorkspaceIdentity,
    isProviderActive: (provider) => runManager.getActiveByProvider(provider).length > 0
  })
  runQueueServiceRef = runQueueService

  // Phase C5 scaffold: APNs wake-on-approval. Today both the pusher and
  // token store are wired as no-ops / persistent stubs; the real APNs
  // HTTP/2 client lands when the iOS companion app + Apple Developer
  // credentials are ready. Constructing them unconditionally means
  // ApprovalService can call `bridgeApnsPusher.pushApprovalNeeded(...)`
  // safely once the approval flow is wired through, without a flag dance.
  const bridgeApnsTokenStorePath = join(app.getPath('userData'), 'bridge', 'apns-tokens.json')
  const bridgeApnsTokenStore = new BridgeApnsTokenStore({
    storagePath: bridgeApnsTokenStorePath,
    log: (line) => {
      // eslint-disable-next-line no-console
      console.log(line)
    }
  })
  const bridgeApnsPusher = createBridgeApnsPusher({
    log: (line) => {
      // eslint-disable-next-line no-console
      console.log(line)
    }
  })

  // Publish to module-scope refs so top-level approval helpers can fan
  // out a wake-push via `notifyPairedDevicesOfApproval`. See the helper
  // definition near the top of this file.
  bridgeApnsTokenStoreRef = bridgeApnsTokenStore
  bridgeApnsPusherRef = bridgeApnsPusher

  // Phase C0: optional GuiGeminiBridge daemon spawn — only when the
  // AGBENCH_BRIDGE_DAEMON env var is set (default-off so this doesn't affect
  // production startup until Phase C-late). On macOS the daemon imports
  // BridgeCore and proves the GUIGemini product configuration loads cleanly.
  // Phase C1+ will replace this proof-of-life with real stdio JSON-RPC.
  let bridgeDaemon: BridgeDaemonClient | null = null

  if (process.platform === 'darwin' &&
      (process.env.AGBENCH_BRIDGE_DAEMON === '1' || process.env.AGBENCH_BRIDGE_DAEMON === 'true')) {
    // Phase C-late: action executor wires policy-cleared actions to real
    // main-process services. Wired today: `cancelRun`, `approvalReply`,
    // `composerPrompt`. The remaining two variants (`questionReply` /
    // `questionReject`) return "scaffolded, not wired" — they need the
    // underlying typed-answer plumbing in `processAgentApprovalResponse`
    // (which currently discards typed user input) before iOS can wire
    // through meaningfully.
    //
    // composerPrompt builds an AgentRunPayload from the iOS-side action
    // and dispatches via `dispatchAgentRun` with `mainWindow.webContents`
    // as the sender. The renderer's existing IPC subscribers see the
    // run as if a desktop user had started it — the iOS-initiated run
    // appears live in the desktop transcript. iOS gets only the initial
    // appRunId today; streaming events back to iOS is a future slice.
    const bridgeActionExecutor = new MainProcessActionExecutor({
      cancelRunFn: async (provider, runId) => {
        return providerAdapters.require(assertProviderId(provider)).cancel(runId)
      },
      respondApprovalFn: async (requestId, action) => {
        // iOS-side decision values are a strict subset of AgentApprovalAction
        // ('accept' | 'acceptForSession' | 'decline'). Pass-through is safe.
        // Phase B3: now routed through approvalService.resolve().
        return approvalService?.resolve(requestId, action) ?? false
      },
      registerApnsTokenFn: async (action) => {
        // Light validation beyond what the decoder did — same shape the
        // store's upsert enforces. Thrown errors become the executor's
        // "registration failed" message.
        try {
          bridgeApnsTokenStore.upsert(action.pairID, action.deviceToken, action.env)
          return { registered: true }
        } catch (err) {
          return {
            registered: false,
            reason: err instanceof Error ? err.message : String(err)
          }
        }
      },
      composerPromptFn: async (action) => {
        // Resolve workspace path from the iOS-supplied workspaceId.
        const workspaceRecord = AppStore.getWorkspaces().find((w) => w.id === action.workspaceId)
        if (!workspaceRecord) {
          return {
            dispatched: false,
            appRunId: null,
            reason: `Workspace id "${action.workspaceId}" is not registered`
          }
        }
        // Need a sender for adapter event streaming. The main renderer
        // window is the natural target — iOS-initiated runs surface in
        // the desktop transcript live. When no window is open (rare —
        // background daemon-only mode), we skip dispatch.
        const sender = mainWindow?.webContents
        if (!sender || sender.isDestroyed()) {
          return {
            dispatched: false,
            appRunId: null,
            reason: 'No main window available for run streaming'
          }
        }
        // Synthesize a minimal IpcMainInvokeEvent. Adapters access
        // `event.sender` for streaming; other fields are unused in the
        // run path, so a duck-typed shim is sufficient.
        const fakeEvent = { sender } as unknown as Electron.IpcMainInvokeEvent
        const payload: AgentRunPayload = {
          // iOS-initiated runs are always scoped to a workspace (the
          // bridge router only forwards actions whose workspaceId is in
          // the RemoteWorkspaceAllowlist, and that list rejects global
          // scope). The earlier 'chat' literal was a pre-existing typo
          // that the typechecker now catches.
          provider: assertProviderId(action.provider),
          scope: 'workspace',
          workspace: workspaceRecord.path,
          prompt: action.text,
          appChatId: action.threadId,
          approvalMode: action.approvalMode,
          model: action.model
        }
        try {
          const result = await dispatchAgentRun(payload, fakeEvent)
          return {
            dispatched: result.dispatched,
            appRunId: result.appRunId || null,
            reason: result.dispatched ? undefined : 'Run preflight failed or runtime profile error'
          }
        } catch (err) {
          return {
            dispatched: false,
            appRunId: null,
            reason: err instanceof Error ? err.message : String(err)
          }
        }
      },
      log: (line) => {
        // eslint-disable-next-line no-console
        console.log(line)
      }
    })
    // Phase C3.6: daemon → Electron request router. Default policy denies
    // every action ack request; set AGBENCH_BRIDGE_PERMISSIVE=1 for local
    // end-to-end testing. Phase C4: also consults the workspace allowlist
    // for prepare-start-turn decisions. Phase C-late: dispatches accepted
    // actions through the executor for real effect (cancel run, etc.).
    const bridgeActionRouter = BridgeActionRouter.fromEnvironment(
      (line) => {
        // eslint-disable-next-line no-console
        console.log(line)
      },
      bridgeAllowlist,
      bridgeActionExecutor
    )
    bridgeDaemon = new BridgeDaemonClient({
      onHello: (hello) => {
        // eslint-disable-next-line no-console
        console.log('[BridgeDaemon] hello:', JSON.stringify(hello))
      },
      onStderr: (text) => {
        // eslint-disable-next-line no-console
        console.error('[BridgeDaemon stderr]', text.trimEnd())
      },
      onExit: (code) => {
        // eslint-disable-next-line no-console
        console.log(`[BridgeDaemon] exited with code ${code ?? 'unknown'}`)
      },
      // Phase C3-late: surface daemon-pushed notifications. Today these are
      // `bridge.didReceive*` from the QUIC transport (ActionWake, ActionRecord,
      // PrepareStartTurn, WatchedThreads) plus arbitrary `bridge.testNotify`
      // emissions. Logging only for now — Phase C-late will route into
      // RunService / ApprovalService.
      onNotification: (method, params) => {
        // eslint-disable-next-line no-console
        console.log(`[BridgeDaemon notif] ${method}`, JSON.stringify(params))
        if (method === 'bridge.didReceivePairingResponse' &&
            mainWindow &&
            !mainWindow.isDestroyed() &&
            !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('bridge-pairing-response-received', params)
        }
      },
      // Phase C3.6: daemon-issued requests (e.g. `bridge.requestActionAck`,
      // `bridge.requestPrepareStartTurnAck`) flow into the router. The router
      // returns a JSON object the client wraps into a JSON-RPC response and
      // writes back on stdin; the daemon's `BridgeRequester` awaiter resumes
      // and the typed Swift `BridgeActionAck` (or PrepareStartTurnAck) is
      // built from it. Until C4 lands, every decision is deny-by-default.
      onRequest: (method, params) => bridgeActionRouter.route(method, params)
    })
    bridgeDaemon.start().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[BridgeDaemon] failed to start:', err instanceof Error ? err.message : String(err))
    })

    // Phase C-late: forward every RunEventBus event to the daemon. The
    // sink uses the bus's fan-out infrastructure (designed for exactly
    // this in Phase B) so adapter call sites don't change. The daemon
    // re-publishes inbound `bridge.runEvent` notifications to any
    // connected iOS devices via QUIC (Swift slice, separate).
    //
    // Subscribed only while the daemon is enabled — when daemon is off
    // the bus runs with just the Electron IPC sink (legacy behavior).
    // Pin a non-null reference for the closure; the daemon is guaranteed
    // initialized at this point (we're inside the AGBENCH_BRIDGE_DAEMON
    // guard + the `new BridgeDaemonClient(...)` block above), but TS
    // narrows `let bridgeDaemon: BridgeDaemonClient | null` back to the
    // union as soon as it crosses a closure boundary.
    const bridgeDaemonForSink = bridgeDaemon
    const unsubscribeBridgeRunSink = runEventBus.subscribe(
      makeBridgeRunEventSink({
        notifier: { notify: (method, params) => bridgeDaemonForSink.notify(method, params) },
        log: process.env.AGBENCH_DEBUG_BUS === '1'
          ? // eslint-disable-next-line no-console
            (line) => console.log(line)
          : undefined
      })
    )

    // Ensure the daemon is torn down when the app quits.
    app.on('will-quit', () => {
      unsubscribeBridgeRunSink()
      bridgeDaemon?.dispose()
    })
  }

  const startupRecoveryRecords = AppStore.recoverRunQueueAfterStartup()
  recordStartupRecoveryEvents(startupRecoveryRecords)
  AppStore.recoverExpiredApprovalLedger()
  void getGeminiMcpBridgeStatus({
    autoRepairIfEnabled: AppStore.getSettings().geminiMcpBridgeEnabled
  }).catch(() => {})

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
    window.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') {
        return
      }
      recordProductCrash({
        source: 'renderer',
        severity: details.reason === 'crashed' || details.reason === 'oom' ? 'error' : 'warning',
        processType: 'renderer',
        reason: details.reason,
        exitCode: details.exitCode,
        message: `Renderer process exited: ${details.reason || 'unknown'}`,
      })
    })
  })

  // Bridge / iOS remote allowlist (Phase C4 admin surface)
  // The four handlers below proxy to the in-process `RemoteWorkspaceAllowlist`
  // which persists at `<userData>/bridge/remote-workspaces.json`. They are
  // unconditionally registered so the renderer can manage allowlist entries
  // even when the daemon is not running.
  ipcMain.handle('bridge-allowlist-list', () => workspaceService.listRemoteAllowlist())
  ipcMain.handle(
    'bridge-allowlist-upsert',
    (_, entry: {
      workspaceId: string
      path: string
      mode: 'read-only' | 'read-write'
      allowedProviders: string[]
      allowedApprovalModes: string[]
      expiresAt?: number
    }) => workspaceService.upsertRemoteAllowlist(entry)
  )
  ipcMain.handle('bridge-allowlist-remove', (_, workspaceId: string) =>
    workspaceService.removeRemoteAllowlist(workspaceId)
  )
  ipcMain.handle('bridge-allowlist-clear', () => workspaceService.clearRemoteAllowlist())

  // Phase E3: Bridge Networking — detection + status for the
  // Settings panel. Returns the LAN serviceName (used for Bonjour
  // discovery) and the Tailscale status (cached for ~5 seconds so
  // refresh clicks don't re-run the CLI on every keystroke).
  let cachedTailscaleStatus: Awaited<ReturnType<typeof detectTailscale>> | null = null
  let cachedTailscaleAt = 0
  const TAILSCALE_CACHE_TTL_MS = 5_000
  ipcMain.handle('bridge-networking-status', async () => {
    const now = Date.now()
    if (!cachedTailscaleStatus || now - cachedTailscaleAt > TAILSCALE_CACHE_TTL_MS) {
      cachedTailscaleStatus = await detectTailscale()
      cachedTailscaleAt = now
    }
    return {
      lan: {
        enabled: process.platform === 'darwin' &&
          (process.env.AGBENCH_BRIDGE_DAEMON === '1' ||
            process.env.AGBENCH_BRIDGE_DAEMON === 'true'),
        bonjourServiceType: '_guigemini-bridge._tcp',
        // Hostname the daemon broadcasts under. Currently the OS
        // hostname; future revs may make this configurable.
        hostname: os.hostname()
      },
      tailscale: cachedTailscaleStatus
    }
  })

  // Phase G2: auto-update wiring. Default-off (env override available).
  // Only enabled in packaged builds AND when updateChannel != 'debug'.
  // The `AGBENCH_AUTO_UPDATE` env var forces enable/disable for
  // staging tests:
  //   AGBENCH_AUTO_UPDATE=off  → forced disabled (even in production)
  //   AGBENCH_AUTO_UPDATE=on   → forced enabled (even in dev — useful
  //                              for testing the checker against a
  //                              local update feed)
  //   unset                    → enabled when app.isPackaged + channel != 'debug'
  const updateService = new UpdateService({
    log: (line) => {
      // eslint-disable-next-line no-console
      console.log(line)
    }
  })
  const autoUpdateForce = process.env.AGBENCH_AUTO_UPDATE
  const autoUpdateEnabledByDefault = app.isPackaged
  const autoUpdateEnabled = autoUpdateForce === 'on'
    ? true
    : autoUpdateForce === 'off'
      ? false
      : autoUpdateEnabledByDefault
  const initialSettings = AppStore.getSettings()
  updateService.configure({
    channel: initialSettings.updateChannel,
    enabled: autoUpdateEnabled
  })
  // Broadcast snapshot changes to the renderer so the Settings panel
  // can show live status.
  updateService.subscribe((snapshot: UpdateStateSnapshot) => {
    try {
      mainWindow?.webContents.send('update-status-changed', snapshot)
    } catch {
      // Window may be destroyed during a long-running download — ignore.
    }
  })
  const settingsService = new SettingsService({
    getSettings: () => AppStore.getSettings(),
    updateSettings: (partial) => AppStore.updateSettings(partial),
    sanitizeSettingsPatch,
    sideEffects: [
      ({ sanitizedPatch }) => {
        // Phase G2: re-configure the auto-updater when the user flips
        // the updateChannel. Settings → System gets the live effect
        // without a restart.
        if (sanitizedPatch.updateChannel !== undefined) {
          updateService.configure({
            channel: sanitizedPatch.updateChannel,
            enabled: autoUpdateEnabled
          })
        }
      }
    ]
  })
  const composerService = new ComposerService({
    appStore: AppStore,
    getSettings: () => AppStore.getSettings()
  })
  const chatService = new ChatService({
    appStore: AppStore,
    findRegisteredWorkspace,
    canonicalPath,
    sanitizeChatForSave,
    appendDurableRunEventForRoute
  })
  ipcMain.handle('update-snapshot', () => updateService.snapshot())
  ipcMain.handle('check-for-updates', async () => {
    await updateService.checkForUpdates()
    return updateService.snapshot()
  })
  ipcMain.handle('download-update', async () => {
    await updateService.downloadUpdate()
    return updateService.snapshot()
  })
  ipcMain.handle('install-update-on-quit', () => {
    updateService.installOnQuit()
    return updateService.snapshot()
  })
  ipcMain.handle('install-update-now', () => {
    updateService.quitAndInstall()
    return updateService.snapshot()
  })

  ipcMain.handle('bridge-finalize-pairing', async (_, sessionID: string, userConfirmed: boolean) => {
    const pairingSessionID = requireNonEmptyString(sessionID, 'Pairing session id')
    if (!bridgeDaemon) {
      throw new Error('Bridge daemon is not running')
    }
    return bridgeDaemon.request('bridge.finalizePairing', {
      pairingSessionID,
      userConfirmed: Boolean(userConfirmed)
    })
  })

  // Settings
  ipcMain.handle('get-settings', () => settingsService.getSettings())
  ipcMain.handle('update-settings', (_, partial: Partial<AppSettings>) => settingsService.updateSettings(partial))
  ipcMain.handle('compose-run', (_, input: ComposerInput) => composerService.composeRun(input))

  // Runtime profiles
  ipcMain.handle('get-runtime-profiles', (_, provider?: ProviderId) => {
    return AppStore.getRuntimeProfiles(provider ? assertProviderId(provider) : undefined)
  })
  ipcMain.handle('save-runtime-profile', (_, profile: Partial<RuntimeProfile> & Pick<RuntimeProfile, 'name' | 'provider'>) => {
    return AppStore.saveRuntimeProfile(sanitizeRuntimeProfileForSave(profile))
  })
  ipcMain.handle('delete-runtime-profile', (_, id: string) => AppStore.deleteRuntimeProfile(requireNonEmptyString(id, 'Runtime profile id')))

  // User-mediated handoffs
  ipcMain.handle('get-handoff-cards', (_, filter?: HandoffCardFilter) => AppStore.getHandoffCards(sanitizeHandoffCardFilter(filter)))
  ipcMain.handle('save-handoff-card', (_, card: Partial<HandoffCard> & Pick<HandoffCard, 'sourceChatId' | 'sourceProvider' | 'summary' | 'finalPrompt'>) => {
    return AppStore.saveHandoffCard(sanitizeHandoffCardForSave(card))
  })
  ipcMain.handle('update-handoff-card', (_, id: string, partial: Partial<HandoffCard>) => {
    return AppStore.updateHandoffCard(requireNonEmptyString(id, 'Handoff card id'), sanitizeHandoffCardPatch(partial))
  })
  ipcMain.handle('delete-handoff-card', (_, id: string) => AppStore.deleteHandoffCard(requireNonEmptyString(id, 'Handoff card id')))

  // Workspaces
  ipcMain.handle('get-workspaces', () => workspaceService.getWorkspaces())
  ipcMain.handle('add-or-update-workspace', (_, path: string, partial: Partial<WorkspaceRecord>) => {
    return workspaceService.addOrUpdateWorkspace(path, partial)
  })
  ipcMain.handle('remove-workspace', (_, id: string) => workspaceService.removeWorkspace(id))
  ipcMain.handle('clear-workspaces', () => workspaceService.clearWorkspaces())

  // Chats
  ipcMain.handle('get-chats', (_, workspaceId?: string) => chatService.getChats(workspaceId))
  ipcMain.handle('get-chat', (_, chatId: string) => chatService.getChat(chatId))
  ipcMain.handle('create-chat', (_, workspaceId: string, workspacePath: string) =>
    chatService.createChat(workspaceId, workspacePath)
  )
  ipcMain.handle('create-global-chat', () => chatService.createGlobalChat())
  // Phase F1: sub-thread creation. The renderer passes the parent chat
  // id plus user choices (provider, delegation prompt, return-result
  // flag). AppStore enforces max-depth-1; we surface any error so the
  // renderer can show it.
  ipcMain.handle('create-sub-thread', (_, args: {
    parentChatId: string
    provider: ProviderId
    delegationPrompt: string
    returnResultToParent: boolean
    workspaceId?: string
    workspacePath?: string
  }) => chatService.createSubThread(args))
  ipcMain.handle('get-sub-threads', (_, parentChatId: string) => chatService.getSubThreads(parentChatId))
  ipcMain.handle('save-chat', (_, chat: ChatRecord) => chatService.saveChat(chat))
  ipcMain.handle('delete-chat', (_, chatId: string) => chatService.deleteChat(chatId))
  ipcMain.handle('clear-chats', (_, workspaceId?: string) => chatService.clearChats(workspaceId))
  
  // Usage
  ipcMain.handle('record-usage', (_, usage: any) => AppStore.recordUsage(usage))
  ipcMain.handle('get-usage', (_, workspaceId?: string, chatId?: string) => AppStore.getUsage(workspaceId, chatId))

  // Scheduled tasks
  ipcMain.handle('get-scheduled-tasks', (_, workspaceId?: string) => AppStore.getScheduledTasks(workspaceId))
  ipcMain.handle('save-scheduled-task', (_, task: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'status'> & Partial<Pick<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'status'>>) => {
    const saved = AppStore.saveScheduledTask(sanitizeScheduledTaskForSave(task))
    mainWindow?.webContents.send('scheduled-tasks-changed', AppStore.getScheduledTasks())
    scheduleNextTaskTimer()
    emitDueScheduledTasks()
    return saved
  })
  ipcMain.handle('update-scheduled-task', (_, id: string, partial: Partial<ScheduledTask>) => {
    const sanitized = sanitizeScheduledTaskPatch(id, partial)
    if (!sanitized) return null
    const updated = AppStore.updateScheduledTask(id, sanitized)
    mainWindow?.webContents.send('scheduled-tasks-changed', AppStore.getScheduledTasks())
    scheduleNextTaskTimer()
    return updated
  })
  ipcMain.handle('delete-scheduled-task', (_, id: string) => {
    AppStore.deleteScheduledTask(id)
    mainWindow?.webContents.send('scheduled-tasks-changed', AppStore.getScheduledTasks())
    scheduleNextTaskTimer()
  })

  // Durable run queue. Renderer requests and observes; main owns persistence and leases.
  ipcMain.handle('get-run-queue-jobs', (_, filter?: RunQueueJobFilter) => runQueueService.getJobs(filter))
  ipcMain.handle('get-run-recovery-records', (_, filter?: RunRecoveryFilter) => getRunRepository().getRunRecoveryRecords(filter || {}))
  ipcMain.handle('request-run-queue-job', (_, job: unknown) => runQueueService.requestJob(job))
  ipcMain.handle(
    'lease-run-queue-job',
    (_, request: { runId?: string; provider?: ProviderId; statusReason?: string } = {}) =>
      runQueueService.leaseJob(request)
  )
  ipcMain.handle(
    'transition-run-queue-job',
    (_, runIdOrId: string, status: RunQueueJobStatus, partial: Partial<RunQueueJob> = {}) =>
      runQueueService.transitionJob(runIdOrId, status, partial)
  )

  // Durable transcript/event store. Writes are main-owned; renderer may only read/replay.
  ipcMain.handle('get-run-events', (_, filter: any = {}) => getRunRepository().getRunEvents(filter || {}))
  ipcMain.handle('get-run-event-replay', (_, runId: string) => getRunRepository().getRunEventReplay(runId))
  ipcMain.handle('get-approval-ledger', (_, filter?: ApprovalLedgerFilter) => AppStore.getApprovalLedger(filter || {}))

  // Product operations
  ipcMain.handle('get-product-operations-status', async () => getProductOperationsStatus())
  ipcMain.handle('get-product-crashes', (_, filter?: ProductCrashFilter) => AppStore.getProductCrashes(filter || {}))
  ipcMain.handle('record-product-crash', (_, input: ProductCrashInput) => {
    return AppStore.recordProductCrash({
      ...input,
      source: input?.source || 'renderer'
    })
  })
  ipcMain.handle('export-product-diagnostics', async (_, requestedPath?: string) => exportProductDiagnostics(requestedPath))
  ipcMain.handle('repair-product-install', async () => repairProductInstall())

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

  ipcMain.handle('get-gemini-mcp-bridge-status', async () => getGeminiMcpBridgeStatus({ autoRepairIfEnabled: true }))
  ipcMain.handle('install-gemini-mcp-bridge', async () => installGeminiMcpBridge())
  ipcMain.handle('set-gemini-mcp-bridge-enabled', async (_, enabled: boolean) => setGeminiMcpBridgeEnabled(Boolean(enabled)))
  ipcMain.handle('run-approved-host-command', async (_, requestId: string) => runApprovedHostCommand(requireNonEmptyString(requestId, 'Request id')))

  ipcMain.handle('list-gemini-sessions', async () => listGeminiSessions())

  // IPC Handlers
  ipcMain.handle('select-workspace', async () => workspaceService.selectWorkspace())

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

    return issueExternalPathGrant({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      provider: 'codex',
      path: selectedPath,
      kind,
      access: access === 'write' ? 'write' : 'read',
      duration: 'thisThread',
      securityScopedBookmark: Array.isArray((result as any).bookmarks) ? (result as any).bookmarks[0] : undefined,
      createdAt: new Date().toISOString()
    })
  })

  ipcMain.handle('list-workspace-files', async (_, workspace: string): Promise<WorkspaceFileEntry[]> => {
    return listWorkspaceFileEntries(requireRegisteredWorkspace(workspace))
  })

  ipcMain.handle('read-workspace-file', async (_, workspace: string, filePath: string): Promise<WorkspaceFileReadResult> => {
    const registeredWorkspace = requireRegisteredWorkspace(workspace)
    const targetPath = resolveWorkspaceChild(registeredWorkspace, filePath)
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
      path: toWorkspaceRelativePath(registeredWorkspace, targetPath),
      content: buffer.toString('utf8'),
      sizeBytes: fileStat.size
    }
  })

  ipcMain.handle('discover-gemini-commands', async (_, workspace: string): Promise<GeminiCommandDiscoveryRecord[]> => {
    return discoverGeminiCommands(requireRegisteredWorkspace(workspace))
  })

  ipcMain.handle('discover-gemini-memory', async (_, workspace: string): Promise<GeminiMemoryDiscoveryRecord[]> => {
    return discoverGeminiMemory(requireRegisteredWorkspace(workspace))
  })

  ipcMain.handle('write-workspace-file', async (_, workspace: string, filePath: string, content: string): Promise<WorkspaceFileReadResult> => {
    const registeredWorkspace = requireRegisteredWorkspace(workspace)
    const targetPath = resolveWorkspaceChild(registeredWorkspace, filePath)
    let previousContent: string | undefined
    let existedBefore = false
    try {
      const previousStat = await fs.stat(targetPath)
      existedBefore = previousStat.isFile()
      if (existedBefore && previousStat.size <= MAX_EDITOR_FILE_BYTES) {
        const previousBuffer = await fs.readFile(targetPath)
        assertTextBuffer(previousBuffer)
        previousContent = previousBuffer.toString('utf8')
      }
    } catch {
      existedBefore = false
    }
    await fs.mkdir(dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, content, 'utf8')
    const fileStat = await fs.stat(targetPath)
    const relativePath = toWorkspaceRelativePath(registeredWorkspace, targetPath)
    const changeSet = AppStore.recordWorkspaceEditorChange({
      workspacePath: registeredWorkspace,
      filePath: relativePath,
      existedBefore,
      previousContent,
      nextContent: content,
      sizeBytes: fileStat.size,
      metadata: {
        origin: 'file-editor'
      }
    })

    return {
      path: relativePath,
      content,
      sizeBytes: fileStat.size,
      changeSet
    }
  })

  ipcMain.handle('get-agent-status', async (_, provider: ProviderId) => {
    return getAgentStatusSnapshot(assertProviderId(provider))
  })

  ipcMain.handle('get-agent-rate-limits', async (_, provider: ProviderId) => {
    provider = assertProviderId(provider)
    if (provider === 'gemini') {
      return fetchGeminiUsageSnapshot()
    }
    if (provider === 'kimi') {
      return fetchKimiUsageSnapshot()
    }
    if (provider === 'claude') {
      return fetchClaudeUsageSnapshot()
    }
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

  ipcMain.handle('create-github-pr', async (_event, payload?: { workspacePath?: string; title?: string; body?: string; draft?: boolean; openInBrowser?: boolean }) => {
    const requestedPath = expandHomePath(payload?.workspacePath || '')
    if (!requestedPath) {
      return { ok: false, error: 'A workspace path is required to open a pull request.' }
    }
    try {
      const stat = await fs.stat(requestedPath)
      if (!stat.isDirectory()) {
        return { ok: false, error: 'Workspace path is not a directory.' }
      }
    } catch {
      return { ok: false, error: 'Workspace path does not exist on disk.' }
    }
    const args = ['pr', 'create']
    const title = typeof payload?.title === 'string' ? payload.title.trim() : ''
    const body = typeof payload?.body === 'string' ? payload.body.trim() : ''
    if (title) {
      args.push('--title', title)
    }
    if (body) {
      args.push('--body', body)
    }
    if (!title && !body) {
      args.push('--fill')
    }
    if (payload?.draft) {
      args.push('--draft')
    }
    return await new Promise<{ ok: boolean; url?: string; error?: string; stderr?: string }>((resolve) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      let child: ReturnType<typeof spawn>
      try {
        child = spawn('gh', args, { cwd: requestedPath, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (error) {
        resolve({ ok: false, error: `Failed to launch \`gh\`: ${error instanceof Error ? error.message : String(error)}` })
        return
      }
      const settle = (result: { ok: boolean; url?: string; error?: string; stderr?: string }) => {
        if (settled) return
        settled = true
        resolve(result)
      }
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
      child.on('error', (error) => {
        const message = (error as NodeJS.ErrnoException)?.code === 'ENOENT'
          ? 'GitHub CLI (`gh`) is not installed or not on PATH. Install it from https://cli.github.com.'
          : `Failed to launch \`gh\`: ${error.message}`
        settle({ ok: false, error: message })
      })
      child.on('close', (code) => {
        const trimmedOut = stdout.trim()
        const trimmedErr = stderr.trim()
        if (code === 0) {
          const url = trimmedOut.match(/https?:\/\/[^\s]+/)?.[0]
          if (url && payload?.openInBrowser !== false) {
            shell.openExternal(url).catch(() => {})
          }
          settle({ ok: true, url, stderr: trimmedErr || undefined })
        } else {
          settle({
            ok: false,
            error: trimmedErr || trimmedOut || `\`gh pr create\` exited with code ${code}.`,
            stderr: trimmedErr || undefined
          })
        }
      })
      setTimeout(() => settle({ ok: false, error: '`gh pr create` timed out after 30s.' }), 30_000)
    })
  })

  ipcMain.handle('get-claude-auth-status', async () => {
    const encryptionAvailable = safeStorage.isEncryptionAvailable()
    const apiKeyConfigured = Boolean(AppStore.getSettings().claudeApiKey)
    const resolved = await resolveCliProviderBinary('claude')
    if (!resolved.binaryPath) {
      return { available: false, authState: 'missing', apiKeyConfigured, encryptionAvailable, binaryPath: null } satisfies import('./store/types').ProviderApiKeyStatus
    }
    const [authState, version] = await Promise.all([readClaudeAuthState(resolved), readResolvedCliVersion(resolved)])
    return { available: true, authState, apiKeyConfigured, encryptionAvailable, version, binaryPath: resolved.binaryPath } satisfies import('./store/types').ProviderApiKeyStatus
  })

  ipcMain.handle('store-claude-api-key', async (_, rawKey: string) => {
    const encrypted = encryptApiKey(String(rawKey || ''))
    AppStore.updateSettings({ claudeApiKey: encrypted || undefined })
    return { stored: Boolean(encrypted), encryptionAvailable: safeStorage.isEncryptionAvailable() }
  })

  ipcMain.handle('clear-claude-api-key', async () => {
    AppStore.updateSettings({ claudeApiKey: undefined })
    return true
  })

  ipcMain.handle('trigger-claude-login', async () => {
    const resolved = await resolveCliProviderBinary('claude')
    if (!resolved.binaryPath) {
      return { ok: false, error: 'Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code' }
    }
    return new Promise<{ ok: boolean; error?: string; code?: number | null }>((resolve) => {
      const child = spawn(resolved.binaryPath!, ['auth', 'login'], {
        shell: false,
        stdio: 'ignore',
        env: createCliEnv({}, resolved.binaryPath)
      })
      child.on('close', (code) => resolve({ ok: code === 0, code }))
      child.on('error', (err) => resolve({ ok: false, error: err.message }))
    })
  })

  ipcMain.handle('get-kimi-auth-status', async () => {
    const encryptionAvailable = safeStorage.isEncryptionAvailable()
    const apiKeyConfigured = Boolean(AppStore.getSettings().kimiApiKey)
    const resolved = await resolveCliProviderBinary('kimi')
    if (!resolved.binaryPath) {
      return { available: false, authState: 'missing', apiKeyConfigured, encryptionAvailable, binaryPath: null } satisfies import('./store/types').ProviderApiKeyStatus
    }
    const version = await readResolvedCliVersion(resolved)
    return { available: true, authState: apiKeyConfigured ? 'api-key' : 'unknown', apiKeyConfigured, encryptionAvailable, version, binaryPath: resolved.binaryPath } satisfies import('./store/types').ProviderApiKeyStatus
  })

  ipcMain.handle('store-kimi-api-key', async (_, rawKey: string) => {
    const encrypted = encryptApiKey(String(rawKey || ''))
    AppStore.updateSettings({ kimiApiKey: encrypted || undefined })
    return { stored: Boolean(encrypted), encryptionAvailable: safeStorage.isEncryptionAvailable() }
  })

  ipcMain.handle('clear-kimi-api-key', async () => {
    AppStore.updateSettings({ kimiApiKey: undefined })
    return true
  })

  ipcMain.handle('get-agent-mcp-status', async (_, provider: ProviderId) => {
    return getAgentMcpStatusSnapshot(assertProviderId(provider))
  })

  ipcMain.handle('get-provider-capabilities', async (_, provider: ProviderId, workspacePath?: string, approvalMode?: string) => {
    return getProviderCapabilityContract(assertProviderId(provider), workspacePath, approvalMode)
  })

  ipcMain.handle('get-provider-adapters', () => getProviderAdapterDescriptors())

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
    const reviewState = createCodexRunState(event.sender, threadId, model, params?.cwd, params?.cwd, 'workspace', route)
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

  // Dispatch an agent run with explicit sender + event. Extracted Phase
  // C-late from the `run-agent` IPC handler body so bridge-initiated
  // (iOS) runs can use the same dispatch path. Returns the resolved
  // appRunId on success (or after error handling fires — the run-id
  // is generated regardless of preflight outcome).
  //
  // For bridge-initiated runs, the caller passes `mainWindow.webContents`
  // as both `event.sender` and the `event` itself (a thin compatibility
  // shim — adapters access `event.sender` for streaming, not the rest
  // of the IpcMainInvokeEvent shape). The renderer's IPC subscribers see
  // those events the same way they would for a renderer-initiated run,
  // so the iOS-initiated run shows up in the desktop transcript live.
  //
  // Phase B1: dispatchAgentRun is now a thin adapter around the
  // extracted RunCoordinator service. The actual dispatch logic lives
  // in src/main/services/RunCoordinator.ts where it's testable with
  // mocked dependencies. Behaviour is byte-identical to the previous
  // inline version.
  const runCoordinator = new RunCoordinator({
    normalizePayload: normalizeAgentRunPayload,
    routeWithRunId,
    applyRuntimeProfileToPayload,
    ensureProviderRunPreflight,
    getAdapter: (provider) => providerAdapters.require(provider),
    sendError: sendAgentCompatError,
    sendExit: sendAgentCompatExit
  })
  // Publish to module-scope so the MCP `delegate_to_subthread` tool
  // (Phase F3) can dispatch agent-driven sub-thread runs without
  // requiring a Gemini-renderer round-trip.
  runCoordinatorRef = runCoordinator
  const dispatchAgentRun = (
    payload: AgentRunPayload,
    event: Electron.IpcMainInvokeEvent
  ): Promise<{ dispatched: boolean; appRunId: string }> => {
    return runCoordinator.dispatch(payload, event)
  }

  ipcMain.handle('run-agent', async (event, payload: AgentRunPayload) => {
    await dispatchAgentRun(payload, event)
  })

  ipcMain.handle('cancel-agent-run', async (_, provider: ProviderId = 'gemini', runId?: string) => {
    const normalizedProvider = assertProviderId(provider || 'gemini')
    return providerAdapters.require(normalizedProvider).cancel(optionalString(runId))
  })

  // Phase B3: ApprovalService construction. Owns the five pending
  // approval registries + the unified resolve dispatch + the
  // wake-push fan-out + the scheduled-timeout integration. See
  // src/main/services/ApprovalService.ts for the full surface and
  // docs/phase-b-handoff.md for the extraction plan.
  const approvalServiceInstance = new ApprovalService({
    runManager,
    permissionService,
    appendDurableRunEventForRoute,
    resolveApprovalLedger: auditService.resolveApprovalLedgerResponse.bind(auditService),
    getCodexClient: () => codexClient,
    sendAgentCompatLine,
    respondToKimiWireRequest,
    runApprovedHostCommand,
    cliProviderProcesses,
    getApnsPusher: () => bridgeApnsPusherRef,
    getApnsTokenStore: () => bridgeApnsTokenStoreRef,
    isUserAtDesktop: userIsAtDesktop,
    workspaceIdForPath: workspaceIdForApprovalPush,
    publishApprovalRunEvent: (approvalEvent) => {
      publishRunEvent('agent-output', approvalEvent.provider, approvalEvent)
    },
    getApprovalTimeoutSettings: () => AppStore.getSettings().approvalTimeouts,
    log: (line) => {
      // eslint-disable-next-line no-console
      console.log(line)
    }
  })
  approvalService = approvalServiceInstance

  // Construct the auto-deny timer scheduler. The onTimeout callback
  // delegates to the shared `handleApprovalTimeout` helper (also in
  // ApprovalService.ts) which writes the durable timeout event,
  // notifies the renderer, and re-enters `approvalService.resolve()`
  // with decisionSource: 'system' + the timeout metadata (Phase E1.2).
  const approvalTimeoutScheduler = new ApprovalTimeoutScheduler(
    DEFAULT_APPROVAL_TIMEOUT_POLICY,
    async (reason: ApprovalTimeoutReason) => {
      await handleApprovalTimeout(approvalServiceInstance, reason, {
        appendDurableRunEventForRoute,
        log: (line) => {
          // eslint-disable-next-line no-console
          console.log(line)
        },
        sendTimeoutToRenderer: (snapshot) => {
          try {
            mainWindow?.webContents.send('agent-approval-timeout', snapshot)
          } catch {
            // Window destroyed — caller's already wrapped this in try/catch.
          }
        }
      })
    },
    {
      log: (line) => {
        // eslint-disable-next-line no-console
        console.log(line)
      }
    }
  )
  approvalServiceInstance.setScheduler(approvalTimeoutScheduler)

  ipcMain.handle('respond-agent-approval', async (_, requestId: string, action: AgentApprovalAction) => {
    return approvalServiceInstance.resolve(requestId, action)
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
    const normalizedPayload = normalizeAgentRunPayload({
      provider: 'gemini',
      workspace,
      prompt,
      model,
      approvalMode,
      sessionTrust,
      imagePaths: imageAttachments,
      providerSessionId: resumeSessionId,
      geminiWorktree: worktree,
      ...runRoute
    })
    normalizedPayload.appRunId = routeWithRunId('gemini', normalizedPayload).appRunId
    if (!(await ensureProviderRunPreflight(event.sender, normalizedPayload))) {
      return
    }
    await runGeminiProvider(event, normalizedPayload)
  })

  ipcMain.handle('cancel-gemini', async (_, runId?: string) => {
    return providerAdapters.require('gemini').cancel(optionalString(runId))
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
    let registeredWorkspace: string
    try {
      registeredWorkspace = requireRegisteredWorkspace(workspace)
    } catch (error) {
      event.sender.send('gemini-session-data', `${error instanceof Error ? error.message : String(error)}\r\n`)
      event.sender.send('gemini-session-exit', -1)
      return
    }
    const sessionRoute = routeWithRunId('gemini')
    const trustPayload: AgentRunPayload = {
      provider: 'gemini',
      scope: 'workspace',
      workspace: registeredWorkspace,
      prompt: '',
      appRunId: sessionRoute.appRunId,
      sessionTrust
    }
    const trustApproved = await ensureWorkspaceTrustForRun(event.sender, trustPayload)
    if (!trustApproved) {
      event.sender.send('gemini-session-data', 'Gemini session blocked by workspace trust policy.\r\n')
      event.sender.send('gemini-session-exit', -1)
      return
    }
    const effectiveSessionTrust = Boolean(sessionTrust && !trustStatusAllowsRun(TrustStatusService.checkTrust(registeredWorkspace).status))

    if (geminiSessionProcess) {
      geminiSessionProcess.kill()
      geminiSessionProcess = null
    }

    const args: string[] = []
    const settings = AppStore.getSettings()
    const effectiveApprovalMode = resolveGeminiApprovalModeForServices(approvalMode, settings)
    if (effectiveApprovalMode !== approvalMode) {
      event.sender.send('gemini-session-data', `Gemini approval mode changed from ${approvalMode} to ${effectiveApprovalMode} because AGBench service settings block write-capable Gemini modes.\r\n`)
    }
    const resumePolicy = resolveGeminiCliResumePolicy(effectiveApprovalMode, resumeSessionId)
    if (resumePolicy.skippedReason) {
      event.sender.send('gemini-session-data', `${resumePolicy.skippedReason}\r\n`)
    }
    const argsError = appendGeminiCliSessionArgs(args, model, effectiveApprovalMode, effectiveSessionTrust, resumePolicy.resumeSessionId, settings.geminiCheckpointingEnabled, worktree, geminiWriteModeRequiresBridge('workspace', effectiveApprovalMode))
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

    let routedSession: AgentRunRoute
    try {
      routedSession = await prepareGeminiMcpBridgeForRun(event.sender, registeredWorkspace, sessionRoute, 'workspace', effectiveSessionTrust, {
        requireWriteTools: geminiWriteModeRequiresBridge('workspace', effectiveApprovalMode)
      })
    } catch (error) {
      event.sender.send('gemini-session-data', `${error instanceof Error ? error.message : String(error)}\r\n`)
      event.sender.send('gemini-session-exit', -1)
      return
    }

    const env: Record<string, string> = createCliEnv({
      FORCE_COLOR: '1',
      GEMINI_SANDBOX: 'true',
      AGENTBENCH_RUN_ID: routedSession.appRunId || '',
      AGENTBENCH_CHAT_ID: routedSession.appChatId || '',
      // Phase I2: tag the Gemini interactive session so the bridge
      // subprocess stamps broker requests as parent='gemini'. Without
      // this the new I2 default could mis-route session tool calls.
      AGENTBENCH_PARENT_PROVIDER: 'gemini'
    }, resolved.binaryPath)

    try {
      geminiSessionProcess = pty.spawn(resolved.binaryPath, args, {
        name: 'xterm-color',
        cols,
        rows,
        cwd: registeredWorkspace,
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
    return getWorkspaceDiff(requireRegisteredWorkspace(workspace))
  })

  ipcMain.handle('get-workspace-change-sets', async (_, filter?: WorkspaceChangeFilter) => {
    return AppStore.getWorkspaceChangeSets(filter || {})
  })

  ipcMain.handle('capture-snapshot', async (_, workspace: string) => {
    return captureWorkspaceSnapshot(requireRegisteredWorkspace(workspace))
  })

  ipcMain.handle('compute-run-diff', async (_, runId: string, preSnapshot: any, postSnapshot: any, changeContext?: Partial<WorkspaceRunChangeInput>) => {
    const runDiff = computeRunDiff(preSnapshot, postSnapshot, runId)
    if (!changeContext || !isRecord(changeContext)) {
      return runDiff
    }

    const workspacePath = requireRegisteredWorkspace(requireNonEmptyString(changeContext.workspacePath, 'Workspace'))
    const workspace = findRegisteredWorkspace(workspacePath)
    if (changeContext.workspaceId && workspace && changeContext.workspaceId !== workspace.id) {
      throw new Error('Run diff workspace id does not match the registered workspace.')
    }
    const effectiveWorkspacePath = changeContext.effectiveWorkspacePath
      ? requireRegisteredWorkspace(changeContext.effectiveWorkspacePath, 'Effective workspace')
      : workspacePath
    const changeSet = AppStore.recordWorkspaceRunChange({
      ...changeContext,
      runId,
      workspaceId: workspace?.id || changeContext.workspaceId,
      workspacePath,
      effectiveWorkspacePath,
      provider: changeContext.provider ? assertProviderId(changeContext.provider) : undefined,
      runDiff
    })
    return {
      ...runDiff,
      changeSetId: changeSet.id
    }
  })

  // Trust Status
  ipcMain.handle('check-trust', (_, workspacePath: string) => workspaceService.checkTrust(workspacePath))

  // PTY for Trust Assistant
  const ptyProcesses = new Map<string, pty.IPty>()
  const stoppedPtySessions = new Set<string>()

  ipcMain.handle('start-pty', async (event, workspacePath: string, sessionId: string = 'default') => {
    const registeredWorkspace = requireRegisteredWorkspace(workspacePath)
    const ptySessionId = optionalString(sessionId) || 'default'
    stoppedPtySessions.delete(ptySessionId)
    const allowed = await requestAgenticServiceApproval(event.sender, 'gemini', 'shellCommands', registeredWorkspace, {
      method: 'pty/start',
      title: 'Approve setup terminal',
      body: `${registeredWorkspace}\n${process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : 'bash')}`,
      preview: {
        kind: 'terminal',
        workspacePath: registeredWorkspace,
        sessionId: ptySessionId
      }
    })
    if (!allowed) {
      event.sender.send('pty-data', 'Terminal start denied by AGBench approval policy.\r\n', ptySessionId)
      event.sender.send('pty-exit', -1, ptySessionId)
      return
    }
    if (stoppedPtySessions.delete(ptySessionId)) {
      event.sender.send('pty-exit', null, ptySessionId)
      return
    }

    const existing = ptyProcesses.get(ptySessionId)
    if (existing) {
      existing.kill()
      ptyProcesses.delete(ptySessionId)
    }
    
    const shellCommand = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash'

    const ptyProcess = pty.spawn(shellCommand, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: registeredWorkspace,
      env: process.env as Record<string, string>
    })
    ptyProcesses.set(ptySessionId, ptyProcess)

    ptyProcess.onData((data) => {
      event.sender.send('pty-data', data, ptySessionId)
    })

    ptyProcess.onExit((e) => {
      event.sender.send('pty-exit', e.exitCode, ptySessionId)
      if (ptyProcesses.get(ptySessionId) === ptyProcess) {
        ptyProcesses.delete(ptySessionId)
      }
    })
  })

  ipcMain.handle('stop-pty', (_, sessionId: string = 'default') => {
    const ptySessionId = optionalString(sessionId) || 'default'
    const ptyProcess = ptyProcesses.get(ptySessionId)
    if (ptyProcess) {
      ptyProcess.kill()
      ptyProcesses.delete(ptySessionId)
    } else {
      stoppedPtySessions.add(ptySessionId)
    }
  })

  ipcMain.handle('pty-write', (_, data: string, sessionId: string = 'default') => {
    const ptyProcess = ptyProcesses.get(optionalString(sessionId) || 'default')
    if (ptyProcess) {
      ptyProcess.write(data)
    }
  })

  ipcMain.handle('pty-resize', (_, cols: number, rows: number, sessionId: string = 'default') => {
    const ptyProcess = ptyProcesses.get(optionalString(sessionId) || 'default')
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
