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
export type ProviderId = 'gemini' | 'codex' | 'claude' | 'kimi';
export type AgenticServiceId = 'shellCommands' | 'fileChanges' | 'mcpTools';
export type AgenticServicePolicy = 'ask' | 'workspace' | 'allow' | 'deny';
export type AgenticNetworkPolicy = 'allow' | 'deny';
export type CodexSandboxFallbackMode = 'ask_rerun' | 'off';
export type ExternalPathGrantAccess = 'read' | 'write';
export type ExternalPathGrantDuration = 'thisRun' | 'thisThread' | 'workspace';

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

export interface AppSettings {
  activeProvider?: ProviderId;
  claudeBinaryPath?: string;
  kimiBinaryPath?: string;
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
  preSnapshot?: WorkspaceSnapshot;
  postSnapshot?: WorkspaceSnapshot;
}

export interface ChatRecord {
  appChatId: string;
  provider?: ProviderId;
  title: string;
  workspaceId: string;
  workspacePath: string;
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
  runAt: string;
  timezone: string;
  status: ScheduledTaskStatus;
  createdAt: string;
  updatedAt: string;
  firedAt?: string;
  completedAt?: string;
  lastError?: string;
}

export type RunStatus = 'success' | 'success_with_warnings' | 'failed' | 'cancelled' | 'running';

export interface RunWarning {
  message: string;
  timestamp: string;
}

export type ToolActivityStatus = 'pending' | 'running' | 'success' | 'warning' | 'error';

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
  rawUseEvent?: unknown;
  rawResultEvent?: unknown;
  // Legacy fields preserved for backward compatibility
  affectedFilePath?: string;
  operationCategory?: 'update_topic' | 'read_file' | 'edit_file' | 'search' | 'shell' | 'unknown';
  outputSummary?: string;
  rawEventRefs?: string[];
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
  createdFiles: DiffFileSummary[];
  modifiedFiles: DiffFileSummary[];
  deletedFiles: DiffFileSummary[];
  preExistingFiles: DiffFileSummary[];
}
