export type AppearanceMode = 'solid' | 'soft_glass' | 'native_glass';
export type VisualEffectStyle = 'auto' | 'liquid_glass' | 'thin_material' | 'classic';
export type ThemeAppearance =
  | 'system'
  | 'dark'
  | 'light'
  | 'midnight'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'graphite'
  | 'rainbow'
  | 'nebula'
  | 'citrus'
  | 'twilight'
  | 'ocean'
  | 'sunset'
  | 'forest'
  | 'cyber'
  | 'candy';
export type ThemeCornerStyle = 'rounded' | 'hard';
export type ThemeAccentStyle = 'system' | 'blue' | 'purple' | 'pink' | 'orange' | 'green' | 'red' | 'yellow';
export type PromptSurfaceStyle = 'theme' | 'solid' | 'liquid_glass' | 'classic';
export type ComposerStyle = 'default' | 'codex' | 'claude' | 'gemini' | 'kimi';
export type ProviderId = 'gemini' | 'codex' | 'claude' | 'kimi';
export type ChatScope = 'workspace' | 'global';
export type AgenticServiceId = 'shellCommands' | 'fileChanges' | 'mcpTools';
export type AgenticServicePolicy = 'ask' | 'workspace' | 'allow' | 'deny';
export type AgenticNetworkPolicy = 'allow' | 'deny';
export type CodexSandboxFallbackMode = 'ask_rerun' | 'off';
export type ProductUpdateChannel = 'debug' | 'stable' | 'nightly';
export type ProductOperationStatus = 'ok' | 'warning' | 'error' | 'unknown';
export type ExternalPathGrantAccess = 'read' | 'write';
export type ExternalPathGrantDuration = 'thisRun' | 'thisThread' | 'workspace';
export type AgentApprovalAction = 'accept' | 'acceptForSession' | 'acceptForWorkspace' | 'decline' | 'cancel';

export interface ExternalPathGrant {
  id: string;
  provider: ProviderId;
  workspaceId?: string;
  chatId?: string;
  path: string;
  kind: 'file' | 'directory';
  access: ExternalPathGrantAccess;
  duration: ExternalPathGrantDuration;
  securityScopedBookmark?: string;
  issuedBy?: 'main';
  signature?: string;
  createdAt: string;
}

export interface AgenticServicesSettings {
  shellCommands: AgenticServicePolicy;
  fileChanges: AgenticServicePolicy;
  mcpTools: AgenticServicePolicy;
  networkAccess: AgenticNetworkPolicy;
}

export interface AgenticWorkspaceGrant {
  id: string;
  workspacePath: string;
  provider: ProviderId;
  service: AgenticServiceId;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  expiresOn?: 'workspace_revocation';
}

export interface GeminiMcpBridgeStatus {
  checkedAt: string;
  enabled: boolean;
  installed: boolean;
  available: boolean;
  serverName: 'agentbench';
  command?: string[];
  socketPath?: string;
  message?: string;
  raw?: string;
  error?: string;
}

export type ProviderCapabilityState = 'available' | 'gated' | 'blocked' | 'delegated' | 'unavailable';
export type ProviderCapabilityWarningSeverity = 'info' | 'warning' | 'error';
export type ProviderToolingCapabilityId = AgenticServiceId | 'networkAccess';

export interface ProviderCapabilityWarning {
  id: string;
  severity: ProviderCapabilityWarningSeverity;
  title: string;
  message: string;
}

export interface ProviderToolingCapability {
  id: ProviderToolingCapabilityId;
  label: string;
  state: ProviderCapabilityState;
  source: 'agentbench' | 'provider' | 'bridge' | 'settings';
  enforcedByAgentBench?: boolean;
  enforcement?: 'agentbench' | 'provider' | 'bridge' | 'settings' | 'best_effort' | 'none';
  policy?: AgenticServicePolicy | AgenticNetworkPolicy;
  requiresApproval: boolean;
  tools: string[];
  details?: string;
}

export interface ProviderApprovalCapability {
  requestedMode: string;
  effectiveMode: string;
  providerMode: string;
  inAppApprovals: boolean;
  supportsWorkspaceGrants: boolean;
  notes: string[];
}

export interface ProviderMcpCapability {
  state: ProviderCapabilityState;
  source: 'agentbench' | 'provider' | 'bridge' | 'unsupported';
  available: boolean;
  enabled?: boolean;
  installed?: boolean;
  serverName?: string;
  tools: string[];
  message?: string;
}

export interface ProviderAvailabilityCapability {
  available: boolean;
  setupRequired?: boolean;
  binaryPath?: string | null;
  binarySource?: string;
  version?: string;
  authState?: string;
  appServer?: string;
  error?: string;
}

export interface ProviderCapabilityContract {
  provider: ProviderId;
  label: string;
  refreshedAt: string;
  workspacePath?: string;
  availability: ProviderAvailabilityCapability;
  tools: Record<ProviderToolingCapabilityId, ProviderToolingCapability>;
  approvals: ProviderApprovalCapability;
  mcp: ProviderMcpCapability;
  warnings: ProviderCapabilityWarning[];
}

export type ProviderAdapterTransport =
  | 'gemini-cli'
  | 'codex-app-server'
  | 'claude-sdk-or-cli'
  | 'kimi-wire-or-cli';

export type ProviderAdapterRunChannel = 'run-agent';

export interface ProviderAdapterFeatureFlags {
  persistentSessions: boolean;
  appManagedApprovals: boolean;
  workspaceGrants: boolean;
  agentBenchMcpBridge: boolean;
  providerManagedMcp: boolean;
  nativeThreadTools: boolean;
  hostCommandFallback: boolean;
}

/** Static per-provider capability declarations.
 *
 * `features` (above) describes INFRASTRUCTURE characteristics —
 * whether the adapter uses AGBench's MCP bridge, has persistent
 * sessions, etc. `ProviderAdapterCapabilities` describes USER-FACING
 * UX capabilities — what the iOS composer / desktop renderer should
 * render for this provider.
 *
 * Examples of how UI consumes these:
 *   - `reasoningEffort: false` → hide the reasoning-effort picker
 *   - `imageAttachments: false` → disable the paperclip button
 *   - `approvalModes: ['default']` → hide the "plan mode" toggle
 *   - `speedTiers: []` → no speed-tier picker at all
 *
 * iOS UI subscribes to a provider's capabilities snapshot (sent during
 * pair init, refreshed on capability changes) and renders accordingly.
 * Desktop renderer can do the same via the existing
 * `get-provider-adapters` IPC.
 *
 * Future additions: thinking-mode flags, tool-call-batch support,
 * worktree variants — extend cautiously, since iOS clients tolerate
 * unknown fields but new required fields would break older clients. */
export interface ProviderAdapterCapabilities {
  /** Approval modes the provider's runtime accepts. iOS composer
   * filters this against `RemoteWorkspaceEntry.allowedApprovalModes`
   * to produce the final picker contents. */
  approvalModes: Array<'default' | 'plan' | 'allow-all'>;
  /** Whether the run payload's `reasoningEffort` field has any effect
   * for this provider. Codex / Claude honor it; Gemini / Kimi
   * currently don't. */
  reasoningEffort: boolean;
  /** Provider-specific speed tier identifiers. Empty array → no
   * speed-tier picker. */
  speedTiers: string[];
  /** Whether `imagePaths` in the run payload are forwarded to the
   * provider. iOS composer's image-picker is gated by this. */
  imageAttachments: boolean;
  /** Whether the prompt-composition layer's context-turn injection
   * applies. When false, the composer's contextTurns slider has no
   * effect — UI hides it. */
  contextInjection: boolean;
  /** Whether `providerSessionId` in the run payload resumes a prior
   * session (vs the provider creating a fresh session every turn). */
  sessionResumption: boolean;
  /** Whether the provider supports per-thread MCP server scoping
   * (Gemini-style). When false, MCP servers are workspace-wide. */
  perThreadMcp: boolean;
}

export interface ProviderAdapterDescriptor {
  provider: ProviderId;
  label: string;
  transport: ProviderAdapterTransport;
  runChannel: ProviderAdapterRunChannel;
  capabilitySource: 'agentbench' | 'provider' | 'bridge' | 'mixed';
  features: ProviderAdapterFeatureFlags;
  capabilities: ProviderAdapterCapabilities;
}

export type RuntimeWorkspaceMode = 'local' | 'worktree' | 'container';
export type RuntimeNetworkPolicy = 'inherit' | 'allow' | 'deny';
export type RuntimePersistence = 'reusable' | 'ephemeral';

export interface RuntimeProfile {
  id: string;
  name: string;
  provider: ProviderId;
  scope: ChatScope;
  workspaceMode: RuntimeWorkspaceMode;
  binaryPath?: string;
  env: Record<string, string>;
  mcpProfileId?: string;
  approvalMode?: string;
  agenticServices?: AgenticServicesSettings;
  networkPolicy: RuntimeNetworkPolicy;
  persistence: RuntimePersistence;
  containerConfig?: {
    image?: string;
    workdir?: string;
    mounts?: Array<{ source: string; target: string; access: 'read' | 'write' }>;
  };
  builtin?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HandoffCard {
  id: string;
  status: 'draft' | 'dispatched' | 'archived';
  sourceChatId: string;
  sourceRunId?: string;
  sourceProvider: ProviderId;
  workspaceId?: string;
  workspacePath?: string;
  summary: string;
  selectedFiles: string[];
  workspaceChangeSetIds: string[];
  rawEventRunIds: string[];
  recommendedProvider?: ProviderId;
  recommendedModel?: string;
  recommendedApprovalMode?: string;
  targetChatId?: string;
  dispatchedRunId?: string;
  finalPrompt: string;
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;
}

export interface HandoffCardFilter {
  sourceChatId?: string;
  sourceRunId?: string;
  status?: HandoffCard['status'];
}

export type FunFxMode = 'off' | 'subtle' | 'cinematic' | 'epic'

export interface AdvancedFxSettings {
  agentAura: boolean;
  livingWorkspace: boolean;
  dataViz: boolean;
  intensity: Exclude<FunFxMode, 'off'>;
}

export interface ProviderApiKeyStatus {
  available: boolean;
  authState: string;
  apiKeyConfigured: boolean;
  encryptionAvailable: boolean;
  version?: string;
  binaryPath?: string | null;
}

export interface AppSettings {
  activeProvider?: ProviderId;
  windowBounds?: {
    x?: number;
    y?: number;
    width: number;
    height: number;
    isMaximized?: boolean;
  };
  claudeBinaryPath?: string;
  claudeApiKey?: string;
  kimiBinaryPath?: string;
  kimiApiKey?: string;
  codexUsageCredential?: {
    encryptedAccessToken?: string;
    accountId?: string;
    importedAt?: string;
    source?: string;
    encryptionAvailable?: boolean;
  };
  storeLocalChatHistory: boolean;
  storeRawEvents: boolean;
  storePromptResponseInUsage: boolean;
  geminiCheckpointingEnabled: boolean;
  chatContextTurns: number;
  appearanceMode: AppearanceMode;
  visualEffectStyle: VisualEffectStyle;
  themeAppearance: ThemeAppearance;
  themeCornerStyle: ThemeCornerStyle;
  themeAccentStyle: ThemeAccentStyle;
  promptSurfaceStyle: PromptSurfaceStyle;
  composerStyle: ComposerStyle;
  transcriptFontFamily?: string;
  composerFontFamily?: string;
  funFxEnabled: boolean;
  funFxMode: FunFxMode;
  advancedFx: AdvancedFxSettings;
  reduceTransparency: boolean;
  reduceMotion: boolean;
  compactDensity: boolean;
  showInspector: boolean;
  inspectorWidth: number;
  sidebarWidth: number;
  agenticServices: AgenticServicesSettings;
  agenticWorkspaceGrants: AgenticWorkspaceGrant[];
  geminiMcpBridgeEnabled: boolean;
  geminiMcpBridgeLastStatus?: GeminiMcpBridgeStatus;
  codexSandboxFallback: CodexSandboxFallbackMode;
  updateChannel: ProductUpdateChannel;
}

export type ProductCrashSource =
  | 'main'
  | 'renderer'
  | 'child_process'
  | 'provider'
  | 'bridge'
  | 'startup'
  | 'unknown';

export interface ProductCrashRecord {
  schemaVersion: 1;
  id: string;
  source: ProductCrashSource;
  severity: 'warning' | 'error' | 'fatal';
  occurredAt: string;
  appVersion: string;
  platform: string;
  arch: string;
  processType?: string;
  reason?: string;
  exitCode?: number | null;
  name?: string;
  message: string;
  stack?: string;
  metadata?: Record<string, unknown>;
}

export type ProductCrashInput = Omit<
  ProductCrashRecord,
  'schemaVersion' | 'id' | 'occurredAt' | 'appVersion' | 'platform' | 'arch'
> &
  Partial<Pick<ProductCrashRecord, 'id' | 'occurredAt' | 'appVersion' | 'platform' | 'arch'>>;

export interface ProductCrashFilter {
  source?: ProductCrashSource;
  severity?: ProductCrashRecord['severity'];
  since?: string;
  limit?: number;
}

export interface ProductHealthCheck {
  id: string;
  label: string;
  status: ProductOperationStatus;
  message: string;
  repairAction?: 'install_gemini_bridge' | 'create_user_data_dir' | 'none';
  checkedAt: string;
}

export interface ProductBridgeHealthRecord {
  provider: ProviderId;
  bridgeId: string;
  label: string;
  status: ProductOperationStatus;
  checkedAt: string;
  enabled: boolean;
  installed: boolean;
  available: boolean;
  message: string;
  rawStatus?: GeminiMcpBridgeStatus;
}

export interface ProductInstallRepairStatus {
  checkedAt: string;
  status: ProductOperationStatus;
  appPath: string;
  userDataPath: string;
  checks: ProductHealthCheck[];
}

export interface ProductReleaseAutomationStatus {
  checkedAt: string;
  status: ProductOperationStatus;
  updateChannel: ProductUpdateChannel;
  appId?: string;
  productName?: string;
  outputDirectory?: string;
  scripts: {
    build?: string;
    test?: string;
    ci?: string;
    buildUnpack?: string;
    buildMac?: string;
    buildMacNotarized?: string;
    buildDebugMac?: string;
    buildDebugMacNotarized?: string;
    smokeNodePty?: string;
    smokePackage?: string;
    validateRelease?: string;
  };
  nativeModules: {
    configured: boolean;
    validationScript?: string;
    message: string;
  };
  updateDistribution: {
    configured: boolean;
    provider?: string;
    owner?: string;
    repo?: string;
    url?: string;
    message: string;
  };
  notarization: {
    configured: boolean;
    keychainProfile?: string;
    scriptName?: string;
    message: string;
  };
  signing: {
    configured: boolean;
    identity?: string;
    message: string;
  };
  releaseSteps: string[];
}

export interface ProductOperationsStatus {
  generatedAt: string;
  updateChannel: ProductUpdateChannel;
  overallStatus: ProductOperationStatus;
  app: {
    name: string;
    version: string;
    isPackaged: boolean;
    appPath: string;
    userDataPath: string;
  };
  system: {
    platform: string;
    arch: string;
    osRelease: string;
  };
  bridgeHealth: ProductBridgeHealthRecord[];
  installRepair: ProductInstallRepairStatus;
  releaseAutomation: ProductReleaseAutomationStatus;
  recentCrashes: ProductCrashRecord[];
  counts: {
    workspaces: number;
    chats: number;
    queuedRuns: number;
    activeRuns: number;
    interruptedRuns: number;
    approvalLedgerRecords: number;
    workspaceChangeSets: number;
    scheduledTasks: number;
    runtimeProfiles?: number;
    handoffCards?: number;
  };
}

export interface ProductDiagnosticsSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  status: ProductOperationsStatus;
  settings: {
    activeProvider?: ProviderId;
    updateChannel: ProductUpdateChannel;
    storeLocalChatHistory: boolean;
    storeRawEvents: boolean;
    agenticServices: AgenticServicesSettings;
    geminiMcpBridgeEnabled: boolean;
    codexSandboxFallback: CodexSandboxFallbackMode;
  };
  workspaces: Array<Pick<WorkspaceRecord, 'id' | 'path' | 'displayName' | 'lastOpenedAt' | 'pinned'>>;
  runQueue: RunQueueJob[];
  runRecovery: RunRecoveryRecord[];
  scheduledTasks: ScheduledTask[];
  approvalLedger: ApprovalLedgerRecord[];
  workspaceChanges: WorkspaceChangeSet[];
  recentCrashes: ProductCrashRecord[];
}

export interface ProductDiagnosticsExportResult {
  ok: boolean;
  path?: string;
  snapshot?: ProductDiagnosticsSnapshot;
  error?: string;
}

export interface GeminiWorktreeConfig {
  enabled: boolean;
  name?: string;
  effectivePath?: string;
}

export type GeminiWorktreeLaunchOption = GeminiWorktreeConfig | string | boolean | null | undefined;

export interface WorkspaceRecord {
  id: string;
  path: string;
  displayName: string;
  lastOpenedAt: number;
  createdAt: number;
  isGitRepo?: boolean;
  branch?: string;
  remoteOriginUrl?: string;
  geminiWorktree?: GeminiWorktreeConfig;
  pinned: boolean;
  lastActiveChatId?: string;
  notes?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'error';
  content: string;
  timestamp: string;
  runId?: string;
  toolActivities?: ToolActivity[];
}

export interface ChatRun {
  runId: string;
  provider?: ProviderId;
  providerRunId?: string;
  providerThreadId?: string;
  providerMetadata?: Record<string, unknown>;
  startedAt: string;
  endedAt?: string;
  promptMessageId?: string;
  requestedModel?: string;
  actualModel?: string;
  approvalMode?: string;
  status?: string; // RunStatus
  warnings?: RunWarning[];
  exitCode?: number;
  cancelled?: boolean;
  stats?: any;
  geminiWorktree?: GeminiWorktreeConfig;
  effectiveWorkspacePath?: string;
  diffUnavailableReason?: string;
  rawEventsFile?: string;
  diffSnapshot?: string;
  runDiff?: RunDiffResult;
  workspaceChangeSetId?: string;
  preSnapshot?: WorkspaceSnapshot;
  postSnapshot?: WorkspaceSnapshot;
  runtimeProfileId?: string;
  handoffSourceRunId?: string;
}

export interface ChatRecord {
  appChatId: string;
  scope?: ChatScope;
  provider?: ProviderId;
  title: string;
  workspaceId?: string;
  workspacePath?: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  linkedProviderSessionId?: string;
  providerMetadata?: Record<string, unknown>;
  linkedGeminiSessionId?: string;
  requestedModel?: string;
  lastActualModel?: string;
  messages: ChatMessage[];
  runs: ChatRun[];
  settingsSnapshot?: {
    model: string;
    approvalMode: string;
    sandboxEnabled: boolean;
  };
}

export type RunEventKind =
  | 'provider_raw'
  | 'provider_error'
  | 'provider_exit'
  | 'timeline'
  | 'delegation'
  | 'tool'
  | 'approval_request'
  | 'approval_response'
  | 'approval_timer_armed'
  | 'approval_timer_timeout'
  | 'diff'
  | 'final_message'
  | 'lifecycle';

export type RunEventPhase = 'raw' | 'normalized' | 'control' | 'artifact';

export type RunEventArtifactKind = 'stdin' | 'stdout' | 'stderr' | 'file' | 'snapshot' | 'diff' | 'other';

export interface RunEventArtifactRef {
  id: string;
  kind: RunEventArtifactKind;
  path: string;
  sha256: string;
  sizeBytes: number;
  sequence?: number;
  metadata?: Record<string, unknown>;
}

export interface RunEventRecord {
  schemaVersion: 1;
  id: string;
  sequence: number;
  previousHash?: string;
  hash?: string;
  runId: string;
  chatId?: string;
  workspaceId?: string;
  workspacePath?: string;
  provider?: ProviderId;
  providerSessionId?: string;
  providerRunId?: string;
  spanId?: string;
  parentSpanId?: string;
  toolCallId?: string;
  kind: RunEventKind;
  phase: RunEventPhase;
  source: 'main' | 'renderer' | 'provider' | 'replay';
  timestamp: string;
  summary?: string;
  payload?: unknown;
  artifacts?: RunEventArtifactRef[];
}

export type AgentActivityKind =
  | 'root'
  | 'subagent'
  | 'fork'
  | 'handoff'
  | 'tool'
  | 'approval'
  | 'artifact'
  | 'progress';

export type AgentActivityStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export interface AgentActivity {
  activityId: string;
  parentActivityId?: string;
  runId?: string;
  turnId?: string;
  provider?: ProviderId;
  providerThreadId?: string;
  providerAgentId?: string;
  parentToolCallId?: string;
  kind: AgentActivityKind;
  name: string;
  model?: string;
  status: AgentActivityStatus;
  promptPreview?: string;
  summary?: string;
  toolPolicy?: string;
  mcpPolicy?: string;
  approvalMode?: string;
  filesTouched?: string[];
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  rawEventRefs?: Array<{
    sequence?: number;
    hash?: string;
    toolCallId?: string;
    spanId?: string;
  }>;
}

export type RunEventInput = Omit<RunEventRecord, 'schemaVersion' | 'id' | 'sequence' | 'timestamp'> &
  Partial<Pick<RunEventRecord, 'id' | 'sequence' | 'timestamp'>>;

export interface RunEventFilter {
  runId?: string;
  chatId?: string;
  workspaceId?: string;
  provider?: ProviderId;
  kinds?: RunEventKind[];
  phases?: RunEventPhase[];
  fromSequence?: number;
  limit?: number;
}

export interface RunEventReplay {
  runId: string;
  events: RunEventRecord[];
  count: number;
  lastSequence: number;
  hashHead?: string;
  hashChainValid: boolean;
  countsByKind: Partial<Record<RunEventKind, number>>;
  timeline: Array<{
    sequence: number;
    timestamp: string;
    kind: RunEventKind;
    phase: RunEventPhase;
    source: RunEventRecord['source'];
    summary?: string;
    spanId?: string;
    parentSpanId?: string;
    toolCallId?: string;
    artifactIds?: string[];
    hash?: string;
  }>;
  startedAt?: string;
  endedAt?: string;
}

export type ApprovalLedgerStatus = 'pending' | 'approved' | 'denied' | 'cancelled' | 'expired';
export type ApprovalLedgerScope = 'request' | 'run' | 'session' | 'workspace';
export type ApprovalLedgerDecisionSource = 'user' | 'policy' | 'workspace_grant' | 'session_grant' | 'system';
export type ApprovalLedgerExpirationMode =
  | 'pending_timeout'
  | 'on_decision'
  | 'run_end'
  | 'session_end'
  | 'workspace_revocation'
  | 'none';

export interface ApprovalLedgerExpiration {
  mode: ApprovalLedgerExpirationMode;
  description: string;
  expiresAt?: string;
  expiredAt?: string;
  expiredReason?: string;
}

export interface ApprovalLedgerRecord {
  schemaVersion: 1;
  id: string;
  approvalId: string;
  provider: ProviderId;
  service?: AgenticServiceId;
  method: string;
  title: string;
  body?: string;
  preview?: unknown;
  params?: unknown;
  actions: AgentApprovalAction[];
  status: ApprovalLedgerStatus;
  requestedAt: string;
  respondedAt?: string;
  decision?: AgentApprovalAction | 'autoAllow' | 'autoDeny' | 'expired';
  decisionSource?: ApprovalLedgerDecisionSource;
  grantedScope?: ApprovalLedgerScope;
  expiration: ApprovalLedgerExpiration;
  runId?: string;
  chatId?: string;
  workspaceId?: string;
  workspacePath?: string;
  providerSessionId?: string;
  providerRunId?: string;
  rpcId?: number | string;
  metadata?: Record<string, unknown>;
}

export type ApprovalLedgerRequestInput = Omit<
  ApprovalLedgerRecord,
  | 'schemaVersion'
  | 'id'
  | 'status'
  | 'requestedAt'
  | 'respondedAt'
  | 'decision'
  | 'decisionSource'
  | 'grantedScope'
  | 'expiration'
> &
  Partial<
    Pick<
      ApprovalLedgerRecord,
      'id' | 'requestedAt' | 'status' | 'respondedAt' | 'decision' | 'decisionSource' | 'grantedScope' | 'expiration'
    >
  >;

export interface ApprovalLedgerFilter {
  approvalId?: string;
  runId?: string;
  chatId?: string;
  workspaceId?: string;
  provider?: ProviderId;
  service?: AgenticServiceId;
  statuses?: ApprovalLedgerStatus[];
  scopes?: ApprovalLedgerScope[];
  includeExpired?: boolean;
  limit?: number;
}

export interface UsageRecord {
  id: string;
  provider?: ProviderId;
  timestamp: number;
  workspaceId: string;
  chatId: string;
  runId: string;
  usageKind?: 'run' | 'reset_hint';
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  totalTokenLimit?: number;
  resetAt?: string;
  resetText?: string;
  durationMs: number;
  promptText?: string;
  responseText?: string;
}

export type ScheduledTaskStatus = 'pending' | 'due' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ScheduledTask {
  id: string;
  workspaceId: string;
  workspacePath: string;
  chatId: string;
  provider: ProviderId;
  prompt: string;
  displayPrompt?: string;
  selectedModelType: string;
  customModel: string;
  approvalMode: string;
  sessionTrust: boolean;
  imageAttachments: Array<{
    id: string;
    path: string;
    name: string;
  }>;
  externalPathGrants?: ExternalPathGrant[];
  geminiWorktree?: GeminiWorktreeConfig;
  codexReasoningEffort?: string | null;
  codexServiceTier?: string | null;
  kimiThinkingEnabled?: boolean;
  runtimeProfileId?: string;
  handoffSourceRunId?: string;
  runAt: string;
  timezone: string;
  status: ScheduledTaskStatus;
  createdAt: string;
  updatedAt: string;
  firedAt?: string;
  completedAt?: string;
  lastError?: string;
}

export type RunQueueJobStatus =
  | 'queued'
  | 'starting'
  | 'active'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'completed';

export type RunQueueJobSource =
  | 'manual'
  | 'scheduled'
  | 'retry'
  | 'permission_retry'
  | 'review'
  | 'host_rerun'
  | 'system';

export interface RunQueueImageAttachmentSnapshot {
  id?: string;
  path: string;
  name?: string;
}

export interface RunQueueRequestSnapshot {
  scope?: ChatScope;
  prompt: string;
  displayPrompt?: string;
  selectedModelType: string;
  customModel: string;
  approvalMode: string;
  sessionTrust: boolean;
  imageAttachments: RunQueueImageAttachmentSnapshot[];
  externalPathGrants?: ExternalPathGrant[];
  geminiWorktree?: GeminiWorktreeConfig;
  codexNativeReview?: boolean;
  codexReasoningEffort?: string | null;
  codexServiceTier?: string | null;
  kimiThinkingEnabled?: boolean;
  scheduledTaskId?: string;
  preserveComposer?: boolean;
  runtimeProfileId?: string;
  handoffSourceRunId?: string;
}

export type RunRecoveryProcessAction = 'left_running' | 'not_found' | 'inaccessible' | 'unknown';

export interface RunRecoveryProcessSnapshot {
  pid: number;
  checkedAt: string;
  alive: boolean;
  command?: string;
  errorCode?: string;
  errorMessage?: string;
  detection: 'pid_signal' | 'pid_signal_and_ps';
  action: RunRecoveryProcessAction;
}

export interface RunQueueJob {
  id: string;
  runId: string;
  provider: ProviderId;
  scope?: ChatScope;
  workspaceId?: string;
  workspacePath?: string;
  chatId?: string;
  source: RunQueueJobSource;
  status: RunQueueJobStatus;
  priority: number;
  attempt: number;
  promptPreview?: string;
  request?: RunQueueRequestSnapshot;
  providerSessionId?: string;
  providerRunId?: string;
  processPid?: number;
  processStartedAt?: string;
  processCommand?: string;
  runtimeProfileId?: string;
  handoffSourceRunId?: string;
  orphanProcess?: RunRecoveryProcessSnapshot;
  parentRunId?: string;
  createdAt: string;
  updatedAt: string;
  enqueuedAt?: string;
  startedAt?: string;
  pausedAt?: string;
  endedAt?: string;
  cancelledAt?: string;
  failedAt?: string;
  completedAt?: string;
  interruptedAt?: string;
  recoveredAt?: string;
  statusReason?: string;
  lastError?: string;
  recoveryReason?: string;
  resumeAvailable?: boolean;
  resumeHint?: string;
}

export interface RunQueueJobFilter {
  workspaceId?: string;
  chatId?: string;
  provider?: ProviderId;
  statuses?: RunQueueJobStatus[];
  includeTerminal?: boolean;
}

export type RunRecoveryAction =
  | 'marked_failed'
  | 'marked_failed_orphan_detected'
  | 'cleared_stale_process'
  | 'cleared_stale_orphan_process';

export interface RunRecoveryRecord {
  schemaVersion: 1;
  id: string;
  runId: string;
  jobId: string;
  provider: ProviderId;
  chatId?: string;
  workspaceId?: string;
  workspacePath?: string;
  previousStatus: RunQueueJobStatus;
  recoveredStatus: RunQueueJobStatus;
  action: RunRecoveryAction;
  reason: string;
  recoveredAt: string;
  process?: RunRecoveryProcessSnapshot;
  resumeAvailable: boolean;
  resumeHint: string;
  jobSnapshot: {
    providerSessionId?: string;
    providerRunId?: string;
    promptPreview?: string;
    startedAt?: string;
    updatedAt?: string;
    processPid?: number;
    processStartedAt?: string;
    processCommand?: string;
  };
}

export interface RunRecoveryFilter {
  runId?: string;
  chatId?: string;
  workspaceId?: string;
  provider?: ProviderId;
  actions?: RunRecoveryAction[];
  onlyOrphans?: boolean;
  limit?: number;
}

export type RunStatus = 'success' | 'success_with_warnings' | 'failed' | 'cancelled' | 'running';

export interface RunWarning {
  message: string;
  timestamp: string;
}

export type ToolActivityStatus = 'pending' | 'running' | 'success' | 'warning' | 'error';

export interface ToolDiffFileSummary {
  path?: string;
  status?: DiffFileStatus | 'updated' | 'unknown';
  additions?: number;
  deletions?: number;
}

export interface ToolDiffSummary {
  additions?: number;
  deletions?: number;
  files?: ToolDiffFileSummary[];
  source: 'codex_changes' | 'patch_preview' | 'string_replace' | 'content' | 'result_diff' | 'unknown';
  confidence: 'exact' | 'estimated' | 'unknown';
}

export interface ToolActivity {
  id: string;
  toolName: string;
  displayName: string;
  category: 'task' | 'read' | 'write' | 'search' | 'shell' | 'unknown';
  status: ToolActivityStatus;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  parameters?: Record<string, unknown>;
  resultSummary?: string;
  outputPreview?: string;
  filePath?: string;
  diffSummary?: ToolDiffSummary;
  rawUseEvent?: unknown;
  rawResultEvent?: unknown;
  /** If this tool call was emitted by a sub-agent, the tool_use id of the parent Task / Agent call that spawned it. */
  parentToolCallId?: string;
  // Legacy fields preserved for backward compatibility
  affectedFilePath?: string;
  operationCategory?: 'update_topic' | 'read_file' | 'edit_file' | 'search' | 'shell' | 'unknown';
  outputSummary?: string;
  rawEventRefs?: string[];
}

export type ChildAgentKind = 'claude-task' | 'codex-background' | 'kimi-swarm' | 'gemini-subagent' | 'manual';
export type ChildAgentInteractivity = 'interactive' | 'oneshot' | 'observe-only';
export type ChildAgentState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ChildAgentThread {
  id: string;
  parentChatId?: string;
  parentRunId?: string;
  /** The tool_use id of the Task/Agent call that produced this thread (when applicable). */
  parentToolCallId?: string;
  provider: ProviderId;
  kind: ChildAgentKind;
  interactivity: ChildAgentInteractivity;
  name: string;
  role?: string;
  state: ChildAgentState;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  seedPrompt?: string;
  finalResult?: string;
  /** Tool activity ids that belong to this child thread. */
  toolActivityIds: string[];
  /** Visual identity (display name + color) assigned by `assignAgentIdentity`.
   * For Codex this may carry a platform-extracted name; for other providers it
   * comes from our scientist-surname pool. Persisted to
   * `ChatRecord.providerMetadata.agentIdentities` so the same thread keeps the
   * same identity across renders and app reloads. */
  identity?: AgentIdentity;
}

/** Source of a subagent's display identity. */
export type AgentIdentitySource = 'pool' | 'platform' | 'manual';

/** Visual identity for a single sub-agent. Indexed by `ChildAgentThread.id`
 * inside `ChatRecord.providerMetadata.agentIdentities`. */
export interface AgentIdentity {
  agentId: string;
  /** Display name shown in chips, cards, panels. */
  name: string;
  /** Accent color (hex). Drives chip color, card name color, dot color. */
  color: string;
  /** Optional role label (e.g. "explorer", "reviewer"). */
  role?: string;
  source: AgentIdentitySource;
  /** ISO timestamp the identity was assigned. */
  assignedAt: string;
}

export type TrustStatus = 'trusted' | 'untrusted' | 'inherited' | 'unknown' | 'not_checked';

export interface TrustStatusResult {
  status: TrustStatus;
  reason?: string;
  isSessionOnly?: boolean;
}

export interface GeminiSessionSummary {
  id: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  raw?: string;
}

export interface GeminiSessionListResult {
  ok: boolean;
  sessions: GeminiSessionSummary[];
  rawLines: string[];
  error?: string;
}

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  sizeBytes?: number;
  depth: number;
}

export interface WorkspaceFileReadResult {
  path: string;
  content: string;
  sizeBytes: number;
  changeSet?: WorkspaceChangeSet;
}

export type DiffFileStatus =
  | 'modified'
  | 'created'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'binary'
  | 'too_large'
  | 'hidden_sensitive'
  | 'noise';

export type DiffPreviewKind = 'git_diff' | 'synthetic_new_file' | 'text_preview' | 'binary' | 'hidden' | 'none';

export interface DiffFileSummary {
  path: string;
  status: DiffFileStatus;
  additions?: number;
  deletions?: number;
  isBinary?: boolean;
  isNoise?: boolean;
  isSensitive?: boolean;
  previewKind: DiffPreviewKind;
  diffText?: string;
  sizeBytes?: number;
}

export interface WorkspaceSnapshot {
  capturedAt: string;
  isGitRepo: boolean;
  workspacePath?: string;
  gitStatus?: string; // git status --porcelain=v1 -z output
  files?: FileSnapshot[];
}

export interface FileSnapshot {
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  hash?: string;
}

export interface RunDiffResult {
  runId: string;
  preSnapshot: WorkspaceSnapshot;
  postSnapshot?: WorkspaceSnapshot;
  changeSetId?: string;
  createdFiles: DiffFileSummary[];
  modifiedFiles: DiffFileSummary[];
  deletedFiles: DiffFileSummary[];
  preExistingFiles: DiffFileSummary[];
}

export type WorkspaceChangeSource =
  | 'provider_run'
  | 'editor'
  | 'host_command'
  | 'checkpoint'
  | 'worktree'
  | 'system';

export type WorkspaceChangeStatus = 'captured' | 'failed' | 'superseded';

export type WorkspaceChangeFileOrigin =
  | 'run_diff'
  | 'manual_edit'
  | 'tool_activity'
  | 'git_status'
  | 'snapshot'
  | 'pre_existing';

export type WorkspaceArtifactKind = 'file' | 'directory' | 'diff' | 'snapshot' | 'checkpoint' | 'worktree';

export interface WorkspaceChangeFile {
  path: string;
  status: DiffFileStatus;
  origin: WorkspaceChangeFileOrigin;
  additions?: number;
  deletions?: number;
  sizeBytes?: number;
  isBinary?: boolean;
  isNoise?: boolean;
  isSensitive?: boolean;
  previewKind?: DiffPreviewKind;
  diffText?: string;
}

export interface WorkspaceChangeArtifact {
  id: string;
  kind: WorkspaceArtifactKind;
  path?: string;
  label?: string;
  source: WorkspaceChangeSource;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceChangeWorktreeContext {
  enabled: boolean;
  name?: string;
  baseWorkspacePath?: string;
  effectivePath?: string;
}

export interface WorkspaceChangeCheckpointContext {
  enabled: boolean;
  provider?: ProviderId;
  checkpointId?: string;
  label?: string;
}

export interface WorkspaceChangeStats {
  filesCreated: number;
  filesModified: number;
  filesDeleted: number;
  filesPreExisting: number;
  artifactsGenerated: number;
  additions: number;
  deletions: number;
}

export interface WorkspaceChangeSet {
  schemaVersion: 1;
  id: string;
  source: WorkspaceChangeSource;
  status: WorkspaceChangeStatus;
  title: string;
  summary?: string;
  workspaceId?: string;
  workspacePath: string;
  effectiveWorkspacePath?: string;
  chatId?: string;
  runId?: string;
  provider?: ProviderId;
  createdAt: string;
  updatedAt: string;
  preSnapshot?: WorkspaceSnapshot;
  postSnapshot?: WorkspaceSnapshot;
  files: WorkspaceChangeFile[];
  artifacts: WorkspaceChangeArtifact[];
  worktree?: WorkspaceChangeWorktreeContext;
  checkpoint?: WorkspaceChangeCheckpointContext;
  stats: WorkspaceChangeStats;
  metadata?: Record<string, unknown>;
}

export type WorkspaceChangeSetInput = Omit<
  WorkspaceChangeSet,
  'schemaVersion' | 'id' | 'status' | 'createdAt' | 'updatedAt' | 'stats' | 'files' | 'artifacts'
> &
  Partial<
    Pick<
      WorkspaceChangeSet,
      'id' | 'status' | 'createdAt' | 'updatedAt' | 'stats' | 'files' | 'artifacts'
    >
  >;

export interface WorkspaceRunChangeInput {
  runId: string;
  chatId?: string;
  workspaceId?: string;
  workspacePath: string;
  effectiveWorkspacePath?: string;
  provider?: ProviderId;
  runDiff: RunDiffResult;
  worktree?: WorkspaceChangeWorktreeContext;
  checkpoint?: WorkspaceChangeCheckpointContext;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceEditorChangeInput {
  workspaceId?: string;
  workspacePath: string;
  effectiveWorkspacePath?: string;
  chatId?: string;
  filePath: string;
  existedBefore: boolean;
  previousContent?: string;
  nextContent: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceChangeFilter {
  workspaceId?: string;
  workspacePath?: string;
  chatId?: string;
  runId?: string;
  provider?: ProviderId;
  sources?: WorkspaceChangeSource[];
  statuses?: WorkspaceChangeStatus[];
  since?: string;
  limit?: number;
}

export type BenchmarkArtifactKind =
  | 'stdout'
  | 'stderr'
  | 'file'
  | 'directory'
  | 'snapshot'
  | 'diff'
  | 'score'
  | 'other';

export interface BenchmarkPinnedFile {
  path: string;
  sizeBytes: number;
  sha256: string;
  mtimeMs?: number;
  mode?: number;
}

export interface BenchmarkGitManifest {
  root?: string;
  head?: string;
  branch?: string;
  dirty: boolean;
  statusPorcelain?: string;
  trackedFiles?: BenchmarkPinnedFile[];
}

export type BenchmarkScorerKind =
  | 'exact_match'
  | 'regex_match'
  | 'file_exists'
  | 'artifact_exists'
  | 'json_field_equals';

export interface BenchmarkScorerDefinition {
  id: string;
  kind: BenchmarkScorerKind;
  weight?: number;
  target?: string;
  expected?: unknown;
  pattern?: string;
  flags?: string;
  path?: string;
  sha256?: string;
  artifactName?: string;
  artifactKind?: BenchmarkArtifactKind;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkTaskManifest {
  schemaVersion: 1;
  id: string;
  title: string;
  prompt: string;
  provider?: ProviderId;
  workspacePath?: string;
  inputFiles?: string[];
  expectedArtifacts?: Array<{
    name: string;
    kind: BenchmarkArtifactKind;
    sha256?: string;
  }>;
  scorers: BenchmarkScorerDefinition[];
  metadata?: Record<string, unknown>;
}

export interface BenchmarkEnvironmentManifest {
  schemaVersion: 1;
  capturedAt: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  nodeVersion: string;
  appVersion?: string;
  workspacePath?: string;
  git?: BenchmarkGitManifest;
  files: BenchmarkPinnedFile[];
  env?: Record<string, string>;
}

export interface BenchmarkArtifactRecord {
  id: string;
  runId: string;
  kind: BenchmarkArtifactKind;
  name: string;
  relativePath: string;
  absolutePath?: string;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkScoreResult {
  scorerId: string;
  kind: BenchmarkScorerKind;
  passed: boolean;
  score: number;
  maxScore: number;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkEvaluationReport {
  schemaVersion: 1;
  taskId: string;
  evaluatedAt: string;
  score: number;
  maxScore: number;
  passed: boolean;
  results: BenchmarkScoreResult[];
}

export interface BenchmarkRunManifest {
  schemaVersion: 1;
  id: string;
  taskId: string;
  runId?: string;
  provider?: ProviderId;
  workspacePath?: string;
  createdAt: string;
  taskManifestSha256: string;
  environmentManifestSha256: string;
  promptSha256: string;
  task: BenchmarkTaskManifest;
  environment: BenchmarkEnvironmentManifest;
  artifacts: BenchmarkArtifactRecord[];
  evaluation?: BenchmarkEvaluationReport;
  metadata?: Record<string, unknown>;
}
