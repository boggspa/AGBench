import { AppSettings, WorkspaceRecord, ChatRecord, UsageRecord, TrustStatusResult, WorkspaceFileEntry, WorkspaceFileReadResult, GeminiSessionListResult, GeminiWorktreeLaunchOption, ProviderId, ChatScope, ExternalPathGrant, ScheduledTask, GeminiMcpBridgeStatus, ProviderApiKeyStatus, ProviderCapabilityContract, ProviderAdapterDescriptor, RunQueueJob, RunQueueJobFilter, RunEventFilter, RunEventRecord, RunEventReplay, ApprovalLedgerFilter, ApprovalLedgerRecord, RunRecoveryFilter, RunRecoveryRecord, WorkspaceChangeFilter, WorkspaceChangeSet, ProductCrashFilter, ProductCrashInput, ProductCrashRecord, ProductDiagnosticsExportResult, ProductOperationsStatus, RuntimeProfile, HandoffCard, HandoffCardFilter, AgenticServiceId } from '../main/store/types'
import type { RemoteWorkspaceEntry } from '../main/RemoteWorkspaceAllowlist'
import type { UpdateStateSnapshot } from '../main/UpdateService'

type GeminiCapabilityKind = 'mcp' | 'extensions' | 'skills' | 'agents'
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
  scope?: 'workspace' | 'global'
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
}

interface ComposerImageAttachment {
  id?: string
  path?: string
  name?: string
}

interface ComposerRunInput {
  chatId: string
  appRunId?: string
  provider?: ProviderId
  scope?: ChatScope
  workspace?: string
  userInput?: string
  prompt?: string
  selectedModelType?: string
  customModel?: string
  overrideModel?: string
  approvalMode?: string
  sessionTrust?: boolean
  attachments?: ComposerImageAttachment[]
  imageAttachments?: ComposerImageAttachment[]
  externalPathGrants?: ExternalPathGrant[]
  geminiWorktree?: GeminiWorktreeLaunchOption
  codexReasoningEffort?: string | null
  codexServiceTier?: string | null
  claudeReasoningEffort?: string | null
  kimiThinkingEnabled?: boolean
  runtimeProfileId?: string
  handoffSourceRunId?: string
  chatSnapshot?: ChatRecord
}

interface ComposerRunMetadata {
  finalPrompt: string
  contextTurnsApplied: number
  applicationLog: string
  providerLabel: string
  requestedModel?: string
  approvalMode: string
  providerSessionId?: string | null
  geminiResumeSkippedReason?: string
  clearLinkedGeminiSession?: boolean
  providerMetadataPatch?: Record<string, unknown>
  codexHandoffApplied?: {
    handoffKey: string
    previousModel: string
    nextModel: string
    appliedAt: string
  }
  uiNoticeMessage?: string
  imagePaths: string[]
  planModeParsed?: boolean
}

type ComposerRunPayload = AgentRunPayload & {
  composer: ComposerRunMetadata
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
    api: {
      getRuntimeVersions: () => NodeJS.ProcessVersions
      selectWorkspace: () => Promise<WorkspaceRecord | null>
      selectImageFiles: () => Promise<string[]>
      selectExternalPathGrant: (access?: 'read' | 'write', provider?: string) => Promise<ExternalPathGrant | null>
      runGemini: (workspace: string, prompt: string, model: string, approvalMode: string, sessionTrust?: boolean, imagePaths?: string[], resumeSessionId?: string | null, worktree?: GeminiWorktreeLaunchOption, route?: AgentRunRoute | null) => Promise<void>
      cancelGemini: (runId?: string) => Promise<void>
      composeRun: (input: ComposerRunInput) => Promise<ComposerRunPayload>
      runAgent: (payload: AgentRunPayload) => Promise<void>
      cancelAgentRun: (provider?: ProviderId, runId?: string) => Promise<void>
      getAgentStatus: (provider: ProviderId) => Promise<any>
      getProviderCapabilities: (provider: ProviderId, workspace?: string, approvalMode?: string) => Promise<ProviderCapabilityContract>
      getProviderAdapters: () => Promise<ProviderAdapterDescriptor[]>
      getAgentModels: (provider: ProviderId) => Promise<Array<{ id: string, label?: string, description?: string, isDefault?: boolean, supportedReasoningEfforts?: Array<{ reasoningEffort: string, description?: string }>, defaultReasoningEffort?: string | null, additionalSpeedTiers?: string[] }>>
      getAgentRateLimits: (provider: ProviderId) => Promise<any>
      importCodexUsageCredential: (filePath?: string) => Promise<any>
      clearCodexUsageCredential: () => Promise<boolean>
      getCodexUsageSnapshot: () => Promise<any>
      createGithubPr: (payload: { workspacePath?: string; title?: string; body?: string; draft?: boolean; openInBrowser?: boolean }) => Promise<{ ok: boolean; url?: string; error?: string; stderr?: string }>
      getClaudeAuthStatus: () => Promise<ProviderApiKeyStatus>
      storeClaudeApiKey: (key: string) => Promise<void>
      clearClaudeApiKey: () => Promise<void>
      triggerClaudeLogin: () => Promise<{ ok: boolean; code?: number | null; error?: string }>
      getKimiAuthStatus: () => Promise<ProviderApiKeyStatus>
      storeKimiApiKey: (key: string) => Promise<void>
      clearKimiApiKey: () => Promise<void>
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
      computeRunDiff: (runId: string, preSnapshot: any, postSnapshot: any, changeContext?: any) => Promise<any>
      getWorkspaceChangeSets: (filter?: WorkspaceChangeFilter) => Promise<WorkspaceChangeSet[]>
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
      startPty: (workspacePath: string, sessionId?: string) => Promise<void>
      stopPty: (sessionId?: string) => Promise<void>
      ptyWrite: (data: string, sessionId?: string) => Promise<void>
      ptyResize: (cols: number, rows: number, sessionId?: string) => Promise<void>
      startGeminiSession: (workspace: string, model?: string, approvalMode?: string, sessionTrust?: boolean, cols?: number, rows?: number, resumeSessionId?: string | null, worktree?: GeminiWorktreeLaunchOption) => Promise<void>
      stopGeminiSession: () => Promise<void>
      writeGeminiSession: (data: string) => Promise<void>
      resizeGeminiSession: (cols: number, rows: number) => Promise<void>
      getFileIconDataUrl: (path: string) => Promise<string | null>
      onPtyData: (callback: (data: string, sessionId?: string) => void) => void
      onPtyExit: (callback: (code: number | null, sessionId?: string) => void) => void
      removePtyListeners: () => void
      onGeminiSessionData: (callback: (data: string) => void) => void
      onGeminiSessionExit: (callback: (code: number | null) => void) => void
      removeGeminiSessionListeners: () => void

      // Bridge / iOS remote allowlist (Phase C4 admin surface)
      bridgeAllowlistList: () => Promise<RemoteWorkspaceEntry[]>
      bridgeAllowlistUpsert: (entry: {
        workspaceId: string
        path: string
        mode: 'read-only' | 'read-write'
        allowedProviders: string[]
        allowedApprovalModes: string[]
        expiresAt?: number
      }) => Promise<RemoteWorkspaceEntry>
      bridgeAllowlistRemove: (workspaceId: string) => Promise<boolean>
      bridgeAllowlistClear: () => Promise<boolean>
      updateSnapshot: () => Promise<UpdateStateSnapshot>
      checkForUpdates: () => Promise<UpdateStateSnapshot>
      downloadUpdate: () => Promise<UpdateStateSnapshot>
      installUpdateOnQuit: () => Promise<UpdateStateSnapshot>
      installUpdateNow: () => Promise<UpdateStateSnapshot>
      onUpdateStatusChanged: (callback: (snapshot: UpdateStateSnapshot) => void) => void
      bridgeNetworkingStatus: () => Promise<{
        lan: {
          enabled: boolean
          running: boolean
          settingEnabled: boolean
          effectiveEnabled: boolean
          envOverride: 'force-on' | 'force-off' | null
          status: 'running' | 'stopped'
          pid?: number | null
          startedAt?: string | null
          lastError?: string | null
          bonjourServiceType: string
          hostname: string
        }
        tailscale: {
          available: boolean
          cliPath?: string
          version?: string
          tailnetIPv4?: string
          tailnetIPv6?: string
          hostname?: string
          tailnetName?: string
          magicDNSEnabled?: boolean
          reason?: string
        }
      }>
      setBridgeDaemonEnabled: (enabled: boolean) => Promise<{
        lan: {
          enabled: boolean
          running: boolean
          settingEnabled: boolean
          effectiveEnabled: boolean
          envOverride: 'force-on' | 'force-off' | null
          status: 'running' | 'stopped'
          pid?: number | null
          startedAt?: string | null
          lastError?: string | null
          bonjourServiceType: string
          hostname: string
        }
        tailscale: {
          available: boolean
          cliPath?: string
          version?: string
          tailnetIPv4?: string
          tailnetIPv6?: string
          hostname?: string
          tailnetName?: string
          magicDNSEnabled?: boolean
          reason?: string
        }
      }>
      bridgeFinalizePairing: (sessionID: string, userConfirmed: boolean) => Promise<unknown>
      onBridgePairingResponseReceived: (callback: (params: unknown) => void) => () => void
      // Begins a daemon-side pairing session. Returns the bootstrap
      // payload (PairingBootstrapPayload from the Swift daemon) so the
      // renderer can encode it as a QR for the iOS app, or surface it
      // as raw JSON for the "Paste JSON instead" fallback on iOS.
      bridgeBeginPairing: (displayName?: string) => Promise<{
        ok: boolean
        bootstrap?: unknown  // PairingBootstrapPayload shape; consumer passes through to QR/JSON
        error?: string
      }>

      // Phase E1: APNs config surface for the Settings panel. The
      // `getApnsConfig` response NEVER includes decrypted key material
      // — main holds the cleartext via safeStorage and only sends
      // redacted status (configured flag, keyId, teamId, bundleId,
      // configuredAt, last test result, encryption availability,
      // paired-device count) to the renderer.
      getApnsConfig: () => Promise<{
        configured: boolean
        keyId?: string
        teamId?: string
        bundleId?: string
        defaultBundleId: string
        configuredAt?: string
        lastTestResult?: {
          at: string
          delivered: number
          failed: number
          error?: string
        }
        encryptionAvailable: boolean
        registeredDeviceCount: number
      }>
      selectApnsKeyFile: () => Promise<string | null>
      setApnsConfig: (input: {
        authKeyPath?: string
        keyId?: string
        teamId?: string
        bundleId?: string
      }) => Promise<{ ok: boolean; error?: string }>
      clearApnsConfig: () => Promise<{ ok: boolean }>
      testApnsPush: () => Promise<{
        ok: boolean
        at?: string
        delivered?: number
        failed?: number
        error?: string
      }>

      getSettings: () => Promise<AppSettings>
      updateSettings: (partial: Partial<AppSettings>) => Promise<void>
      upsertAgenticWorkspaceGrant: (provider: ProviderId, workspacePath: string, service: AgenticServiceId) => Promise<AppSettings>
      removeAgenticWorkspaceGrant: (provider: ProviderId, workspacePath: string, service: AgenticServiceId) => Promise<AppSettings>
      getRuntimeProfiles: (provider?: ProviderId) => Promise<RuntimeProfile[]>
      saveRuntimeProfile: (profile: Partial<RuntimeProfile> & Pick<RuntimeProfile, 'name' | 'provider'>) => Promise<RuntimeProfile>
      deleteRuntimeProfile: (id: string) => Promise<void>
      getHandoffCards: (filter?: HandoffCardFilter) => Promise<HandoffCard[]>
      saveHandoffCard: (card: Partial<HandoffCard> & Pick<HandoffCard, 'sourceChatId' | 'sourceProvider' | 'summary' | 'finalPrompt'>) => Promise<HandoffCard>
      updateHandoffCard: (id: string, partial: Partial<HandoffCard>) => Promise<HandoffCard | null>
      deleteHandoffCard: (id: string) => Promise<void>
      getWorkspaces: () => Promise<WorkspaceRecord[]>
      addOrUpdateWorkspace: (path: string, partial?: Partial<WorkspaceRecord>) => Promise<WorkspaceRecord>
      removeWorkspace: (id: string) => Promise<void>
      clearWorkspaces: () => Promise<void>
      getChats: (workspaceId?: string) => Promise<ChatRecord[]>
      getChat: (chatId: string) => Promise<ChatRecord | null>
      createChat: (workspaceId: string, workspacePath: string) => Promise<ChatRecord>
      createGlobalChat: () => Promise<ChatRecord>
      createSubThread: (args: {
        parentChatId: string
        provider: ProviderId
        delegationPrompt: string
        returnResultToParent: boolean
        workspaceId?: string
        workspacePath?: string
      }) => Promise<ChatRecord>
      getSubThreads: (parentChatId: string) => Promise<ChatRecord[]>
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
      requestRunQueueJob: (job: Partial<RunQueueJob> & Pick<RunQueueJob, 'runId' | 'provider' | 'source'>) => Promise<RunQueueJob>
      leaseRunQueueJob: (request?: { runId?: string, provider?: ProviderId, statusReason?: string }) => Promise<RunQueueJob | null>
      transitionRunQueueJob: (runIdOrId: string, status: RunQueueJob['status'], partial?: Pick<Partial<RunQueueJob>, 'statusReason' | 'lastError'>) => Promise<RunQueueJob | null>
      getRunRecoveryRecords: (filter?: RunRecoveryFilter) => Promise<RunRecoveryRecord[]>
      getRunEvents: (filter?: RunEventFilter) => Promise<RunEventRecord[]>
      getRunEventReplay: (runId: string) => Promise<RunEventReplay>
      getApprovalLedger: (filter?: ApprovalLedgerFilter) => Promise<ApprovalLedgerRecord[]>
      getProductOperationsStatus: () => Promise<ProductOperationsStatus>
      getProductCrashes: (filter?: ProductCrashFilter) => Promise<ProductCrashRecord[]>
      recordProductCrash: (input: ProductCrashInput) => Promise<ProductCrashRecord>
      exportProductDiagnostics: (path?: string) => Promise<ProductDiagnosticsExportResult>
      repairProductInstall: () => Promise<ProductOperationsStatus>

      onGeminiOutput: (callback: (data: GeminiStreamPayload) => void) => void
      onGeminiError: (callback: (error: GeminiStreamPayload) => void) => void
      onGeminiExit: (callback: (code: GeminiStreamPayload | number | null) => void) => void
      onAgentOutput: (callback: (payload: { provider: ProviderId, data: string, appRunId?: string, appChatId?: string }) => void) => void
      onAgentError: (callback: (payload: { provider: ProviderId, error: string, appRunId?: string, appChatId?: string }) => void) => void
      onAgentExit: (callback: (payload: { provider: ProviderId, code: number | null, appRunId?: string, appChatId?: string }) => void) => void
      onRunQueueChanged: (callback: (jobs: RunQueueJob[]) => void) => void
      onRunEventsChanged: (callback: (payload: { runId: string, chatId?: string, workspaceId?: string, sequence: number }) => void) => void
      onAgentApprovalRequest: (callback: (payload: AgentApprovalRequest) => void) => void
      onAgentApprovalTimeout: (
        callback: (payload: {
          approvalId: string
          appliedMs: number
          source: 'perKind' | 'mainAuthority' | 'providerDefault'
        }) => void
      ) => void
      onScheduledTaskDue: (callback: (payload: ScheduledTask) => void) => void
      onScheduledTasksChanged: (callback: (payload: ScheduledTask[]) => void) => void
      onChatUpdated: (callback: (chat: ChatRecord) => void) => void
      removeListeners: () => void
    }
  }
}
