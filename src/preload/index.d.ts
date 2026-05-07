import { ElectronAPI } from '@electron-toolkit/preload'
import { AppSettings, WorkspaceRecord, ChatRecord, UsageRecord, TrustStatusResult, WorkspaceFileEntry, WorkspaceFileReadResult, GeminiSessionListResult, GeminiWorktreeLaunchOption, ProviderId, ExternalPathGrant, ScheduledTask, GeminiMcpBridgeStatus, ProviderCapabilityContract, RunQueueJob, RunQueueJobFilter, RunEventFilter, RunEventInput, RunEventRecord, RunEventReplay } from '../main/store/types'

type GeminiCapabilityKind = 'mcp' | 'extensions' | 'skills'
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

type AgentApprovalAction = 'accept' | 'acceptForSession' | 'acceptForWorkspace' | 'decline' | 'cancel'

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

interface AgentRunRoute {
  appRunId?: string
  appChatId?: string
}

type GeminiStreamPayload = string | {
  provider?: ProviderId
  appRunId?: string
  appChatId?: string
  data?: string
  error?: string
  code?: number | null
}

interface AgentApprovalRequest {
  id: string
  provider: ProviderId
  appRunId?: string
  appChatId?: string
  method: string
  title: string
  body: string
  preview?: any
  params?: any
  actions: AgentApprovalAction[]
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      selectWorkspace: () => Promise<WorkspaceRecord | null>
      selectImageFiles: () => Promise<string[]>
      selectExternalPathGrant: (access?: 'read' | 'write') => Promise<ExternalPathGrant | null>
      runGemini: (workspace: string, prompt: string, model: string, approvalMode: string, sessionTrust?: boolean, imagePaths?: string[], resumeSessionId?: string | null, worktree?: GeminiWorktreeLaunchOption, route?: AgentRunRoute | null) => Promise<void>
      cancelGemini: (runId?: string) => Promise<void>
      runAgent: (payload: AgentRunPayload) => Promise<void>
      cancelAgentRun: (provider?: ProviderId, runId?: string) => Promise<void>
      getAgentStatus: (provider: ProviderId) => Promise<any>
      getProviderCapabilities: (provider: ProviderId, workspace?: string, approvalMode?: string) => Promise<ProviderCapabilityContract>
      getAgentModels: (provider: ProviderId) => Promise<Array<{ id: string, label?: string, description?: string, isDefault?: boolean, supportedReasoningEfforts?: Array<{ reasoningEffort: string, description?: string }>, defaultReasoningEffort?: string | null, additionalSpeedTiers?: string[] }>>
      getAgentRateLimits: (provider: ProviderId) => Promise<any>
      importCodexUsageCredential: (filePath?: string) => Promise<any>
      clearCodexUsageCredential: () => Promise<boolean>
      getCodexUsageSnapshot: () => Promise<any>
      getAgentMcpStatus: (provider: ProviderId) => Promise<any>
      listAgentThreads: (provider: ProviderId, params?: any) => Promise<any>
      forkAgentThread: (provider: ProviderId, threadId: string, params?: any) => Promise<any>
      rollbackAgentThread: (provider: ProviderId, threadId: string, numTurns?: number) => Promise<any>
      startAgentReview: (provider: ProviderId, threadId: string, params?: any) => Promise<any>
      respondAgentApproval: (requestId: string, action: AgentApprovalAction) => Promise<boolean>
      writeGeminiInput: (data: string) => Promise<boolean>
      getDiff: (workspace: string) => Promise<{ type: 'not_repo' | 'no_changes' | 'changes' | 'error', text?: string, statusText?: string, diffText?: string, summaries?: any[] }>
      listWorkspaceFiles: (workspace: string) => Promise<WorkspaceFileEntry[]>
      readWorkspaceFile: (workspace: string, path: string) => Promise<WorkspaceFileReadResult>
      writeWorkspaceFile: (workspace: string, path: string, content: string) => Promise<WorkspaceFileReadResult>
      captureSnapshot: (workspace: string) => Promise<any>
      computeRunDiff: (runId: string, preSnapshot: any, postSnapshot: any) => Promise<any>
      getGeminiVersion: () => Promise<string>
      getGeminiCapabilities: (workspace?: string) => Promise<GeminiCapabilitiesState>
      getGeminiMcpBridgeStatus: () => Promise<GeminiMcpBridgeStatus>
      installGeminiMcpBridge: () => Promise<GeminiMcpBridgeStatus>
      setGeminiMcpBridgeEnabled: (enabled: boolean) => Promise<GeminiMcpBridgeStatus>
      runApprovedHostCommand: (requestId: string) => Promise<boolean>
      listGeminiSessions: () => Promise<GeminiSessionListResult>
      getHostWeather: () => Promise<HostWeatherState>
      setAppearanceMode: (payload: { mode?: string; reduceTransparency?: boolean } | string) => Promise<boolean>

      checkTrust: (workspacePath: string) => Promise<TrustStatusResult>
      startPty: (workspacePath: string) => Promise<void>
      ptyWrite: (data: string) => Promise<void>
      ptyResize: (cols: number, rows: number) => Promise<void>
      startGeminiSession: (workspace: string, model?: string, approvalMode?: string, sessionTrust?: boolean, cols?: number, rows?: number, resumeSessionId?: string | null, worktree?: GeminiWorktreeLaunchOption) => Promise<void>
      stopGeminiSession: () => Promise<void>
      writeGeminiSession: (data: string) => Promise<void>
      resizeGeminiSession: (cols: number, rows: number) => Promise<void>
      getFileIconDataUrl: (path: string) => Promise<string | null>
      onPtyData: (callback: (data: string) => void) => void
      onPtyExit: (callback: (code: number | null) => void) => void
      removePtyListeners: () => void
      onGeminiSessionData: (callback: (data: string) => void) => void
      onGeminiSessionExit: (callback: (code: number | null) => void) => void
      removeGeminiSessionListeners: () => void

      getSettings: () => Promise<AppSettings>
      updateSettings: (partial: Partial<AppSettings>) => Promise<void>
      getWorkspaces: () => Promise<WorkspaceRecord[]>
      addOrUpdateWorkspace: (path: string, partial?: Partial<WorkspaceRecord>) => Promise<WorkspaceRecord>
      removeWorkspace: (id: string) => Promise<void>
      clearWorkspaces: () => Promise<void>
      getChats: (workspaceId?: string) => Promise<ChatRecord[]>
      getChat: (chatId: string) => Promise<ChatRecord | null>
      createChat: (workspaceId: string, workspacePath: string) => Promise<ChatRecord>
      saveChat: (chat: ChatRecord) => Promise<void>
      deleteChat: (chatId: string) => Promise<void>
      clearChats: (workspaceId?: string) => Promise<void>
      recordUsage: (usage: Omit<UsageRecord, 'id' | 'timestamp'>) => Promise<void>
      getUsage: (workspaceId?: string, chatId?: string) => Promise<UsageRecord[]>
      getScheduledTasks: (workspaceId?: string) => Promise<ScheduledTask[]>
      saveScheduledTask: (task: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'status'> & Partial<Pick<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'status'>>) => Promise<ScheduledTask>
      updateScheduledTask: (id: string, partial: Partial<ScheduledTask>) => Promise<ScheduledTask | null>
      deleteScheduledTask: (id: string) => Promise<void>
      getRunQueueJobs: (filter?: RunQueueJobFilter) => Promise<RunQueueJob[]>
      saveRunQueueJob: (job: Partial<RunQueueJob> & Pick<RunQueueJob, 'runId' | 'provider' | 'workspacePath' | 'source'>) => Promise<RunQueueJob>
      updateRunQueueJob: (runIdOrId: string, partial: Partial<RunQueueJob>) => Promise<RunQueueJob | null>
      deleteRunQueueJob: (runIdOrId: string) => Promise<void>
      appendRunEvent: (event: RunEventInput) => Promise<RunEventRecord>
      appendRunEvents: (events: RunEventInput[]) => Promise<RunEventRecord[]>
      getRunEvents: (filter?: RunEventFilter) => Promise<RunEventRecord[]>
      getRunEventReplay: (runId: string) => Promise<RunEventReplay>

      onGeminiOutput: (callback: (data: GeminiStreamPayload) => void) => void
      onGeminiError: (callback: (error: GeminiStreamPayload) => void) => void
      onGeminiExit: (callback: (code: GeminiStreamPayload | number | null) => void) => void
      onAgentOutput: (callback: (payload: { provider: ProviderId, data: string, appRunId?: string, appChatId?: string }) => void) => void
      onAgentError: (callback: (payload: { provider: ProviderId, error: string, appRunId?: string, appChatId?: string }) => void) => void
      onAgentExit: (callback: (payload: { provider: ProviderId, code: number | null, appRunId?: string, appChatId?: string }) => void) => void
      onRunQueueChanged: (callback: (jobs: RunQueueJob[]) => void) => void
      onRunEventsChanged: (callback: (payload: { runId: string, chatId?: string, workspaceId?: string, sequence: number }) => void) => void
      onAgentApprovalRequest: (callback: (payload: AgentApprovalRequest) => void) => void
      onScheduledTaskDue: (callback: (payload: ScheduledTask) => void) => void
      onScheduledTasksChanged: (callback: (payload: ScheduledTask[]) => void) => void
      removeListeners: () => void
    }
  }
}
